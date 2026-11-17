// 방금 한 일이 로그인인지 가입인지(접속 기록의 종류 표시용). api.ts가 적고 activity.ts가 한 번 읽어 간다.
export type AuthKind = 'login' | 'signup'
let kind: AuthKind | null = null
export const setAuthKind = (k: AuthKind) => {
  kind = k
}
export const takeAuthKind = (): AuthKind | null => {
  const k = kind
  kind = null
  return k
}
