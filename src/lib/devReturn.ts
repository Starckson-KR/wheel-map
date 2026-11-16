// 개발자 관리에서 신고를 열었다가 뒤로 가면 설정 시트의 개발자 관리(같은 탭)를 다시 열어 주기 위한 표시.
// 브라우저 기록 항목(history.state)에 적는다. 뒤로가기로 돌아온 그 항목에만 남고, 하단 탭으로 새로 들어온 홈에는 없다.
export type DevReturnTab = 'users' | 'reports'

const KEY = 'wmDevAdminReturn'
type Hist = Pick<History, 'state' | 'replaceState'>

const asObj = (s: unknown): Record<string, unknown> => (typeof s === 'object' && s !== null ? (s as Record<string, unknown>) : {})

export function markDevReturn(tab: DevReturnTab, h: Hist = history) {
  try {
    h.replaceState({ ...asObj(h.state), [KEY]: tab }, '')
  } catch {
    /* 기록을 못 바꾸면 그냥 되돌아가지 않는다 */
  }
}

export function readDevReturn(h: Hist = typeof history === 'undefined' ? ({ state: null, replaceState: () => {} } as Hist) : history): DevReturnTab | null {
  const v = asObj(h.state)[KEY]
  return v === 'users' || v === 'reports' ? v : null
}

export function clearDevReturn(h: Hist = history) {
  const s = asObj(h.state)
  if (!(KEY in s)) return
  const { [KEY]: _drop, ...rest } = s
  void _drop
  try {
    h.replaceState(Object.keys(rest).length ? rest : null, '')
  } catch {
    /* 무시 */
  }
}
