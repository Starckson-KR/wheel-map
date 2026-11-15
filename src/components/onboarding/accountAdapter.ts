// 계정 모듈(src/lib/account/*)과의 연결부. 그 파일이 아직 없어도 빌드되도록 import.meta.glob로 있을 때만 붙는다.
// 계약: signUp(name,pin), logIn(name,pin), logOut(), getSession(), useAccount() → {user, status}
import type { AuthCode } from './flow'

export type AccountUser = { id: string; name: string }
export type AuthResult = { ok: true; user: AccountUser } | { ok: false; code: AuthCode; message?: string }
type AccountApi = {
  signUp: (name: string, pin: string) => Promise<AuthResult>
  logIn: (name: string, pin: string) => Promise<AuthResult>
  logOut: () => unknown
  useAccount: () => { user: AccountUser | null; status?: string }
}

const mods = import.meta.glob('../../lib/account/api.ts', { eager: true }) as Record<string, Partial<AccountApi>>
function pick<K extends keyof AccountApi>(k: K): AccountApi[K] | undefined {
  for (const m of Object.values(mods)) if (typeof m[k] === 'function') return m[k] as AccountApi[K]
  return undefined
}

const real = { signUp: pick('signUp'), logIn: pick('logIn'), logOut: pick('logOut'), useAccount: pick('useAccount') }
/** 계정 모듈이 연결돼 있는지(없으면 가입·로그인은 network 오류로 처리) */
export const accountConnected = Boolean(real.signUp && real.logIn && real.useAccount)

const fail: AuthResult = { ok: false, code: 'network' }
export const signUp = (n: string, p: string): Promise<AuthResult> => (real.signUp ? real.signUp(n, p) : Promise.resolve(fail))
export const logIn = (n: string, p: string): Promise<AuthResult> => (real.logIn ? real.logIn(n, p) : Promise.resolve(fail))
export const logOut = async () => {
  await Promise.resolve(real.logOut?.())
}
const noAccount = () => ({ user: null as AccountUser | null, status: 'out' })
const useHook = real.useAccount ?? noAccount
/** 저장된 세션이 있으면 user가 처음부터 채워져 있고, 세션 확인이 끝나기 전에도 그대로 쓴다(만료되면 user가 null이 되어 게이트가 다시 열린다). */
export function useGateAccount(): { user: AccountUser | null } {
  const a = useHook()
  return { user: a.user }
}
