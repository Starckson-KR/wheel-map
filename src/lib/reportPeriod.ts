// 보고서 기간(달력 분기·연간). 시각은 모두 ms(지역 시간 기준), to는 포함하지 않는다.
export type PeriodChoice = 1 | 2 | 3 | 4 | 'year'

export type PeriodRange = { year: number; choice: PeriodChoice; from: number; to: number; label: string }

export const CHOICE_LABEL: Record<string, string> = { '1': '1분기', '2': '2분기', '3': '3분기', '4': '4분기', year: '연간' }

export function periodRange(year: number, choice: PeriodChoice): PeriodRange {
  const m0 = choice === 'year' ? 0 : (choice - 1) * 3
  const m1 = choice === 'year' ? 12 : m0 + 3
  return {
    year,
    choice,
    from: new Date(year, m0, 1).getTime(),
    to: new Date(year, m1, 1).getTime(), // 12월이면 다음 해 1월 1일
    label: `${year}년 ${CHOICE_LABEL[String(choice)]}`,
  }
}

// 바로 앞 기간: 1분기 → 지난해 4분기, 연간 → 지난해
export function previousRange(p: PeriodRange): PeriodRange {
  if (p.choice === 'year') return periodRange(p.year - 1, 'year')
  if (p.choice === 1) return periodRange(p.year - 1, 4)
  return periodRange(p.year, (p.choice - 1) as PeriodChoice)
}

export function quarterOf(ms: number): { year: number; choice: 1 | 2 | 3 | 4 } {
  const d = new Date(ms)
  return { year: d.getFullYear(), choice: (Math.floor(d.getMonth() / 3) + 1) as 1 | 2 | 3 | 4 }
}

// 아직 끝나지 않은 기간이면 true
export const isOngoing = (p: PeriodRange, now: number) => now < p.to
export const inRange = (ms: number, p: PeriodRange) => ms >= p.from && ms < p.to
