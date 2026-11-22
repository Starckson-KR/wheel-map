import { isStandalone } from '../../components/onboarding/installEnv'
import { apiCall, getSession, useAccount } from './api'
import { takeAuthKind } from './authKind'
import { cleanMessage, cleanStack, dayOf, errorKey, isIgnorableError, pushPending, routeOf, shouldReportResume, takeError } from './activityPlan'
import type { SeenMap } from './activityPlan'
import { readCityConsent } from './cityConsent'
import { DEVICE_ID_KEY, ERR_SEEN_KEY } from './keys'

declare const __BUILD_HASH__: string

// 개발자가 「에러 나요」를 바로 짚을 수 있게, 로그인한 사용자의 접속과 앱 오류를 서버에 남긴다(worker/src/activity.ts).
//  - 접속: 로그인 상태로 앱을 열 때, 로그인·가입 때, 30분 넘게 숨겨졌다 다시 보일 때만.
//  - 오류: window error·unhandledrejection. 같은 오류는 기기당 하루 한 번, 로그인 전 오류는 최대 10개만 모았다가 로그인 뒤에 보낸다.
//  - 보내는 데 실패해도 아무것도 하지 않는다(다시 시도하지 않는다). 제보 내용·localStorage 내용은 싣지 않는다.

let memoryId: string | null = null

/** 이 기기의 무작위 id. 저장소를 못 쓰면 이번 실행 동안만 유지되는 값. */
export function getDeviceId(): string {
  try {
    const v = localStorage.getItem(DEVICE_ID_KEY)
    if (v && /^[A-Za-z0-9_-]{8,64}$/.test(v)) return v
    const id = makeId()
    localStorage.setItem(DEVICE_ID_KEY, id)
    return id
  } catch {
    return (memoryId ??= makeId())
  }
}
function makeId(): string {
  const b = new Uint8Array(12)
  crypto.getRandomValues(b)
  return 'd' + [...b].map((x) => x.toString(16).padStart(2, '0')).join('')
}

const build = () => (typeof __BUILD_HASH__ === 'string' ? __BUILD_HASH__ : 'dev')

type Kind = 'open' | 'resume' | 'login' | 'signup'
/** 접속 기록을 한 번 보낸다(동의·설정 변경 직후 지역을 바로 채울 때도 쓴다). 던지지 않는다. */
export const recordVisitNow = (kind: Kind = 'open') => sendVisit(kind)
async function sendVisit(kind: Kind): Promise<void> {
  try {
    if (!getSession()) return
    await apiCall('/activity/visit', {
      method: 'POST',
      json: {
        deviceId: getDeviceId(),
        build: build(),
        standalone: isStandalone({ navStandalone: (navigator as Navigator & { standalone?: boolean }).standalone, matchMedia: (q) => window.matchMedia(q) }),
        screen: { w: window.innerWidth, h: window.innerHeight },
        kind,
        ...(readCityConsent() === 'yes' ? { cityOk: true } : {}), // 동의한 경우만 서버가 지역을 저장한다
      },
    })
  } catch {
    /* 기록 실패는 무시 */
  }
}

type ErrPayload = { deviceId: string; build: string; message: string; stack: string; route: string; at: number }
let pending: ErrPayload[] = []
let sending = false // 오류 보내는 도중에 난 오류가 다시 오류를 부르지 않게

async function postError(p: ErrPayload): Promise<void> {
  try {
    await apiCall('/activity/error', { method: 'POST', json: p })
  } catch {
    /* 무시 */
  }
}

function readSeen(): SeenMap {
  try {
    const v = JSON.parse(localStorage.getItem(ERR_SEEN_KEY) ?? '{}') as unknown
    return typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as SeenMap) : {}
  } catch {
    return {}
  }
}
function writeSeen(m: SeenMap) {
  try {
    localStorage.setItem(ERR_SEEN_KEY, JSON.stringify(m))
  } catch {
    /* 저장 실패면 이번 실행 중에는 중복을 못 거를 수 있다 */
  }
}

/** 오류 하나를 기록한다(앱 어디서든 부를 수 있다. 던지지 않는다). */
export function recordError(rawMessage: string, rawStack = ''): void {
  if (sending) return
  sending = true
  try {
    const message = cleanMessage(rawMessage)
    if (!message || isIgnorableError(message)) return
    const key = errorKey(message, build())
    const r = takeError(readSeen(), key, dayOf(new Date()))
    if (!r.send) return
    writeSeen(r.seen)
    const p: ErrPayload = { deviceId: getDeviceId(), build: build(), message, stack: cleanStack(rawStack), route: routeOf(location.hash), at: Date.now() }
    if (getSession()) void postError(p)
    else pending = pushPending(pending, p)
  } catch {
    /* 기록 자체의 실패는 무시 */
  } finally {
    sending = false
  }
}

function flushPending() {
  const list = pending
  pending = []
  for (const p of list) void postError(p)
}

let reportedFor: string | null = null
let started = false

export function initActivity(): void {
  if (started || typeof window === 'undefined') return
  started = true

  window.addEventListener('error', (e) => {
    // 이미지 같은 자원 불러오기 실패는 여기로 오지 않는다(버블링 안 함). 스크립트 오류만.
    recordError(e.message || (e.error instanceof Error ? e.error.message : ''), e.error instanceof Error ? (e.error.stack ?? '') : '')
  })
  window.addEventListener('unhandledrejection', (e) => {
    const r = e.reason as unknown
    if (r instanceof Error) recordError(`Unhandled rejection: ${r.message}`, r.stack ?? '')
    else recordError(`Unhandled rejection: ${typeof r === 'string' ? r : Object.prototype.toString.call(r)}`)
  })

  // 로그인 상태가 확인되는 순간(앱 열기·로그인·가입)에 한 번
  const check = (s: { user: { id: string } | null; status: string }) => {
    if (!s.user) {
      reportedFor = null
      return
    }
    if (s.status !== 'ready' || reportedFor === s.user.id) return
    reportedFor = s.user.id
    void sendVisit(takeAuthKind() ?? 'open')
    flushPending()
  }
  useAccount.subscribe(check)
  check(useAccount.getState())

  // 30분 넘게 숨겨졌다 다시 보일 때
  let hiddenAt: number | null = null
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      hiddenAt = Date.now()
      return
    }
    if (shouldReportResume(hiddenAt, Date.now())) void sendVisit('resume')
    hiddenAt = null
  })
}
