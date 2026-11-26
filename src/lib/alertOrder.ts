// 혜택알림 · 알림 목록 순서(순수 함수).
// 규칙: 최신이 위(때가 왼쪽 줄로 이어지는 목록이라 실제·체험을 가르지 않는다).
// 때는 글자 비교가 아니라 실제 시각으로 견준다(시간대 표기가 섞여도 순서가 틀어지지 않게).
export type Orderable = { at: string; mock?: boolean }

const ms = (iso: string): number => {
  const t = new Date(iso).getTime()
  return Number.isNaN(t) ? 0 : t
}

/**
 * 같은 제보의 같은 일을 알리는 상태 알림과 점수 알림을 한 줄로 합친다(순수 함수).
 * 둘이 같은 일이라는 근거는 자료에 있는 짝 표지(pair: 제보 번호 + 일 + 때)가 같은 것뿐이다. 문장을 견주어 짐작하지 않는다.
 * 상태 알림(kind 'report')이 남고 점수 알림(kind 'points')의 점수가 거기에 붙는다. 짝이 없으면 그대로 둔다.
 */
export type Pairable = { kind: 'report' | 'points'; points?: number; pair?: string }

export function mergePairedAlerts<T extends Pairable>(list: readonly T[]): T[] {
  const scoreOf = new Map<string, number>()
  for (const x of list) if (x.kind === 'points' && x.pair && x.points) scoreOf.set(x.pair, x.points)
  const statusPairs = new Set(list.filter((x) => x.kind === 'report' && x.pair).map((x) => x.pair as string))
  const out: T[] = []
  for (const x of list) {
    if (x.kind === 'points' && x.pair && statusPairs.has(x.pair)) continue // 상태 알림 줄에 합쳐졌다
    if (x.kind === 'report' && x.pair && scoreOf.has(x.pair)) out.push({ ...x, points: scoreOf.get(x.pair) })
    else out.push(x)
  }
  return out
}

export function sortAlerts<T extends Orderable>(list: readonly T[]): T[] {
  return list
    .map((x, i) => ({ x, i, t: ms(x.at) }))
    .sort((a, b) => b.t - a.t || a.i - b.i)
    .map((o) => o.x)
}
