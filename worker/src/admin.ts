import { authenticate, fail, isDev, reply } from './account.ts'
import type { D1Db, Env } from './types'

// 개발자(role='dev') 전용 관리 API. 역할을 바꾸는 API는 없다(역할은 DB에서 직접만 바꾼다).
// 로그에는 이름·토큰을 남기지 않는다.
export const isAdminPath = (p: string) => p.startsWith('/admin/')
const PAGE_SIZE = 30
const ID_RE = /^[A-Za-z0-9_-]{1,64}$/
const snippet = (s: unknown) => (typeof s === 'string' ? [...s.trim().replace(/\s+/g, ' ')].slice(0, 60).join('') : '')

function pageParams(url: URL): { limit: number; offset: number } {
  const limit = Math.min(100, Math.max(1, Math.floor(Number(url.searchParams.get('limit'))) || PAGE_SIZE))
  const offset = Math.max(0, Math.floor(Number(url.searchParams.get('offset'))) || 0)
  return { limit, offset }
}

async function count(db: D1Db, sql: string, ...v: unknown[]): Promise<number> {
  const r = await db.prepare(sql).bind(...v).first<{ n: number }>()
  return r?.n ?? 0
}

// 사진 id 목록(제보 JSON 안의 photos)을 뽑는다. 깨진 JSON은 빈 목록.
function photoIds(data: string): string[] {
  try {
    const p = (JSON.parse(data) as { photos?: unknown }).photos
    return Array.isArray(p) ? p.filter((x): x is string => typeof x === 'string') : []
  } catch {
    return []
  }
}

async function removeReport(db: D1Db, id: string): Promise<boolean> {
  const row = await db.prepare('SELECT author_id AS authorId, data FROM reports WHERE id = ?').bind(id).first<{ authorId: string; data: string }>()
  if (!row) return false
  for (const pid of photoIds(row.data)) await db.prepare('DELETE FROM photos WHERE id = ? AND owner_id = ?').bind(pid, row.authorId).run()
  await db.prepare('DELETE FROM reports WHERE id = ?').bind(id).run()
  return true
}

async function removeUser(db: D1Db, id: string): Promise<boolean> {
  const exists = await db.prepare('SELECT 1 AS x FROM users WHERE id = ?').bind(id).first()
  if (!exists) return false
  const { results } = await db.prepare('SELECT id FROM reports WHERE author_id = ?').bind(id).all<{ id: string }>()
  for (const r of results) await removeReport(db, r.id)
  await db.prepare('DELETE FROM photos WHERE owner_id = ?').bind(id).run()
  await db.prepare('DELETE FROM sessions WHERE user_id = ?').bind(id).run()
  await db.prepare('DELETE FROM prefs WHERE user_id = ?').bind(id).run()
  await db.prepare('DELETE FROM write_quota WHERE user_id = ?').bind(id).run()
  await db.prepare('DELETE FROM users WHERE id = ?').bind(id).run()
  return true
}

export async function handleAdmin(request: Request, env: Env, origin: string, deps: { now?: () => number } = {}): Promise<Response> {
  const db = env.DB
  if (!db) return fail(503, 'not_configured', '계정 저장소가 아직 연결되지 않았어요.', origin)
  const now = (deps.now ?? Date.now)()
  const url = new URL(request.url)
  const path = url.pathname
  try {
    const a = await authenticate(db, request, now)
    if (!a) return fail(401, 'unauthorized', '다시 로그인해 주세요.', origin)
    if (!isDev(a.user)) return fail(403, 'forbidden', '권한이 없어요.', origin)
    const m = request.method

    if (path === '/admin/summary') {
      if (m !== 'GET') return fail(405, 'method_not_allowed', '허용되지 않는 요청이에요.', origin)
      return reply(
        {
          ok: true,
          users: await count(db, 'SELECT COUNT(*) AS n FROM users'),
          sessions: await count(db, 'SELECT COUNT(*) AS n FROM sessions WHERE expires_at > ?', now),
          reports: await count(db, 'SELECT COUNT(*) AS n FROM reports'),
          photos: await count(db, 'SELECT COUNT(*) AS n FROM photos'),
        },
        200,
        origin,
      )
    }

    if (path === '/admin/users') {
      if (m !== 'GET') return fail(405, 'method_not_allowed', '허용되지 않는 요청이에요.', origin)
      const { limit, offset } = pageParams(url)
      const { results } = await db
        .prepare(
          'SELECT u.id AS id, u.name AS name, u.role AS role, u.created_at AS createdAt, (SELECT COUNT(*) FROM reports r WHERE r.author_id = u.id) AS reportCount FROM users u ORDER BY u.created_at DESC, u.id ASC LIMIT ? OFFSET ?',
        )
        .bind(limit + 1, offset)
        .all<{ id: string; name: string; role: string; createdAt: number; reportCount: number }>()
      const more = results.length > limit
      return reply({ ok: true, items: more ? results.slice(0, limit) : results, more, total: await count(db, 'SELECT COUNT(*) AS n FROM users') }, 200, origin)
    }

    if (path === '/admin/reports') {
      if (m !== 'GET') return fail(405, 'method_not_allowed', '허용되지 않는 요청이에요.', origin)
      const { limit, offset } = pageParams(url)
      const { results } = await db
        .prepare('SELECT r.id AS id, r.author_id AS authorId, u.name AS authorName, r.data AS data, r.updated_at AS updatedAt FROM reports r LEFT JOIN users u ON u.id = r.author_id ORDER BY r.updated_at DESC, r.id ASC LIMIT ? OFFSET ?')
        .bind(limit + 1, offset)
        .all<{ id: string; authorId: string; authorName: string | null; data: string; updatedAt: number }>()
      const more = results.length > limit
      const items = (more ? results.slice(0, limit) : results).map((r) => {
        let d: { createdAt?: unknown; type?: unknown; description?: unknown; photos?: unknown } = {}
        try {
          d = JSON.parse(r.data)
        } catch {
          /* 깨진 행도 목록에는 보인다 */
        }
        return {
          id: r.id,
          authorId: r.authorId,
          authorName: r.authorName ?? '',
          createdAt: typeof d.createdAt === 'string' ? d.createdAt : '',
          type: typeof d.type === 'string' ? d.type : '',
          text: snippet(d.description),
          hasPhoto: Array.isArray(d.photos) && d.photos.length > 0,
        }
      })
      return reply({ ok: true, items, more, total: await count(db, 'SELECT COUNT(*) AS n FROM reports') }, 200, origin)
    }

    const rm = /^\/admin\/(reports|users)\/([^/]+)$/.exec(path)
    if (rm) {
      if (m !== 'DELETE') return fail(405, 'method_not_allowed', '허용되지 않는 요청이에요.', origin)
      const id = decodeURIComponent(rm[2])
      if (!ID_RE.test(id)) return fail(400, 'bad_input', 'id가 올바르지 않아요.', origin)
      if (rm[1] === 'users' && id === a.user.id) return fail(400, 'self_delete', '내 계정은 여기서 지울 수 없어요.', origin)
      const ok = rm[1] === 'reports' ? await removeReport(db, id) : await removeUser(db, id)
      if (!ok) return fail(404, 'not_found', '이미 없어요.', origin)
      return reply({ ok: true }, 200, origin)
    }
    return fail(404, 'not_found', '없는 주소예요.', origin)
  } catch {
    console.log('wheelmap-ai error: admin_internal') // 오류 종류만 남긴다
    return fail(500, 'server_error', '서버에 문제가 생겼어요. 잠시 뒤에 다시 해 주세요.', origin)
  }
}
