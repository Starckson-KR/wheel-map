// 초기 설정 흐름의 순수 로직(화면 없음): 어느 화면부터 시작할지, 진행 점, 저장 형식.
import type { BenefitCategory, BenefitPrefs, WheelchairUse } from '../../lib/benefits'

export type Screen = 'welcome' | 'device' | 'install' | 'name' | 'pin' | 'confirm' | 'mobility' | 'interests' | 'view'
export type Mobility = 'manual' | 'power' | 'companion' | 'none' | 'skip'
export type Profile = { mobility: Mobility; interests: BenefitCategory[] }

export const ONBOARDED_KEY = 'wheelmap.onboarded'
export const PROFILE_KEY = 'wheelmap.profile'
export const SCREENS: Screen[] = ['welcome', 'device', 'install', 'name', 'pin', 'confirm', 'mobility', 'interests', 'view']
export const DEFAULT_PROFILE: Profile = { mobility: 'skip', interests: [] }

/** 앱을 열 때 어느 화면부터 보일지. null이면 바로 앱. 로그인돼 있으면 초기 설정 여부와 상관없이 바로 앱이다. */
export function startScreen(s: { loggedIn: boolean; onboarded: boolean }): Screen | null {
  return s.loggedIn ? null : 'welcome'
}

/** 첫 화면의 "시작하기!" 다음 화면 */
export function afterWelcome(): Screen {
  return 'name'
}

/** 「홈 화면에 추가」 안내를 열 때 첫 화면. 기기를 알면 바로 안내, 모르면(PC 등) 기기부터 고른다. */
export function installStart(device: 'ios' | 'android' | null): Screen {
  return device ? 'install' : 'device'
}

/** 로그인·가입에 성공한 뒤 이어질 화면. 언제나 null(바로 앱). 이동 방식·관심·보기는 내 정보에서 바꾼다. */
export function afterAuth(): Screen | null {
  return null
}

/** 게이트를 건너뛰는 화면(개발·행정)인지 */
export function isSkipHash(hash: string, skip: readonly string[]): boolean {
  const seg = hash.replace(/^#/, '').split('?')[0].replace(/^\/+/, '').split('/')[0]
  return skip.includes(seg)
}

/** 개발 서버 전용 미리보기 해시: #/onboarding-preview?step=name (없는 단계는 name) */
export function parsePreview(hash: string): { on: boolean; step: Screen } {
  const [p, q = ''] = hash.replace(/^#/, '').split('?')
  if (p.replace(/^\/+/, '') !== 'onboarding-preview') return { on: false, step: 'name' }
  const step = new URLSearchParams(q).get('step') as Screen | null
  return { on: true, step: step && SCREENS.includes(step) ? step : 'name' }
}

/** 진행 점 3개(이동·관심·보기). 내 정보에서 다시 여는 설정에만 보인다. 그 밖은 점이 없다(-1). */
export const DOT_COUNT = 3
export function dotIndex(s: Screen): number {
  switch (s) {
    case 'mobility': return 0
    case 'interests': return 1
    case 'view': return 2
    default: return -1
  }
}

export const MOBILITY_OPTIONS: { id: Mobility; label: string; hint: string }[] = [
  { id: 'manual', label: '수동 휠체어', hint: '직접 밀거나 보조하는 분이 밀어요' },
  { id: 'power', label: '전동 휠체어', hint: '전동 휠체어나 전동 스쿠터를 써요' },
  { id: 'companion', label: '보호자·동행', hint: '휠체어를 쓰는 분과 함께 다녀요' },
  { id: 'none', label: '휠체어 안 써요', hint: '지도와 제보를 볼게요' },
  { id: 'skip', label: '선택 안 할래요', hint: '나중에 내 정보에서 바꿀 수 있어요' },
]

export function mobilityToWheelchair(m: Mobility): WheelchairUse {
  if (m === 'manual' || m === 'power') return 'user'
  if (m === 'companion') return 'companion'
  return 'none'
}

/** 기존 맞춤 혜택 설정(wheelmap.benefitPrefs) 형식으로 옮긴다. */
export function toBenefitPrefs(p: Profile): BenefitPrefs {
  return { wheelchair: mobilityToWheelchair(p.mobility), topics: [...new Set(p.interests)] }
}

const VALID_INTERESTS: BenefitCategory[] = ['mobility', 'device', 'welfare', 'culture']
export function parseProfile(raw: string | null): Profile {
  if (!raw) return { ...DEFAULT_PROFILE }
  try {
    const o = JSON.parse(raw) as Partial<Profile>
    const mobility: Mobility = MOBILITY_OPTIONS.some((m) => m.id === o.mobility) ? (o.mobility as Mobility) : 'skip'
    const interests = (Array.isArray(o.interests) ? o.interests : []).filter((x): x is BenefitCategory => VALID_INTERESTS.includes(x as BenefitCategory))
    return { mobility, interests: [...new Set(interests)] }
  } catch {
    return { ...DEFAULT_PROFILE }
  }
}

export type AuthCode = 'invalid' | 'taken' | 'locked' | 'network' | 'bad_input'
export function authMessage(code: AuthCode, mode: 'login' | 'signup'): string {
  switch (code) {
    case 'invalid': return '이름이나 비밀번호가 맞지 않아요'
    case 'taken': return '이미 있는 이름이에요. 로그인해 주세요'
    case 'locked': return '여러 번 틀려서 잠시 잠겼어요. 조금 뒤에 다시 해 주세요'
    case 'network': return '연결이 원활하지 않아요. 잠시 뒤에 다시 해 주세요'
    case 'bad_input': return mode === 'signup' ? '이름은 한글·영문·숫자로 10자까지 쓸 수 있어요' : '이름과 비밀번호를 다시 확인해 주세요'
  }
}

/** 이름 입력 정리(앞뒤 공백 제거, 연속 공백 하나로) */
export function cleanName(raw: string): string {
  return raw.trim().replace(/\s+/g, ' ')
}
/** 서버(`worker/src/auth.ts`의 NAME_RE·normalizeName)와 같은 규칙: 한글·영문·숫자·공백 1~10자 */
const NAME_RE = /^[가-힣ㄱ-ㅎㅏ-ㅣA-Za-z0-9 ]+$/
export const NAME_MAX = 10
export const nameOk = (raw: string) => {
  const n = cleanName(raw).normalize('NFC')
  return n.length >= 1 && n.length <= NAME_MAX && NAME_RE.test(n)
}
/** 이름 칸 아래에 바로 보여 줄 말. 문제가 없거나 비어 있으면 null */
export function nameHint(raw: string): string | null {
  const n = cleanName(raw).normalize('NFC')
  if (!n) return null
  if (!NAME_RE.test(n)) return '이모지나 특수문자는 쓸 수 없어요'
  if (n.length > NAME_MAX) return `${NAME_MAX}자까지 쓸 수 있어요`
  return null
}

/** 다른 화면(내 정보 탭의 AccountCard)이 초기 설정을 다시 열 때 보내는 이벤트 */
export const ONBOARDING_EVENT = 'wheelmap:onboarding'
/** 「홈 화면에 추가」 안내(기기·설치 화면)를 열 때 보내는 이벤트(홈의 띠, 내 정보) */
export const INSTALL_EVENT = 'wheelmap:install-guide'
export const INSTALL_HINT_KEY = 'wheelmap.installHintClosed'
