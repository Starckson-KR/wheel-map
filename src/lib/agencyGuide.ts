import agenciesData from '../../data/seed/agencies.json'
import { BUKGU_OLD_CHANNEL_END, DEADLINE_FALLBACK_DAYS } from './config'

// 소관 기관 안내. 데이터는 data/seed/agencies.json(docs/소관기관_접수안내_조사.md 기준)에서만 읽는다.
// 부서명·조문·기한은 이 파일에 새로 적지 않는다. 값이 비었거나 TODO면 "확인 필요"로 보여 준다.

export type Agency = {
  id: string
  name: string
  level: string
  department: string
  types: string[]
  locationKinds: string[]
  channel: string[]
  legalBasis: { law: string; article: string }[]
  deadlineDays?: number
  phone?: string
  sourceUrl: string
  verified: boolean
  note: string
}

const AGENCIES = agenciesData as unknown as Agency[]
const CHANNELS = AGENCIES.filter((a) => a.id.startsWith('channel-'))

// 조사 문서의 위치 성격 분류(제보·검증 때 고른다). 이름은 agencies.json locationKinds의 괄호 앞 표기와 같다.
export const LOCATION_KINDS = [
  '구·시 도로의 보도',
  '버스정류장',
  '횡단보도·신호',
  '공공건물 출입',
  '민간 건물 출입',
  '대학 캠퍼스 내부',
  '공원',
  '공사 현장',
] as const
export type LocationKind = (typeof LOCATION_KINDS)[number]

// 지점 종류 문구로 위치 성격의 처음 선택값만 추정한다(사용자가 바꿀 수 있음).
export function guessLocationKind(t: string): string {
  if (t.includes('정류장')) return '버스정류장'
  if (t.includes('횡단보도')) return '횡단보도·신호'
  if (t.includes('쪽문')) return '대학 캠퍼스 내부'
  if (t.includes('기관')) return '공공건물 출입'
  if (t.includes('보도')) return '구·시 도로의 보도'
  return ''
}

const base = (s: string) => s.split('(')[0].trim()

export type AgencyMatch = { agency: Agency; candidate: boolean; condition?: string }

export function findAgencies(type: string, kind: string): AgencyMatch[] {
  const out: AgencyMatch[] = []
  for (const a of AGENCIES) {
    if (a.id.startsWith('channel-') || a.types.length === 0) continue
    if (!a.types.includes(type) || !a.locationKinds.some((k) => base(k) === kind)) continue
    out.push({
      agency: a,
      candidate: !a.verified,
      ...(a.id === 'city-comprehensive-construction' ? { condition: '도로 계획폭이 20m 이상인 경우(시 사무위임 조례 별표 3 도로과 1호)' } : {}),
    })
  }
  // 확인된 기관을 앞에, 같은 경우 구 → 시 → 그 밖의 순
  const rank = (m: AgencyMatch) => (m.candidate ? 10 : 0) + (m.agency.level === '구' ? 0 : m.agency.level === '시' ? 1 : 2)
  return out.sort((x, y) => rank(x) - rank(y))
}

export type ChannelLink = { label: string; url?: string; text?: string }

const URLS = {
  safety: 'https://www.safetyreport.go.kr/#safereport/safereport',
  epeople: 'https://www.epeople.go.kr/nep/pttn/gnrlPttn/PttnRqstWrtnInfo.paid',
  c120: 'https://120.jeonnam-gwangju.go.kr/mainPage.do',
  bukguOld: 'https://bukgu.gwangju.kr/menu.es?mid=a10103130100',
  bukguCivil: 'https://bukgu.gwangju.kr/menu.es?mid=a10102080000',
}

// 접수 채널 안내. 북구 주민생활불편신고는 2026-11-01부터 3채널(국민신문고·바로문자 365·콜센터)로 바뀐다.
export function channelLinks(agencies: Agency[], nowMs: number): ChannelLink[] {
  const names = new Set<string>()
  for (const a of agencies) for (const c of a.channel) names.add(c)
  const afterCutover = nowMs >= new Date(BUKGU_OLD_CHANNEL_END).getTime()
  const out: ChannelLink[] = []
  const push = (l: ChannelLink) => {
    if (!out.some((o) => o.label === l.label)) out.push(l)
  }
  for (const c of names) {
    if (c.startsWith('안전신문고')) push({ label: '안전신문고', url: URLS.safety })
    else if (c.startsWith('국민신문고')) push({ label: '국민신문고', url: URLS.epeople })
    else if (c.startsWith('120')) push({ label: '120 빛고을콜센터', url: URLS.c120 })
    else if (c.startsWith('북구 주민생활불편신고')) {
      if (afterCutover) {
        const info = CHANNELS.find((a) => a.id === 'channel-bukgu-inconvenience')
        push({ label: '국민신문고', url: URLS.epeople })
        push({ label: '북구청장 바로문자 365·생활불편신고 콜센터', text: info ? info.channel.slice(1).join(' / ') : '확인 필요' })
      } else push({ label: '북구 주민생활불편신고(2026-10-31 종료)', url: URLS.bukguOld })
    } else if (c.startsWith('북구청 누리집')) push({ label: '북구청 누리집 민원', url: URLS.bukguCivil })
    else if (c.startsWith('TODO')) push({ label: '접수 창구', text: '확인 필요' })
    else push({ label: c, text: '직접 요청 또는 해당 기관 안내를 따릅니다.' })
  }
  return out
}

export type Deadline = { days: number; basis: string }

// 처리기한: 소관 기관 자료의 deadlineDays가 있으면 그 값, 없으면 조사 문서의 일반 상한(안전신문고 7일 또는 14일, 건의민원 14일).
export function deadlineFor(agencies: Agency[]): Deadline {
  for (const a of agencies) if (a.deadlineDays) return { days: a.deadlineDays, basis: `${a.name} 자료 기준` }
  return { days: DEADLINE_FALLBACK_DAYS, basis: '일반 기준(안전신문고 보통 7일 또는 14일, 민원 처리에 관한 법률 시행령 제15조 건의민원 14일 — 기관별 개별 기한은 확인 필요)' }
}

export function legalLines(a: Agency): string[] {
  return a.legalBasis.filter((l) => !l.law.startsWith('TODO') && !l.article.startsWith('TODO')).map((l) => `${l.law} ${l.article}`)
}
export const hasTodoLaw = (a: Agency) => a.legalBasis.length === 0 || a.legalBasis.some((l) => l.law.startsWith('TODO') || l.article.startsWith('TODO'))

// 행정 화면용: 처리 기관 목록(채널 항목과 유형이 비어 있는 항목은 제외).
export const listAgencies = (): Agency[] => AGENCIES.filter((a) => !a.id.startsWith('channel-') && a.types.length > 0)
export const agencyById = (id: string) => AGENCIES.find((a) => a.id === id)
