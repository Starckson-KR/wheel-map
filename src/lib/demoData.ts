import type { Barrier, Rating, Report, ReportStatus } from '../types'
import { DAY } from './caseMetrics'
import { deadlineFor, findAgencies } from './agencyGuide'

// 발표용 "시연 데이터 채우기": 팀 조사 지점 여러 곳에 다양한 상태의 민원을 만든다(모두 demo: true).
// 기관명은 agencies.json 그대로 쓰고, 처리 메모에는 "(시연)"을 붙인다. 시드 파일은 수정하지 않는다.

type Step = { status: ReportStatus; daysAgo: number; by: string; memo: string }
type Spec = {
  owner: string // 제보한 시연 사용자(시민 A·B·C에 나눠 리워드가 각자 다르게 보이게 한다)
  seedId: string
  type: string
  kind: string
  submittedDaysAgo: number
  steps: Step[] // 접수 이후 단계(오래된 순)
  transfer?: { toAgencyId: string; reason: string; daysAgo: number; decision?: 'accepted' | 'rejected' }
  recheckPass?: boolean
  tag?: string // 같은 지점에 건이 둘 이상일 때 접수번호 뒤에 붙인다(예: R19-2)
  note?: string // 설명 문구(없으면 지점 이름)
}

const S = (status: ReportStatus, daysAgo: number, by: string, memo: string): Step => ({ status, daysAgo, by, memo: `(시연) ${memo}` })

const SPECS: Spec[] = [
  { owner: 'citizen-a', seedId: 'R16', type: '파손 노면', kind: '버스정류장', submittedDaysAgo: 20, steps: [] },
  { owner: 'citizen-b', seedId: 'B02', type: '계단·턱', kind: '버스정류장', submittedDaysAgo: 5, steps: [S('assigned', 4, 'officer', '기관 배정 확인')] },
  { owner: 'citizen-c', seedId: 'R17', type: '계단·턱', kind: '횡단보도·신호', submittedDaysAgo: 9, steps: [S('assigned', 8, 'officer', '기관 배정 확인'), S('in_progress', 6, 'officer', '현장 확인·조치 시작')] },
  { owner: 'citizen-c', seedId: 'W-C', type: '좁은 보도', kind: '구·시 도로의 보도', submittedDaysAgo: 70, steps: [S('assigned', 68, 'officer', '기관 배정 확인'), S('in_progress', 60, 'officer', '현장 확인·조치 시작')] },
  {
    owner: 'citizen-a', seedId: 'R19',
    type: '파손 노면',
    kind: '대학 캠퍼스 내부',
    submittedDaysAgo: 40,
    steps: [S('assigned', 38, 'officer', '기관 배정 확인'), S('in_progress', 35, 'officer', '현장 확인·조치 시작'), S('resolved', 25, 'officer', '판석 균열 부분을 정비했습니다'), S('rechecked', 20, 'citizen-b', '재확인: 실제로 통과 가능')],
    recheckPass: true,
  },
  {
    // 재발 사례: R19는 위에서 재확인까지 끝난 지점이다. 그 뒤 같은 곳에 같은 유형으로 다시 접수된 건.
    owner: 'citizen-b', seedId: 'R19', tag: '2',
    type: '파손 노면',
    kind: '대학 캠퍼스 내부',
    submittedDaysAgo: 3,
    steps: [S('assigned', 2, 'officer', '기관 배정 확인')],
    note: '(시연) 정비했던 판석 주변에 다시 균열',
  },
  {
    owner: 'citizen-a', seedId: 'B03',
    type: '파손 노면',
    kind: '버스정류장',
    submittedDaysAgo: 12,
    steps: [S('assigned', 11, 'officer', '기관 배정 확인'), S('in_progress', 8, 'officer', '현장 확인·조치 시작'), S('resolved', 2, 'officer', '정류장 진입 노면을 보수했습니다')],
  },
  { owner: 'citizen-b', seedId: 'R18', type: '쓰레기', kind: '구·시 도로의 보도', submittedDaysAgo: 1, steps: [] },
  {
    owner: 'citizen-c', seedId: 'N01',
    type: '불법 주정차',
    kind: '구·시 도로의 보도',
    submittedDaysAgo: 6,
    steps: [S('assigned', 5, 'officer', '기관 배정 확인')],
    transfer: { toAgencyId: 'bukgu-geonseol-admin', reason: '(시연) 불법 주정차가 아니라 노상 적치물 단속 사안으로 보여 이관을 요청합니다', daysAgo: 1 },
  },
  {
    owner: 'citizen-b', seedId: 'R15-1',
    type: '계단·턱',
    kind: '버스정류장',
    submittedDaysAgo: 15,
    steps: [S('assigned', 14, 'officer', '기관 배정 확인')],
    transfer: { toAgencyId: 'city-bus-stop', reason: '(시연) 정류장 시설은 시 대중교통 담당 소관으로 판단되어 이관합니다', daysAgo: 10, decision: 'accepted' },
  },
]

export function buildDemoReports(seeds: Barrier[], now: number, newId: () => string): Report[] {
  const byId = new Map(seeds.map((b) => [b.id, b]))
  const out: Report[] = []
  for (const sp of SPECS) {
    const b = byId.get(sp.seedId)
    if (!b?.geometry) continue
    const g = b.geometry
    const at0 = g.kind === 'point' ? g.at : g.path[0]
    const rating: Rating | undefined = b.rating ?? (b.parentId ? byId.get(b.parentId)?.rating : undefined)
    const matches = findAgencies(sp.type, sp.kind)
    const agencyIds = matches.map((m) => m.agency.id)
    const dl = deadlineFor(matches.map((m) => m.agency))
    const iso = (daysAgo: number) => new Date(now - daysAgo * DAY).toISOString()
    const submittedAt = iso(sp.submittedDaysAgo)
    const history: Report['history'] = [
      { status: 'verified', at: submittedAt, by: sp.owner, memo: '(시연) 팀 현장조사 지점에서 시작(검증 완료로 간주)' },
      { status: 'filed', at: submittedAt, by: sp.owner, memo: `(시연) 안전신문고 접수번호 DEMO-SIM-${sp.seedId}${sp.tag ? '-' + sp.tag : ''}` },
    ]
    let status: ReportStatus = 'filed'
    for (const st of sp.steps) {
      history.push({ status: st.status, at: iso(st.daysAgo), by: st.by, memo: st.memo, ...(st.status === 'rechecked' ? { passable: !!sp.recheckPass } : {}) })
      status = st.status
    }
    const resolvedStep = sp.steps.find((s) => s.status === 'resolved')
    const r: Report = {
      id: newId(),
      seedId: sp.seedId,
      demo: true,
      userId: sp.owner,
      createdAt: submittedAt,
      lat: at0[0],
      lng: at0[1],
      type: sp.type,
      category: ['쓰레기', '킥보드·자전거', '입간판·노점', '공사 자재', '불법 주정차'].includes(sp.type) ? 'temporary' : 'fixed',
      photos: [],
      description: sp.note ?? `(시연) 팀 현장조사 지점 ${b.id} · ${b.name}`,
      locationKind: sp.kind,
      status,
      verification: { votes: 0, voterIds: [], verifierId: 'team-survey', result: 'confirmed', ...(sp.recheckPass ? { rating: 'O' as Rating } : rating ? { rating } : {}) },
      history,
      complaint: {
        channel: '안전신문고',
        receiptNo: `DEMO-SIM-${sp.seedId}${sp.tag ? '-' + sp.tag : ''}`,
        submittedAt,
        mode: 'mock',
        agencyIds,
        assignedAgencyId: sp.steps.some((s) => s.status === 'assigned') ? agencyIds[0] : undefined,
        deadlineDays: dl.days,
      },
      ...(resolvedStep
        ? {
            action: {
              description: resolvedStep.memo,
              beforePhotos: [],
              afterPhotos: [],
              doneAt: iso(resolvedStep.daysAgo),
              ...(sp.recheckPass ? { recheck: { passable: true, at: iso(20), by: 'citizen-b' } } : {}),
            },
            lastCheckedAt: iso(sp.recheckPass ? 20 : resolvedStep.daysAgo),
          }
        : {}),
    }
    if (sp.transfer && agencyIds[0]) {
      const t = sp.transfer
      r.transfers = [
        {
          fromAgencyId: agencyIds[0],
          toAgencyId: t.toAgencyId,
          reason: t.reason,
          at: iso(t.daysAgo),
          by: 'officer',
          status: t.decision ?? 'requested',
          ...(t.decision ? { decidedAt: iso(t.daysAgo - 1 < 0 ? 0 : t.daysAgo - 1), decidedBy: 'officer' } : {}),
        },
      ]
      r.history.push({ status, at: iso(t.daysAgo), by: 'officer', memo: `(시연) 이관 요청: ${t.reason}` })
      if (t.decision === 'accepted' && r.complaint) {
        r.complaint.assignedAgencyId = t.toAgencyId
        r.history.push({ status, at: iso(t.daysAgo - 1 < 0 ? 0 : t.daysAgo - 1), by: 'officer', memo: '(시연) 이관 수락' })
      }
    }
    out.push(r)
  }
  return out
}
