// 서버 확인 주기 계산(순수 함수). 화면을 쓰는 중에는 짧게, 한참 만지지 않으면 길게, 실패하면 점점 늘린다.
export const POLL_ACTIVE_MS = 4000 // 화면을 쓰는 중
export const POLL_IDLE_MS = 15000 // 1분 넘게 만지지 않았을 때
export const IDLE_AFTER_MS = 60000
export const BACKOFF_MAX_MS = 60000

/** fails: 연속 실패 횟수, idleMs: 마지막으로 만진 뒤 지난 시간, rand: 0~1(흔들기, 시험할 때 고정) */
export function nextDelay(fails: number, idleMs: number, rand = 0.5): number {
  const base = idleMs >= IDLE_AFTER_MS ? POLL_IDLE_MS : POLL_ACTIVE_MS
  const grown = fails > 0 ? Math.min(BACKOFF_MAX_MS, base * 2 ** Math.min(fails, 6)) : base
  const jitter = 1 + (rand - 0.5) * 0.2 // ±10%: 여러 기기가 같은 순간에 몰리지 않게
  return Math.round(grown * jitter)
}
