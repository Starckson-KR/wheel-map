import type { Report } from '../types'
import { INSPECT_FIXED_MONTHS, INSPECT_TEMP_MONTHS, LONG_UNRESOLVED_DAYS } from './config'

export const DAY = 86400000

export type Transfer = NonNullable<Report['transfers']>[number]
export type InboxTab = 'new' | 'doing' | 'done' | 'transfer'

// 현재 처리 기관: 배정(또는 이관 수락)된 기관이 있으면 그 기관, 없으면 접수 때의 첫 소관 후보.
export const agencyOf = (r: Report): string | null => r.complaint?.assignedAgencyId ?? r.complaint?.agencyIds[0] ?? null

export const pendingTransfer = (r: Report): Transfer | undefined => {
  const t = r.transfers?.[r.transfers.length - 1]
  return t && t.status === 'requested' ? t : undefined
}

// 민원함 탭: 접수된 건만 대상. 신규=접수·배정(착수 전), 처리 중=조치 중, 조치 완료=조치 완료·재확인 완료.
export function tabOf(r: Report): InboxTab | null {
  if (!r.complaint) return null
  if (pendingTransfer(r)) return 'transfer'
  if (r.status === 'filed' || r.status === 'assigned') return 'new'
  if (r.status === 'in_progress') return 'doing'
  if (r.status === 'resolved' || r.status === 'rechecked') return 'done'
  return null
}

export type Deadline = { dueMs: number; open: boolean; overdueDays: number; longDays: number }

// 3단계와 같은 기준: 접수일 + 처리기한(일)이 지나면 "처리기한 경과", 접수 후 60일 이상 미조치면 "장기 미조치".
export function deadlineOf(r: Report, now: number): Deadline | null {
  const c = r.complaint
  if (!c) return null
  const sub = new Date(c.submittedAt).getTime()
  const dueMs = sub + c.deadlineDays * DAY
  const open = r.status === 'filed' || r.status === 'assigned' || r.status === 'in_progress'
  return {
    dueMs,
    open,
    overdueDays: open && now > dueMs ? Math.floor((now - dueMs) / DAY) : 0,
    longDays: open && now - sub >= LONG_UNRESOLVED_DAYS * DAY ? Math.floor((now - sub) / DAY) : 0,
  }
}

export function flagsOf(r: Report, now: number): string[] {
  const d = deadlineOf(r, now)
  if (!d) return []
  const out: string[] = []
  if (d.overdueDays > 0) out.push(`처리기한 경과 (${d.overdueDays}일 초과)`)
  if (d.longDays > 0) out.push(`장기 미조치 (접수 후 ${d.longDays}일)`)
  return out
}

const addMonths = (ms: number, n: number) => {
  const d = new Date(ms)
  d.setMonth(d.getMonth() + n)
  return d.getTime()
}

// 사후 점검: 마지막 점검일(조치 완료·재확인 통과 시 갱신) + 주기(고정형 6개월, 일시형 1개월).
export function nextInspection(r: Report, now: number): { lastMs: number; dueMs: number; needed: boolean } | null {
  if (!r.lastCheckedAt) return null
  const lastMs = new Date(r.lastCheckedAt).getTime()
  const dueMs = addMonths(lastMs, r.category === 'fixed' ? INSPECT_FIXED_MONTHS : INSPECT_TEMP_MONTHS)
  return { lastMs, dueMs, needed: now >= dueMs }
}

export const pct = (v: number | null) => (v === null ? '산정 불가' : `${Math.round(v * 100)}%`)
export const fmtDate = (ms: number) => new Date(ms).toLocaleDateString('ko-KR', { dateStyle: 'medium' })
