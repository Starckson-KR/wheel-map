import { create } from 'zustand'
import type { Barrier, ExternalStage, Rating, Report, ReportCategory, ReportStatus } from '../types'
import { COMPLAINT_MODE, TEMP_VALID_HOURS, VOTES_REQUIRED, canVerifierConfirm, canVote, type ComplaintMode } from './config'
import { clearPhotos } from './photoStore'
import { agencyOf, pendingTransfer } from './caseMetrics'
import { findAgencyName } from './agencyName'
import { buildDemoReports } from './demoData'
import { usePlan } from './planStore'

// 시연용 제보 저장소. 서버가 없으므로 제보 기록은 localStorage에 둔다(사진은 IndexedDB, photoStore.ts).
const KEY = 'wheelmap.reports'
const USER_KEY = 'wheelmap.demoUser'

export type DemoUser = { id: string; name: string; role: 'citizen' | 'verifier' | 'officer' }
export const DEMO_USERS: DemoUser[] = [
  { id: 'citizen-a', name: '시민 A', role: 'citizen' },
  { id: 'citizen-b', name: '시민 B', role: 'citizen' },
  { id: 'citizen-c', name: '시민 C', role: 'citizen' },
  { id: 'verifier', name: '검증자(동행 점검단)', role: 'verifier' },
  { id: 'officer', name: '담당 공무원(데모)', role: 'officer' },
]
const SYSTEM_NAMES: Record<string, string> = { 'mock-api': '모의 접수 API(시연)', 'team-survey': '팀 현장조사' }
export const userName = (id: string) => DEMO_USERS.find((u) => u.id === id)?.name ?? SYSTEM_NAMES[id] ?? id

export const STATUS_LABEL: Record<ReportStatus, string> = {
  submitted: '제보됨',
  pending: '검증 대기',
  merged: '합쳐짐',
  verified: '검증 완료',
  rejected: '반려됨',
  assigned: '기관 배정',
  filed: '민원 접수',
  in_progress: '조치 중',
  resolved: '조치 완료',
  rechecked: '재확인 완료',
}
const DONE: ReportStatus[] = ['merged', 'rejected', 'rechecked']
export const isDone = (s: ReportStatus) => DONE.includes(s)

const OFFSET_KEY = 'wheelmap.timeOffsetDays'

function loadOffset(): number {
  try {
    const v = Number(localStorage.getItem(OFFSET_KEY))
    return Number.isFinite(v) && v > 0 ? v : 0
  } catch {
    return 0
  }
}

// 앱 안의 현재 시각. 실제 시계는 그대로 두고, 시연용 "시간 앞당기기" 오프셋(일)만 더한다.
let offsetDays = loadOffset()
export const nowMs = () => Date.now() + offsetDays * 86400000

export function isExpired(r: Report, now = nowMs()) {
  return !!r.expiresAt && new Date(r.expiresAt).getTime() < now
}

function loadReports(): { reports: Report[]; error: string | null } {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return { reports: [], error: null }
    const v: unknown = JSON.parse(raw)
    if (!Array.isArray(v)) throw new Error('형식 오류')
    return { reports: v as Report[], error: null }
  } catch {
    return { reports: [], error: '저장된 제보를 불러오지 못했습니다. 브라우저 저장소 설정을 확인해 주세요.' }
  }
}

function loadUser(): string {
  try {
    const id = localStorage.getItem(USER_KEY)
    if (id && DEMO_USERS.some((u) => u.id === id)) return id
  } catch {
    /* 저장소를 못 써도 기본값으로 동작 */
  }
  return DEMO_USERS[0].id
}

export const newReportId = () => `r-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`

export type NewReport = {
  id: string
  lat: number
  lng: number
  type: string
  category: ReportCategory
  description: string
  photos: string[]
  measurements?: { widthM?: number; curbCm?: number }
  locationKind?: string
}

type Result = { ok: true } | { ok: false; message: string }

type State = {
  reports: Report[]
  userId: string
  storageError: string | null
  offsetDays: number
  complaintMode: ComplaintMode
  advanceDays: (n: number) => void
  setComplaintMode: (m: ComplaintMode) => void
  startSeedFlow: (seed: Barrier, type: string, locationKind: string, rating?: Rating) => Report
  fileComplaint: (id: string, c: NonNullable<Report['complaint']>, by?: string) => Result
  addExternalUpdate: (id: string, u: { stage: ExternalStage; at: string; agencyName?: string; memo?: string }, by?: string) => Result
  assign: (id: string, agencyId: string) => Result
  startAction: (id: string) => Result
  completeAction: (id: string, description: string, before: string[], after: string[]) => Result
  recheck: (id: string, passable: boolean) => Result
  requestTransfer: (id: string, toAgencyId: string, reason: string) => Result
  decideTransfer: (id: string, accept: boolean) => Result
  fillDemo: (seeds: Barrier[]) => number
  setUser: (id: string) => void
  addReport: (input: NewReport, mergeInto?: string) => Report
  vote: (id: string) => Result
  judge: (id: string, rating: Rating) => Result
  reject: (id: string, reason: string) => Result
  resetAll: () => Promise<string | null>
}

const initial = loadReports()

export const useReports = create<State>((set, get) => {
  const update = (id: string, fn: (r: Report) => Report) => set((s) => ({ reports: s.reports.map((r) => (r.id === id ? fn(r) : r)) }))
  const me = () => DEMO_USERS.find((u) => u.id === get().userId) ?? DEMO_USERS[0]
  const find = (id: string) => get().reports.find((r) => r.id === id)
  const log = (r: Report, status: ReportStatus, memo?: string, by?: string, passable?: boolean): Report => ({
    ...r,
    status,
    history: [...r.history, { status, at: new Date(nowMs()).toISOString(), by: by ?? me().id, ...(memo ? { memo } : {}), ...(passable === undefined ? {} : { passable }) }],
  })

  return {
    reports: initial.reports,
    userId: loadUser(),
    storageError: initial.error,
    offsetDays,
    complaintMode: COMPLAINT_MODE,

    setUser: (id) => set({ userId: id }),

    addReport: (input, mergeInto) => {
      const now = new Date(nowMs())
      const at = now.toISOString()
      const by = me().id
      const base: Report = {
        id: input.id,
        userId: by,
        createdAt: at,
        lat: input.lat,
        lng: input.lng,
        type: input.type,
        category: input.category,
        photos: input.photos,
        description: input.description,
        ...(input.locationKind ? { locationKind: input.locationKind } : {}),
        ...(input.measurements ? { measurements: input.measurements } : {}),
        ...(input.category === 'temporary' ? { expiresAt: new Date(now.getTime() + TEMP_VALID_HOURS * 3600 * 1000).toISOString() } : {}),
        status: 'submitted',
        verification: { votes: 0, voterIds: [] },
        history: [{ status: 'submitted', at, by }],
      }
      const r: Report = mergeInto
        ? { ...base, barrierId: mergeInto, status: 'merged', history: [...base.history, { status: 'merged', at, by, memo: `기존 건 ${mergeInto}에 합침` }] }
        : { ...base, status: 'pending', history: [...base.history, { status: 'pending', at, by, memo: '검증 대기' }] }
      set((s) => ({ reports: [...s.reports, r] }))
      return r
    },

    vote: (id) => {
      const u = me()
      const r = find(id)
      if (!r) return { ok: false, message: '제보를 찾을 수 없습니다.' }
      if (!canVote()) return { ok: false, message: '현재 설정에서는 시민 투표를 쓰지 않습니다.' }
      if (u.role !== 'citizen') return { ok: false, message: '시민 사용자만 확인 투표를 할 수 있습니다.' }
      if (r.userId === u.id) return { ok: false, message: '본인 제보에는 투표할 수 없습니다.' }
      if (r.status !== 'pending') return { ok: false, message: '검증 대기 중인 제보만 투표할 수 있습니다.' }
      if (r.verification.voterIds.includes(u.id)) return { ok: false, message: '이미 확인하셨습니다.' }
      update(id, (x) => {
        const voterIds = [...x.verification.voterIds, u.id]
        const next = { ...x, verification: { ...x.verification, votes: voterIds.length, voterIds } }
        if (voterIds.length >= VOTES_REQUIRED) {
          return log({ ...next, verification: { ...next.verification, result: 'confirmed' } }, 'verified', `시민 확인 ${voterIds.length}명`)
        }
        return next
      })
      return { ok: true }
    },

    judge: (id, rating) => {
      const u = me()
      const r = find(id)
      if (!r) return { ok: false, message: '제보를 찾을 수 없습니다.' }
      if (u.role !== 'verifier') return { ok: false, message: '검증자만 판정할 수 있습니다.' }
      if (r.status === 'pending' && canVerifierConfirm()) {
        update(id, (x) => log({ ...x, verification: { ...x.verification, verifierId: u.id, result: 'confirmed', rating } }, 'verified', '검증자 현장 확인·판정'))
        return { ok: true }
      }
      if (r.status === 'verified' && !r.verification.rating) {
        update(id, (x) => ({
          ...x,
          verification: { ...x.verification, verifierId: u.id, rating },
          history: [...x.history, { status: 'verified' as const, at: new Date(nowMs()).toISOString(), by: u.id, memo: '검증자 판정 추가' }],
        }))
        return { ok: true }
      }
      return { ok: false, message: '지금은 판정할 수 없는 상태입니다.' }
    },

    reject: (id, reason) => {
      const u = me()
      const r = find(id)
      if (!r) return { ok: false, message: '제보를 찾을 수 없습니다.' }
      if (u.role !== 'verifier') return { ok: false, message: '검증자만 반려할 수 있습니다.' }
      if (r.status !== 'pending') return { ok: false, message: '검증 대기 중인 제보만 반려할 수 있습니다.' }
      update(id, (x) => log({ ...x, verification: { ...x.verification, verifierId: u.id, result: 'rejected', reason } }, 'rejected', reason))
      return { ok: true }
    },

    advanceDays: (n) => {
      offsetDays += n
      try {
        localStorage.setItem(OFFSET_KEY, String(offsetDays))
      } catch {
        /* 저장 실패는 무시 */
      }
      set({ offsetDays })
    },

    setComplaintMode: (m) => set({ complaintMode: m }),

    // 팀 조사 지점을 ③ 검증 완료 상태의 흐름으로 시작한다(데모). 지점의 ○△X 평가가 있으면 그대로 가져온다.
    startSeedFlow: (seed, type, locationKind, rating) => {
      const existing = get().reports.find((x) => x.seedId === seed.id)
      if (existing) return existing
      const g = seed.geometry
      const at0 = g ? (g.kind === 'point' ? g.at : g.path[0]) : [0, 0]
      const at = new Date(nowMs()).toISOString()
      const by = me().id
      const cat = ['쓰레기', '킥보드·자전거', '입간판·노점', '공사 자재', '불법 주정차'].includes(type) ? 'temporary' : 'fixed'
      const r: Report = {
        id: newReportId(),
        seedId: seed.id,
        userId: by,
        createdAt: at,
        lat: at0[0],
        lng: at0[1],
        type,
        category: cat,
        photos: [],
        description: `팀 현장조사 지점 ${seed.id} · ${seed.name}${seed.issue ? ` — ${seed.issue}` : ''}`,
        locationKind,
        status: 'verified',
        verification: { votes: 0, voterIds: [], verifierId: 'team-survey', result: 'confirmed', ...(rating ? { rating } : {}) },
        history: [{ status: 'verified', at, by, memo: '팀 현장조사 지점에서 시작(검증 완료로 간주, 데모)' }],
      }
      set((s) => ({ reports: [...s.reports, r] }))
      return r
    },

    fileComplaint: (id, c, by) => {
      const r = find(id)
      if (!r) return { ok: false, message: '제보를 찾을 수 없습니다.' }
      if (me().role === 'officer') return { ok: false, message: '공무원 사용자는 접수 신청을 할 수 없습니다.' }
      if (r.status !== 'verified') return { ok: false, message: '검증 완료된 건만 접수할 수 있습니다.' }
      update(id, (x) => {
        const filed = log({ ...x, complaint: { ...c } }, 'filed', `${c.channel} 접수번호 ${c.receiptNo}${c.mode === 'mock' ? ' (시연용 모의 접수)' : ''}`, by)
        if (c.assignedAgencyId && c.mode === 'mock') return log(filed, 'assigned', '모의 접수 응답: 담당 기관 배정', 'mock-api')
        return filed
      })
      return { ok: true }
    },

    // 앱 밖에서 진행된 처리 상황을 시민이 적어 둔다. 앱 안의 처리 상태(status·history)는 바꾸지 않는다. 모의 조회('mock-api')만 공무원 선택 상태에서도 쓴다.
    addExternalUpdate: (id, u, by) => {
      const r = find(id)
      if (!r || !r.complaint) return { ok: false, message: '접수된 민원을 찾을 수 없습니다.' }
      const who = by ?? me().id
      if (who !== 'mock-api' && me().role === 'officer') return { ok: false, message: '바깥 처리 상황은 시민이 기록해요. 시연 도구에서 시민이나 검증자로 바꿔 주세요.' }
      if (Number.isNaN(new Date(u.at).getTime())) return { ok: false, message: '날짜를 확인해 주세요.' }
      const agencyName = u.agencyName?.trim().slice(0, 60)
      const memo = u.memo?.trim().slice(0, 500)
      const entry = { stage: u.stage, at: u.at, ...(agencyName ? { agencyName } : {}), ...(memo ? { memo } : {}), by: who }
      update(id, (x) => {
        const c = x.complaint as NonNullable<Report['complaint']>
        return { ...x, complaint: { ...c, external: { updates: [...(c.external?.updates ?? []), entry], lastCheckedAt: new Date(nowMs()).toISOString() } } }
      })
      return { ok: true }
    },

    assign: (id, agencyId) => {
      const r = find(id)
      if (!r) return { ok: false, message: '제보를 찾을 수 없습니다.' }
      if (me().role !== 'officer') return { ok: false, message: '담당 공무원만 배정을 확인할 수 있습니다.' }
      if (r.status !== 'filed' || !r.complaint) return { ok: false, message: '접수된 건만 배정할 수 있습니다.' }
      update(id, (x) => log({ ...x, complaint: { ...(x.complaint as NonNullable<Report['complaint']>), assignedAgencyId: agencyId } }, 'assigned', '기관 배정 확인'))
      return { ok: true }
    },

    startAction: (id) => {
      const r = find(id)
      if (!r) return { ok: false, message: '제보를 찾을 수 없습니다.' }
      if (me().role !== 'officer') return { ok: false, message: '담당 공무원만 조치를 시작할 수 있습니다.' }
      if (r.status !== 'filed' && r.status !== 'assigned') return { ok: false, message: '접수·배정된 건만 조치를 시작할 수 있습니다.' }
      update(id, (x) => log(x, 'in_progress', '현장 확인·조치 시작'))
      return { ok: true }
    },

    completeAction: (id, description, before, after) => {
      const r = find(id)
      if (!r) return { ok: false, message: '제보를 찾을 수 없습니다.' }
      if (me().role !== 'officer') return { ok: false, message: '담당 공무원만 조치 완료를 등록할 수 있습니다.' }
      if (r.status !== 'in_progress') return { ok: false, message: '조치 중인 건만 완료할 수 있습니다.' }
      update(id, (x) =>
        log({ ...x, lastCheckedAt: new Date(nowMs()).toISOString(), action: { description, beforePhotos: before, afterPhotos: after, doneAt: new Date(nowMs()).toISOString() } }, 'resolved', description || '조치 완료(기관 등록)'),
      )
      return { ok: true }
    },

    // ⑦ 재확인: 시민·검증자가 실제 통과 가능 여부를 확인한다. 통과면 지도에 ○, 불통과면 ⑤(조치 중)로 되돌린다.
    recheck: (id, passable) => {
      const u = me()
      const r = find(id)
      if (!r) return { ok: false, message: '제보를 찾을 수 없습니다.' }
      if (u.role === 'officer') return { ok: false, message: '재확인은 시민 또는 검증자가 합니다.' }
      if (r.status !== 'resolved' || !r.action) return { ok: false, message: '조치 완료된 건만 재확인할 수 있습니다.' }
      const rc = { passable, at: new Date(nowMs()).toISOString(), by: u.id }
      update(id, (x) => {
        const withAction = { ...x, action: { ...(x.action as NonNullable<Report['action']>), recheck: rc } }
        if (passable) return log({ ...withAction, lastCheckedAt: rc.at, verification: { ...withAction.verification, rating: 'O' as const } }, 'rechecked', '재확인: 실제로 통과 가능 → 지도에 ○ 반영', undefined, true)
        return log(log(withAction, 'rechecked', '재확인: 아직 지나가기 어려움', undefined, false), 'in_progress', '⑤ 조치 중으로 되돌림')
      })
      return { ok: true }
    },

    // 기관 간 이관: 담당 공무원이 사유와 함께 요청하고, 받는 기관의 공무원이 수락·반려한다. 횟수는 transfers 길이로 센다.
    requestTransfer: (id, toAgencyId, reason) => {
      const r = find(id)
      if (!r) return { ok: false, message: '제보를 찾을 수 없습니다.' }
      if (me().role !== 'officer') return { ok: false, message: '담당 공무원만 이관을 요청할 수 있습니다.' }
      const from = agencyOf(r)
      if (!r.complaint || !from) return { ok: false, message: '접수된 건만 이관할 수 있습니다.' }
      if (r.status !== 'filed' && r.status !== 'assigned' && r.status !== 'in_progress') return { ok: false, message: '처리 전·처리 중인 건만 이관할 수 있습니다.' }
      if (pendingTransfer(r)) return { ok: false, message: '이미 이관 요청이 진행 중입니다.' }
      if (toAgencyId === from) return { ok: false, message: '같은 기관으로는 이관할 수 없습니다.' }
      if (!reason.trim()) return { ok: false, message: '이관 사유를 입력해 주세요.' }
      const at = new Date(nowMs()).toISOString()
      update(id, (x) => ({
        ...x,
        transfers: [...(x.transfers ?? []), { fromAgencyId: from, toAgencyId, reason: reason.trim(), at, by: me().id, status: 'requested' as const }],
        history: [...x.history, { status: x.status, at, by: me().id, memo: `이관 요청: ${findAgencyName(from)} → ${findAgencyName(toAgencyId)} (사유: ${reason.trim()})` }],
      }))
      return { ok: true }
    },

    decideTransfer: (id, accept) => {
      const r = find(id)
      if (!r) return { ok: false, message: '제보를 찾을 수 없습니다.' }
      if (me().role !== 'officer') return { ok: false, message: '담당 공무원만 수락·반려할 수 있습니다.' }
      const t = pendingTransfer(r)
      if (!t || !r.complaint) return { ok: false, message: '진행 중인 이관 요청이 없습니다.' }
      const at = new Date(nowMs()).toISOString()
      update(id, (x) => {
        const list = (x.transfers ?? []).slice()
        list[list.length - 1] = { ...t, status: accept ? 'accepted' : 'rejected', decidedAt: at, decidedBy: me().id }
        return {
          ...x,
          transfers: list,
          ...(accept ? { complaint: { ...(x.complaint as NonNullable<Report['complaint']>), assignedAgencyId: t.toAgencyId } } : {}),
          history: [...x.history, { status: x.status, at, by: me().id, memo: accept ? `이관 수락: ${findAgencyName(t.toAgencyId)}이(가) 맡습니다` : `이관 반려: ${findAgencyName(t.fromAgencyId)}이(가) 계속 맡습니다` }],
        }
      })
      return { ok: true }
    },

    // 발표용 시연 데이터. 이미 있으면 다시 만들지 않는다. 만든 건수를 돌려준다.
    fillDemo: (seeds) => {
      if (get().reports.some((x) => x.demo)) return 0
      const made = buildDemoReports(seeds, nowMs(), newReportId)
      set((s) => ({ reports: [...s.reports, ...made] }))
      return made.length
    },

    resetAll: async () => {
      let err: string | null = null
      try {
        localStorage.removeItem(KEY)
        localStorage.removeItem(USER_KEY)
        localStorage.removeItem(OFFSET_KEY)
      } catch {
        err = '제보 기록을 지우지 못했습니다.'
      }
      try {
        await clearPhotos()
      } catch {
        err = (err ? err + ' ' : '') + '사진을 지우지 못했습니다.'
      }
      usePlan.getState().reset() // 개선계획·예산 입력도 함께 비운다
      offsetDays = 0
      set({ reports: [], userId: DEMO_USERS[0].id, storageError: err, offsetDays: 0 })
      return err
    },
  }
})

// 변경될 때마다 저장. 실패하면 안내 문구를 남긴다.
let lastSaved = ''
const SAVE_ERR = '제보 기록을 저장하지 못했습니다. 브라우저 저장소가 막혀 있거나 가득 찼을 수 있습니다. 새로고침하면 기록이 사라집니다.'
useReports.subscribe((s) => {
  try {
    const json = JSON.stringify(s.reports)
    if (json !== lastSaved) {
      if (s.reports.length === 0) localStorage.removeItem(KEY)
      else localStorage.setItem(KEY, json)
      lastSaved = json
    }
    localStorage.setItem(USER_KEY, s.userId)
    if (s.storageError === SAVE_ERR) useReports.setState({ storageError: null })
  } catch {
    if (s.storageError !== SAVE_ERR) useReports.setState({ storageError: SAVE_ERR })
  }
})
