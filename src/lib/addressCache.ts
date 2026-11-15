import { useEffect, useReducer, useRef, useState } from 'react'
import { loadKakao, reverseGeocode } from './kakao'

// 좌표 → 주소 표시용 캐시. 메모리와 localStorage에 저장해 같은 곳은 다시 조회하지 않는다.
// 조회는 화면에 보이는 항목만 하고(동시 3건), 실패하면 이미 알고 있는 동 이름("용봉동 부근")으로 대신한다.
const KEY = 'wheelmap.addrCache'
const DONG_KEY = 'wheelmap.dongCache' // regions.ts가 쓰는 동 이름 캐시(같은 키 형식)
const MAX_SAVED = 500
const CONCURRENCY = 3

const mem = new Map<string, string | null>() // null = 이번 접속에서 조회 실패
let loaded = false
let saveTimer: ReturnType<typeof setTimeout> | undefined

export const addrKey = (lat: number, lng: number) => `${lat.toFixed(4)},${lng.toFixed(4)}`

function ensureLoaded() {
  if (loaded) return
  loaded = true
  try {
    const obj = JSON.parse(localStorage.getItem(KEY) ?? '{}') as Record<string, string>
    for (const [k, v] of Object.entries(obj)) if (typeof v === 'string') mem.set(k, v)
  } catch {
    /* 캐시를 못 읽어도 그냥 새로 조회한다 */
  }
}

function scheduleSave() {
  clearTimeout(saveTimer)
  saveTimer = setTimeout(() => {
    try {
      const entries = [...mem.entries()].filter((e): e is [string, string] => typeof e[1] === 'string').slice(-MAX_SAVED)
      localStorage.setItem(KEY, JSON.stringify(Object.fromEntries(entries)))
    } catch {
      /* 저장 실패는 무시 */
    }
  }, 600)
}

/** 이미 알고 있는 값: 문자열이면 주소, null이면 조회 실패, undefined면 아직 모름 */
export function peekAddress(lat: number, lng: number): string | null | undefined {
  ensureLoaded()
  return mem.get(addrKey(lat, lng))
}

/** 같은 좌표(소수 4자리)에 대한 조회를 묶고, 동시에 나가는 호출 수를 제한한다. */
const inflight = new Map<string, Promise<void>>()
const waiting: (() => void)[] = []
let running = 0
const slot = () =>
  new Promise<void>((resolve) => {
    if (running < CONCURRENCY) {
      running++
      resolve()
    } else waiting.push(() => (running++, resolve()))
  })
const release = () => {
  running--
  waiting.shift()?.()
}

export function requestAddress(lat: number, lng: number): Promise<void> {
  ensureLoaded()
  const key = addrKey(lat, lng)
  if (mem.has(key)) return Promise.resolve()
  const cur = inflight.get(key)
  if (cur) return cur
  const p = (async () => {
    await slot()
    try {
      const k = await loadKakao().catch(() => null)
      const addr = k ? await reverseGeocode(k, lat, lng) : null
      mem.set(key, addr)
      if (addr) scheduleSave()
    } finally {
      release()
      inflight.delete(key)
    }
  })()
  inflight.set(key, p)
  return p
}

/** "광주 북구 용봉로 77"(전남광주통합특별시 표기도) → 짧게 "용봉로 77"(광주·북구는 앱 안에서 자명하므로 뺀다). 북구 밖이면 구 이름을 남긴다. */
export function shortAddress(raw: string): string {
  return raw.replace(/^(전남광주통합특별시|광주광역시|광주)\s+북구\s+/, '').replace(/^(전남광주통합특별시|광주광역시|광주)\s+/, '')
}

function dongNear(lat: number, lng: number): string | null {
  try {
    const dong = (JSON.parse(localStorage.getItem(DONG_KEY) ?? '{}') as Record<string, string>)[addrKey(lat, lng)]
    return dong && dong !== '확인 필요' ? `${dong} 부근` : null
  } catch {
    return null
  }
}

export type AddressView = {
  /** 목록용 짧은 표기. 조회 전·실패 시에는 알고 있는 동 이름, 그것도 없으면 null */
  short: string | null
  /** 상세용 전체 주소(없으면 short와 같은 대체 표기) */
  full: string | null
  status: 'loading' | 'ok' | 'fallback' | 'none'
}

/** 좌표의 주소. active가 false면 조회하지 않는다(화면에 보이는 항목만 조회하려고 쓴다). */
export function useAddress(lat: number, lng: number, active = true): AddressView {
  const [, bump] = useReducer((n: number) => n + 1, 0)
  const cached = active ? peekAddress(lat, lng) : undefined
  useEffect(() => {
    if (!active || peekAddress(lat, lng) !== undefined) return
    let live = true
    requestAddress(lat, lng).then(() => live && bump())
    return () => {
      live = false
    }
  }, [active, lat, lng])
  if (typeof cached === 'string') return { short: shortAddress(cached), full: cached, status: 'ok' }
  const dong = dongNear(lat, lng)
  if (cached === null) return { short: dong, full: dong, status: dong ? 'fallback' : 'none' }
  return { short: dong, full: dong, status: 'loading' }
}

/** 화면에 한 번이라도 들어오면 true가 되는 ref. IntersectionObserver가 없으면 바로 true. */
export function useSeen<T extends Element>(): [React.RefObject<T | null>, boolean] {
  const ref = useRef<T | null>(null)
  const [seen, setSeen] = useState(() => typeof IntersectionObserver === 'undefined')
  useEffect(() => {
    const el = ref.current
    if (seen || !el) return
    const io = new IntersectionObserver(
      (es) => {
        if (es.some((e) => e.isIntersecting)) {
          setSeen(true)
          io.disconnect()
        }
      },
      { rootMargin: '120px' },
    )
    io.observe(el)
    return () => io.disconnect()
  }, [seen])
  return [ref, seen]
}

/** 목록 한 줄용: 보이는 항목만 조회한다. */
export function useVisibleAddress<T extends Element>(lat: number, lng: number): [React.RefObject<T | null>, AddressView] {
  const [ref, seen] = useSeen<T>()
  return [ref, useAddress(lat, lng, seen)]
}

/** 좌표 숫자 대체 표기(조회가 모두 실패했을 때만 쓴다) */
export const coordText = (lat: number, lng: number) => `좌표 ${lat.toFixed(4)}, ${lng.toFixed(4)}`
