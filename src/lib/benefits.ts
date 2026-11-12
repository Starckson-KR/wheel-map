// 나에게 맞는 혜택·행사: 순수 함수(필터·분류·기간 만료·설정 저장). 데이터 파일은 benefitsData.ts가 불러온다.
// 맞춤은 단순 분류 일치만 쓴다. 자격 판정이나 숨은 추론은 하지 않는다.
export type BenefitCategory = 'mobility' | 'device' | 'welfare' | 'culture'
export type WheelchairUse = 'user' | 'companion' | 'none'

export type BenefitPeriod = { type: 'always' } | { type: 'unknown' } | { type: 'range'; start?: string; end?: string }

export type Benefit = {
  id: string
  title: string
  summary: string
  category: BenefitCategory
  target: string
  wheelchairRelevant: boolean | null
  area: string
  period: BenefitPeriod
  agency: string
  contact: string
  sourceName: string
  sourceUrl: string
  confirmedAt: string
  status: '확인됨' | '확인 필요'
  unknowns: string[]
}

export type BenefitPrefs = { wheelchair: WheelchairUse; topics: BenefitCategory[] }

export const CATEGORIES: { id: BenefitCategory; label: string }[] = [
  { id: 'mobility', label: '이동' },
  { id: 'device', label: '보조기기' },
  { id: 'welfare', label: '복지' },
  { id: 'culture', label: '문화·행사' },
]
export const categoryLabel = (c: BenefitCategory) => CATEGORIES.find((x) => x.id === c)?.label ?? c

export const DEFAULT_PREFS: BenefitPrefs = { wheelchair: 'none', topics: [] }
export const PREFS_KEY = 'wheelmap.benefitPrefs'

export const hasPrefs = (p: BenefitPrefs) => p.wheelchair !== 'none' || p.topics.length > 0

// 'YYYY-MM-DD' (한국 시간대가 아니라 기기의 날짜)
export function dayOf(ms: number): string {
  const d = new Date(ms)
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${d.getFullYear()}-${m}-${day}`
}

// 종료일이 지난 항목은 지난 것. 종료일 당일은 아직 유효하다.
export function isExpired(b: Benefit, nowMs: number): boolean {
  const p = b.period
  return p.type === 'range' && !!p.end && p.end < dayOf(nowMs)
}

export function visibleBenefits(all: Benefit[], nowMs: number): Benefit[] {
  return all.filter((b) => !isExpired(b, nowMs))
}

// 설정과 맞는 정도(0이면 맞지 않음). 분류 일치 2점, 휠체어 관련 항목 1점(이용함·동행 선택 시).
export function matchScore(b: Benefit, prefs: BenefitPrefs): number {
  let s = 0
  if (prefs.topics.includes(b.category)) s += 2
  if (prefs.wheelchair !== 'none' && b.wheelchairRelevant === true) s += 1
  return s
}

export type BenefitView = {
  prefsSet: boolean
  // 설정에 맞는 항목(점수 높은 순, 같으면 원래 순서). 설정이 없으면 비어 있음
  matched: Benefit[]
  // 나머지(설정이 없으면 전체). 분류 순서대로 묶음
  groups: { category: BenefitCategory; items: Benefit[] }[]
}

export function groupByCategory(items: Benefit[]): { category: BenefitCategory; items: Benefit[] }[] {
  return CATEGORIES.map((c) => ({ category: c.id, items: items.filter((b) => b.category === c.id) })).filter((g) => g.items.length > 0)
}

export function buildView(all: Benefit[], prefs: BenefitPrefs, nowMs: number): BenefitView {
  const shown = visibleBenefits(all, nowMs)
  if (!hasPrefs(prefs)) return { prefsSet: false, matched: [], groups: groupByCategory(shown) }
  const scored = shown.map((b, i) => ({ b, i, s: matchScore(b, prefs) }))
  const matched = scored.filter((x) => x.s > 0).sort((a, c) => c.s - a.s || a.i - c.i).map((x) => x.b)
  const rest = scored.filter((x) => x.s === 0).map((x) => x.b)
  return { prefsSet: true, matched, groups: groupByCategory(rest) }
}

// 홈 소식에 보일 개수: 설정이 있으면 맞는 항목 수, 없으면 보이는 전체 수
export function homeCount(all: Benefit[], prefs: BenefitPrefs, nowMs: number): { count: number; personal: boolean } {
  const v = buildView(all, prefs, nowMs)
  return v.prefsSet ? { count: v.matched.length, personal: true } : { count: visibleBenefits(all, nowMs).length, personal: false }
}

// 데이터 검증: 출처 URL·확인일 등 필수 칸이 비면 문제 목록을 돌려준다.
export function validateBenefits(items: Benefit[]): string[] {
  const errs: string[] = []
  const ids = new Set<string>()
  const cats = new Set(CATEGORIES.map((c) => c.id))
  for (const b of items) {
    const w = `[${b.id ?? '?'}]`
    if (!b.id) errs.push(`${w} id 없음`)
    else if (ids.has(b.id)) errs.push(`${w} id 중복`)
    ids.add(b.id)
    if (!b.title?.trim()) errs.push(`${w} 제목 없음`)
    if (!b.summary?.trim()) errs.push(`${w} 요약 없음`)
    if (!cats.has(b.category)) errs.push(`${w} 분류가 올바르지 않음`)
    if (!/^https:\/\/[^\s]+$/.test(b.sourceUrl ?? '')) errs.push(`${w} 출처 URL이 없거나 https가 아님`)
    if (!/^\d{4}-\d{2}-\d{2}$/.test(b.confirmedAt ?? '')) errs.push(`${w} 확인일 형식이 올바르지 않음`)
    if (!b.sourceName?.trim()) errs.push(`${w} 출처 이름 없음`)
    if (!b.agency?.trim()) errs.push(`${w} 신청·문의처 이름 없음`)
    if (!b.target?.trim()) errs.push(`${w} 대상 칸이 비었음('확인 필요'로 적기)`)
    if (b.status !== '확인됨' && b.status !== '확인 필요') errs.push(`${w} 상태 값이 올바르지 않음`)
    const p = b.period
    if (!p || !['always', 'unknown', 'range'].includes(p.type)) errs.push(`${w} 기간 형식 오류`)
    else if (p.type === 'range' && !p.end && !p.start) errs.push(`${w} 기간 범위에 날짜 없음`)
  }
  return errs
}

// ───── 설정 저장: 이 기기(localStorage) 한 키에만. 서버로 보내지 않는다. ─────
export function parsePrefs(raw: string | null): BenefitPrefs {
  if (!raw) return { ...DEFAULT_PREFS }
  try {
    const o = JSON.parse(raw) as Partial<BenefitPrefs>
    const wheelchair: WheelchairUse = o.wheelchair === 'user' || o.wheelchair === 'companion' ? o.wheelchair : 'none'
    const topics = (Array.isArray(o.topics) ? o.topics : []).filter((t): t is BenefitCategory => CATEGORIES.some((c) => c.id === t))
    return { wheelchair, topics: [...new Set(topics)] }
  } catch {
    return { ...DEFAULT_PREFS }
  }
}

export function loadPrefs(): BenefitPrefs {
  try {
    return parsePrefs(localStorage.getItem(PREFS_KEY))
  } catch {
    return { ...DEFAULT_PREFS }
  }
}
export function savePrefs(p: BenefitPrefs) {
  try {
    if (hasPrefs(p)) localStorage.setItem(PREFS_KEY, JSON.stringify(p))
    else localStorage.removeItem(PREFS_KEY)
  } catch {
    /* 저장이 막혀도 이번 화면에는 적용된다 */
  }
}
export function clearPrefs() {
  try {
    localStorage.removeItem(PREFS_KEY)
  } catch {
    /* 무시 */
  }
}

export const periodText = (b: Benefit): string => {
  const p = b.period
  if (p.type === 'always') return '상시'
  if (p.type === 'unknown') return '기간 확인 필요'
  const f = (d?: string) => (d ? `${Number(d.slice(5, 7))}월 ${Number(d.slice(8, 10))}일` : '')
  if (p.start && p.end) return p.start === p.end ? f(p.end) : `${f(p.start)}부터 ${f(p.end)}까지`
  return p.end ? `${f(p.end)}까지` : `${f(p.start)}부터`
}
