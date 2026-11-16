import { create } from 'zustand'
import { ACCOUNT_URL } from '../config'
import { reapplyPrefs } from '../viewPrefs'
import { SESSION_KEY, SYNCED_PREF_KEYS } from './keys'

// 간편 계정(이름 + 4자리 숫자). 서버는 wheelmap-ai Worker(worker/README.md). 세션 토큰은 localStorage `wheelmap.session`에만 둔다.

export type AccountUser = { id: string; name: string; role?: string } // role: 'dev'이면 개발자 관리 화면이 열린다(서버가 알려 주는 값)
export type AuthResult =
  | { ok: true; user: AccountUser }
  | { ok: false; code: 'invalid' | 'taken' | 'locked' | 'network' | 'bad_input'; message: string }

type Session = { token: string; user: AccountUser }

function readSession(): Session | null {
  try {
    const raw = localStorage.getItem(SESSION_KEY)
    if (!raw) return null
    const v = JSON.parse(raw) as Partial<Session>
    if (v && typeof v.token === 'string' && v.user && typeof v.user.id === 'string' && typeof v.user.name === 'string') return { token: v.token, user: { id: v.user.id, name: v.user.name, role: typeof v.user.role === 'string' ? v.user.role : undefined } }
  } catch {
    /* 저장소를 못 읽으면 로그아웃 상태로 */
  }
  return null
}

function writeSession(s: Session | null) {
  try {
    if (s) localStorage.setItem(SESSION_KEY, JSON.stringify(s))
    else localStorage.removeItem(SESSION_KEY)
  } catch {
    /* 저장 실패는 이번 탭에서만 로그인 유지 */
  }
}

let memorySession: Session | null = readSession()

export function getSession(): { token: string; user: AccountUser } | null {
  return memorySession
}

// status: 'idle'(시작 전) → 'loading'(가입·로그인·세션 확인 중) → 'ready'. 저장된 세션이 없으면 바로 'ready'(user는 null).
export const useAccount = create<{ user: AccountUser | null; status: 'idle' | 'loading' | 'ready' }>(() => ({
  user: memorySession?.user ?? null,
  status: memorySession ? 'loading' : 'ready',
}))

function setSession(s: Session | null) {
  memorySession = s
  writeSession(s)
  useAccount.setState({ user: s?.user ?? null, status: 'ready' })
}

type Raw = { status: number; body: Record<string, unknown> | null; blob?: Blob }

// 서버 호출 공통부. 네트워크 실패는 throw 하지 않고 status 0으로 돌려준다.
export async function apiCall(path: string, init: { method?: string; json?: unknown; body?: Blob; auth?: boolean; wantBlob?: boolean } = {}): Promise<Raw> {
  const headers: Record<string, string> = {}
  const s = memorySession
  if (init.auth !== false && s) headers.authorization = `Bearer ${s.token}`
  let body: BodyInit | undefined
  if (init.json !== undefined) {
    headers['content-type'] = 'application/json'
    body = JSON.stringify(init.json)
  } else if (init.body) {
    headers['content-type'] = init.body.type || 'application/octet-stream'
    body = init.body
  }
  try {
    const res = await fetch(`${ACCOUNT_URL}${path}`, { method: init.method ?? 'GET', headers, body })
    if (res.status === 401 && init.auth !== false && s && memorySession?.token === s.token) setSession(null) // 세션 만료: 로그아웃 상태로
    if (init.wantBlob && res.ok) return { status: res.status, body: null, blob: await res.blob() }
    let parsed: Record<string, unknown> | null = null
    try {
      parsed = (await res.json()) as Record<string, unknown>
    } catch {
      /* 본문 없음 */
    }
    return { status: res.status, body: parsed }
  } catch {
    return { status: 0, body: null }
  }
}

const NETWORK_MSG = '서버에 연결하지 못했어요. 인터넷 연결을 확인하고 다시 시도해 주세요.'
const NETWORK: AuthResult = { ok: false, code: 'network', message: NETWORK_MSG }

function checkInput(name: string, pin: string): AuthResult | null {
  const n = name.trim()
  if (n.length < 1 || n.length > 10 || !/^[가-힣ㄱ-ㅎㅏ-ㅣA-Za-z0-9 ]+$/.test(n)) return { ok: false, code: 'bad_input', message: '이름은 한글·영문·숫자·공백으로 1~10자로 적어 주세요.' }
  if (!/^\d{4}$/.test(pin)) return { ok: false, code: 'bad_input', message: '비밀번호는 숫자 4자리예요.' }
  return null
}

async function auth(path: '/auth/signup' | '/auth/login', name: string, pin: string): Promise<AuthResult> {
  const bad = checkInput(name, pin)
  if (bad) return bad
  useAccount.setState({ status: 'loading' })
  const r = await apiCall(path, { method: 'POST', json: { name: name.trim(), pin }, auth: false })
  const b = r.body as { ok?: boolean; code?: string; message?: string; token?: string; user?: AccountUser } | null
  if (r.status === 200 && b?.ok && typeof b.token === 'string' && b.user) {
    clearSyncedPrefs() // 이전 사람의 설정이 남지 않게 비우고, 서버의 이 계정 설정으로 복원한다(없으면 빈 상태)
    setSession({ token: b.token, user: { id: b.user.id, name: b.user.name, role: b.user.role } })
    return { ok: true, user: b.user }
  }
  useAccount.setState({ status: 'ready' })
  if (r.status === 0 || !b) return NETWORK
  const code = b.code === 'taken' || b.code === 'locked' || b.code === 'bad_input' || b.code === 'invalid' ? b.code : 'network'
  return { ok: false, code, message: b.message ?? NETWORK_MSG }
}

export const signUp = (name: string, pin: string) => auth('/auth/signup', name, pin)
export const logIn = (name: string, pin: string) => auth('/auth/login', name, pin)

// 로그아웃: 서버 세션을 지우고, 이 기기에 남은 동기화 설정(초기 설정·글자 크기 등)도 지워 다음 사람에게 넘어가지 않게 한다.
export async function logOut(): Promise<void> {
  const s = memorySession
  if (s) await apiCall('/auth/logout', { method: 'POST' })
  setSession(null)
  clearSyncedPrefs()
}

function clearSyncedPrefs() {
  try {
    for (const k of SYNCED_PREF_KEYS) localStorage.removeItem(k)
  } catch {
    /* 무시 */
  }
  reapplyPrefs() // 화면(글자 크기·화면 색·보기 방식)도 비운 값에 맞춘다
}

// 앱을 열 때 저장된 세션이 아직 유효한지 확인한다(오프라인이면 그대로 둔다).
async function verifySession() {
  const s = memorySession
  if (!s) return
  const r = await apiCall('/auth/me')
  const b = r.body as { ok?: boolean; user?: AccountUser } | null
  if (r.status === 200 && b?.ok && b.user && memorySession?.token === s.token) setSession({ token: s.token, user: { id: b.user.id, name: b.user.name, role: b.user.role } })
  else if (memorySession?.token === s.token) useAccount.setState({ status: 'ready' })
}
if (typeof window !== 'undefined') void verifySession()
