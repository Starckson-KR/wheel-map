// 혜택알림 · 알림 목록 순서(순수 함수).
// 규칙: 최신이 위(때가 왼쪽 줄로 이어지는 목록이라 실제·체험을 가르지 않는다).
// 때는 글자 비교가 아니라 실제 시각으로 견준다(시간대 표기가 섞여도 순서가 틀어지지 않게).
export type Orderable = { at: string; mock?: boolean }

const ms = (iso: string): number => {
  const t = new Date(iso).getTime()
  return Number.isNaN(t) ? 0 : t
}

export function sortAlerts<T extends Orderable>(list: readonly T[]): T[] {
  return list
    .map((x, i) => ({ x, i, t: ms(x.at) }))
    .sort((a, b) => b.t - a.t || a.i - b.i)
    .map((o) => o.x)
}
