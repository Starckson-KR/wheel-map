import { apiCall } from './api'

// 개발자 관리 API(role='dev' 계정만 서버가 허용한다). 역할을 바꾸는 호출은 없다.
export type AdminSummary = { users: number; sessions: number; reports: number; photos: number }
export type AdminUser = { id: string; name: string; role: string; createdAt: number; reportCount: number }
export type AdminReport = { id: string; authorId: string; authorName: string; createdAt: string; type: string; text: string; hasPhoto: boolean }
export type AdminPage<T> = { items: T[]; more: boolean; total: number }
export type AdminResult<T> = { ok: true; value: T } | { ok: false; message: string }

const FAIL = '불러오지 못했어요. 잠시 뒤에 다시 해 주세요.'

async function get<T>(path: string, pick: (b: Record<string, unknown>) => T | null): Promise<AdminResult<T>> {
  const r = await apiCall(path)
  if (r.status === 403) return { ok: false, message: '권한이 없어요.' }
  const v = r.status === 200 && r.body?.ok ? pick(r.body) : null
  return v ? { ok: true, value: v } : { ok: false, message: FAIL }
}

const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : 0)

export const loadSummary = () =>
  get<AdminSummary>('/admin/summary', (b) => ({ users: num(b.users), sessions: num(b.sessions), reports: num(b.reports), photos: num(b.photos) }))

const pageOf = <T>(b: Record<string, unknown>): AdminPage<T> | null => (Array.isArray(b.items) ? { items: b.items as T[], more: b.more === true, total: num(b.total) } : null)

export const loadUsers = (offset: number) => get<AdminPage<AdminUser>>(`/admin/users?offset=${offset}`, (b) => pageOf<AdminUser>(b))
export const loadReports = (offset: number) => get<AdminPage<AdminReport>>(`/admin/reports?offset=${offset}`, (b) => pageOf<AdminReport>(b))

async function del(path: string): Promise<string | null> {
  const r = await apiCall(path, { method: 'DELETE' })
  if (r.status === 200 && r.body?.ok) return null
  if (r.status === 404) return null // 이미 없으면 지운 것과 같다
  if (r.status === 403) return '권한이 없어요.'
  if (r.status === 400) return '내 계정은 지울 수 없어요.'
  return '지우지 못했어요. 잠시 뒤에 다시 해 주세요.'
}
export const deleteReport = (id: string) => del(`/admin/reports/${encodeURIComponent(id)}`)
export const deleteUser = (id: string) => del(`/admin/users/${encodeURIComponent(id)}`)
