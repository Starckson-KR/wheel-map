import { apiCall } from './api'

// 개발자 관리 API(role='dev' 계정만 서버가 허용한다). 역할을 바꾸는 호출은 없다.
export type AdminSummary = { users: number; sessions: number; reports: number; photos: number }
export type AdminUser = { id: string; name: string; role: string; createdAt: number; reportCount: number; online: number | null; lastAt: number | null; visits30: number; city: string | null } // city: 동의한 사용자의 접속 지역 표시 글자
export type AdminReport = { id: string; authorId: string; authorName: string; createdAt: string; type: string; text: string; hasPhoto: boolean }
export type AdminPage<T> = { items: T[]; more: boolean; total: number }
export type AdminUsersPage = AdminPage<AdminUser> & { onlineUsers: number | null; todayUsers: number }
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

// 옛 서버 응답(새 필드 없음)도 깨지지 않게 기본값을 채운다.
const userOf = (u: Partial<AdminUser>): AdminUser => ({
  id: String(u.id ?? ''),
  name: String(u.name ?? ''),
  role: String(u.role ?? 'user'),
  createdAt: num(u.createdAt),
  reportCount: num(u.reportCount),
  online: typeof u.online === 'number' ? u.online : null,
  lastAt: typeof u.lastAt === 'number' ? u.lastAt : null,
  visits30: num(u.visits30),
  city: typeof u.city === 'string' ? u.city : null,
})
export const loadUsers = (offset: number, limit?: number) =>
  get<AdminUsersPage>(`/admin/users?offset=${offset}${limit ? `&limit=${limit}` : ''}`, (b) => {
    const p = pageOf<Partial<AdminUser>>(b)
    return p ? { ...p, items: p.items.map(userOf), onlineUsers: typeof b.onlineUsers === 'number' ? b.onlineUsers : null, todayUsers: num(b.todayUsers) } : null
  })
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

async function post(path: string): Promise<{ ok: true; body: Record<string, unknown> } | { ok: false; message: string }> {
  const r = await apiCall(path, { method: 'POST' })
  if (r.status === 200 && r.body?.ok) return { ok: true, body: r.body }
  if (r.status === 403) return { ok: false, message: '권한이 없어요.' }
  if (r.status === 404) return { ok: false, message: '이미 없는 계정이에요.' }
  return { ok: false, message: '처리하지 못했어요. 잠시 뒤에 다시 해 주세요.' }
}
export async function unlockUser(id: string): Promise<string | null> {
  const r = await post(`/admin/users/${encodeURIComponent(id)}/unlock`)
  return r.ok ? null : r.message
}
export async function clearAllLocks(): Promise<string | null> {
  const r = await post('/admin/throttle/clear')
  return r.ok ? null : r.message
}
// 새 임시 PIN은 이 응답에만 있다. 저장·출력하지 말고 화면에 한 번만 보여 준다.
export async function resetPin(id: string): Promise<{ ok: true; pin: string; self: boolean } | { ok: false; message: string }> {
  const r = await post(`/admin/users/${encodeURIComponent(id)}/reset-pin`)
  if (!r.ok) return r
  return typeof r.body.pin === 'string' ? { ok: true, pin: r.body.pin, self: r.body.self === true } : { ok: false, message: '처리하지 못했어요. 잠시 뒤에 다시 해 주세요.' }
}

// 사용자 한 명의 접속·기기·오류(읽기 전용). online: 지금 연결된 기기 수(null이면 알 수 없음).
export type AdminDevice = { deviceId: string; device: string; os: string; browser: string; ua: string; build: string; standalone: boolean; screen: string; firstAt: number; lastAt: number; count: number; city: string | null }
export type AdminVisit = { at: number; deviceId: string; kind: string; build: string; standalone: boolean; screen: string; device: string; os: string; browser: string; city: string | null }
export type AdminError = { at: number; deviceId: string; build: string; message: string; stack: string; route: string; device: string | null; os: string | null; browser: string | null }
export type AdminActivity = { name: string; online: number | null; devices: AdminDevice[]; visits: AdminVisit[]; errors: AdminError[] }

export const loadActivity = (id: string) =>
  get<AdminActivity>(`/admin/users/${encodeURIComponent(id)}/activity`, (b) => {
    const list = <T>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : [])
    return {
      name: typeof b.name === 'string' ? b.name : '',
      online: typeof b.online === 'number' ? b.online : null,
      devices: list<AdminDevice>(b.devices).map((d) => ({ ...d, city: d.city ?? null })), // 옛 응답은 null
      visits: list<AdminVisit>(b.visits).map((v) => ({ ...v, city: v.city ?? null })),
      errors: list<AdminError>(b.errors),
    }
  })
