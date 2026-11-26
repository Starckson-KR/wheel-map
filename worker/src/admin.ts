import { authenticate, fail, isDev, reply } from './account.ts'
import { hashPin, randomHex, sha256Hex } from './auth.ts'
import { dayStart } from './activity.ts'
import { cityLabel } from './cityLabel.ts'
import { disconnectUser, hubStub, notify } from './notify.ts'
import type { NotifyDeps } from './notify.ts'
import { readXmas, setXmas } from './xmas.ts'
import type { D1Db, Env } from './types'

// 0000~9999를 치우침 없이 고른다(거부 표집).
function randomPin(): string {
  const buf = new Uint32Array(1)
  const limit = Math.floor(0x100000000 / 10000) * 10000
  do crypto.getRandomValues(buf)
  while (buf[0] >= limit)
  return String(buf[0] % 10000).padStart(4, '0')
}

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

// 잘못된 퍼센트 부호면 null(예외 대신 400으로 답하려고)
const safeDecode = (s: string): string | null => {
  try {
    return decodeURIComponent(s)
  } catch {
    return null
  }
}

const TOMBSTONE_KEEP_MS = 30 * 24 * 60 * 60 * 1000

async function removeReport(db: D1Db, id: string, now: number): Promise<boolean> {
  const row = await db.prepare('SELECT author_id AS authorId, data FROM reports WHERE id = ?').bind(id).first<{ authorId: string; data: string }>()
  if (!row) return false
  for (const pid of photoIds(row.data)) await db.prepare('DELETE FROM photos WHERE id = ? AND owner_id = ?').bind(pid, row.authorId).run()
  await db.prepare('DELETE FROM reports WHERE id = ?').bind(id).run()
  // 삭제 표시를 남기고(받아 간 기기가 지울 수 있게), 30일 지난 표시는 정리한다
  await db.prepare('INSERT INTO report_deletions(id, deleted_at) VALUES(?,?) ON CONFLICT(id) DO UPDATE SET deleted_at=excluded.deleted_at').bind(id, now).run()
  await db.prepare('DELETE FROM report_deletions WHERE deleted_at < ?').bind(now - TOMBSTONE_KEEP_MS).run()
  return true
}

async function removeUser(db: D1Db, id: string, now: number): Promise<boolean> {
  const exists = await db.prepare('SELECT 1 AS x FROM users WHERE id = ?').bind(id).first()
  if (!exists) return false
  const { results } = await db.prepare('SELECT id FROM reports WHERE author_id = ?').bind(id).all<{ id: string }>()
  for (const r of results) await removeReport(db, r.id, now)
  await db.prepare('DELETE FROM photos WHERE owner_id = ?').bind(id).run()
  await db.prepare('DELETE FROM sessions WHERE user_id = ?').bind(id).run()
  await db.prepare('DELETE FROM prefs WHERE user_id = ?').bind(id).run()
  await db.prepare('DELETE FROM write_quota WHERE user_id = ?').bind(id).run()
  for (const t of ['visits', 'user_devices', 'client_errors']) await db.prepare(`DELETE FROM ${t} WHERE user_id = ?`).bind(id).run() // 접속·기기·오류 기록
  await db.prepare('DELETE FROM users WHERE id = ?').bind(id).run()
  return true
}

// 지금 그 계정으로 연결된 기기 수(실시간 허브의 연결 수). 허브가 없거나 실패하면 null(알 수 없음).
async function onlineCount(env: Env, userId: string): Promise<number | null> {
  const stub = hubStub(env)
  if (!stub) return null
  try {
    const r = await stub.fetch(`https://hub/count?user=${encodeURIComponent(userId)}`)
    const n = Number(await r.text())
    return r.ok && Number.isInteger(n) && n >= 0 ? n : null
  } catch {
    return null
  }
}

// 허브의 접속 현황({online: 사용자별 연결 수, seen: 사용자별 마지막 접속 시각}). 허브가 없거나 실패하면 null.
async function presence(env: Env): Promise<{ online: Record<string, number>; seen: Record<string, number> } | null> {
  const stub = hubStub(env)
  if (!stub) return null
  try {
    const r = await stub.fetch('https://hub/presence')
    if (!r.ok) return null
    const j = (await r.json()) as { online?: Record<string, number>; seen?: Record<string, number> }
    if (typeof j !== 'object' || j === null || typeof j.online !== 'object' || j.online === null) return null // 허브가 현황을 모르는 응답이면 연결 수 방식으로
    return { online: j.online && typeof j.online === 'object' ? j.online : {}, seen: j.seen && typeof j.seen === 'object' ? j.seen : {} }
  } catch {
    return null
  }
}

const DAY_MS = 24 * 60 * 60 * 1000
const USERS_MAX = 1000 // 접속 현황은 정렬이 허브 값에 달려 있어 전부 읽어 합친다(소규모 서비스 전제)

export async function handleAdmin(request: Request, env: Env, origin: string, deps: { now?: () => number } & NotifyDeps = {}): Promise<Response> {
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
          'SELECT u.id AS id, u.name AS name, u.role AS role, u.created_at AS createdAt, (SELECT COUNT(*) FROM reports r WHERE r.author_id = u.id) AS reportCount, ' +
            '(SELECT MAX(last_at) FROM user_devices d WHERE d.user_id = u.id) AS lastVisitAt, ' +
            // 지역이 있는 기기 중 가장 최근 것(동의한 경우만 값이 있다)
            '(SELECT city FROM user_devices d WHERE d.user_id = u.id AND COALESCE(d.country, d.city, d.region_code) IS NOT NULL ORDER BY d.last_at DESC LIMIT 1) AS city, ' +
            '(SELECT region_code FROM user_devices d WHERE d.user_id = u.id AND COALESCE(d.country, d.city, d.region_code) IS NOT NULL ORDER BY d.last_at DESC LIMIT 1) AS regionCode, ' +
            '(SELECT country FROM user_devices d WHERE d.user_id = u.id AND COALESCE(d.country, d.city, d.region_code) IS NOT NULL ORDER BY d.last_at DESC LIMIT 1) AS country, ' +
            '(SELECT COUNT(*) FROM visits v WHERE v.user_id = u.id AND v.at >= ?) AS visits30 FROM users u ORDER BY u.created_at DESC, u.id ASC LIMIT ?',
        )
        .bind(now - 30 * DAY_MS, USERS_MAX)
        .all<{ id: string; name: string; role: string; createdAt: number; reportCount: number; lastVisitAt: number | null; visits30: number; city: string | null; regionCode: string | null; country: string | null }>()
      const pr = await presence(env)
      const today = dayStart(now)
      const all = results.map((r) => {
        const online = pr ? pr.online[r.id] ?? 0 : null
        const seen = pr?.seen[r.id] ?? 0
        const lastAt = Math.max(r.lastVisitAt ?? 0, seen, online ? now : 0) || null
        return { id: r.id, name: r.name, role: r.role, createdAt: r.createdAt, reportCount: r.reportCount, online, lastAt, visits30: r.visits30, city: cityLabel(r.city, r.regionCode, r.country) }
      })
      all.sort(
        (x, y) =>
          Number((y.online ?? 0) > 0) - Number((x.online ?? 0) > 0) ||
          (y.lastAt ?? -1) - (x.lastAt ?? -1) ||
          y.createdAt - x.createdAt ||
          (x.id < y.id ? -1 : x.id > y.id ? 1 : 0),
      )
      const todayVisitors = await db.prepare('SELECT DISTINCT user_id AS id FROM visits WHERE at >= ?').bind(today).all<{ id: string }>()
      const ids = new Set(all.map((u) => u.id))
      const todaySet = new Set(todayVisitors.results.map((r) => r.id).filter((id) => ids.has(id)))
      for (const u of all) if ((u.online ?? 0) > 0 || (pr?.seen[u.id] ?? 0) >= today) todaySet.add(u.id)
      const onlineUsers = pr ? all.filter((u) => (u.online ?? 0) > 0).length : null
      const items = all.slice(offset, offset + limit)
      return reply({ ok: true, items, more: offset + limit < all.length, total: all.length, onlineUsers, todayUsers: todaySet.size }, 200, origin)
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

    // 크리스마스 모드: 지금 값 보기(GET) / 켜고 끄기(POST {on}). 바꾸면 앱을 연 모든 기기에 신호를 보낸다.
    if (path === '/admin/xmas') {
      if (m === 'GET') return reply({ ok: true, ...(await readXmas(db)) }, 200, origin)
      if (m !== 'POST') return fail(405, 'method_not_allowed', '허용되지 않는 요청이에요.', origin)
      let on: unknown
      try {
        on = ((await request.json()) as { on?: unknown }).on
      } catch {
        on = undefined
      }
      if (typeof on !== 'boolean') return fail(400, 'bad_input', '값이 올바르지 않아요.', origin)
      const f = await setXmas(db, on, now)
      await notify(env, deps, 'xmas')
      return reply({ ok: true, ...f }, 200, origin)
    }

    // 모든 로그인 시도 제한 풀기(가입 시도 제한 포함)
    if (path === '/admin/throttle/clear') {
      if (m !== 'POST') return fail(405, 'method_not_allowed', '허용되지 않는 요청이에요.', origin)
      await db.prepare('DELETE FROM throttle').run()
      return reply({ ok: true }, 200, origin)
    }

    // 사용자 한 명의 접속·기기·오류(읽기 전용)
    const act2 = /^\/admin\/users\/([^/]+)\/activity$/.exec(path)
    if (act2) {
      if (m !== 'GET') return fail(405, 'method_not_allowed', '허용되지 않는 요청이에요.', origin)
      const id = safeDecode(act2[1])
      if (id === null) return fail(400, 'bad_input', 'id가 올바르지 않아요.', origin)
      if (!ID_RE.test(id)) return fail(400, 'bad_input', 'id가 올바르지 않아요.', origin)
      const u = await db.prepare('SELECT name FROM users WHERE id = ?').bind(id).first<{ name: string }>()
      if (!u) return fail(404, 'not_found', '이미 없어요.', origin)
      const devices = await db
        .prepare(
          'SELECT device_id AS deviceId, device, os, browser, ua, build, standalone, screen, first_at AS firstAt, last_at AS lastAt, count, city, region_code AS regionCode, country FROM user_devices WHERE user_id = ? ORDER BY last_at DESC LIMIT 20',
        )
        .bind(id)
        .all<Placed>()
      const visits = await db
        .prepare('SELECT at, device_id AS deviceId, kind, build, standalone, screen, device, os, browser, city, region_code AS regionCode, country FROM visits WHERE user_id = ? ORDER BY at DESC, id DESC LIMIT 50')
        .bind(id)
        .all<Placed>()
      const errors = await db
        .prepare(
          'SELECT e.at AS at, e.device_id AS deviceId, e.build AS build, e.message AS message, e.stack AS stack, e.route AS route, d.device AS device, d.os AS os, d.browser AS browser FROM client_errors e LEFT JOIN user_devices d ON d.user_id = e.user_id AND d.device_id = e.device_id WHERE e.user_id = ? ORDER BY e.at DESC, e.id DESC LIMIT 50',
        )
        .bind(id)
        .all()
      type Placed = { standalone: number; city: string | null; regionCode: string | null; country: string | null }
      const flag = (r: Placed) => {
        const { regionCode, country, city, ...rest } = r
        return { ...rest, standalone: r.standalone === 1, city: cityLabel(city, regionCode, country) }
      }
      // 접속 중: 끊긴 연결(오래 소식 없음)은 빼고 센다. 지금 이 화면을 보는 개발자 본인은 앱이 열려 있으니 최소 1대로 본다.
      const pr = await presence(env)
      const live = pr ? pr.online[id] ?? 0 : await onlineCount(env, id)
      const online = live === null ? null : id === a.user.id ? Math.max(live, 1) : live
      return reply(
        { ok: true, name: u.name, online, devices: devices.results.map(flag), visits: visits.results.map(flag), errors: errors.results },
        200,
        origin,
      )
    }

    // 계정별 잠금 풀기 / PIN 다시 정하기
    const act = /^\/admin\/users\/([^/]+)\/(unlock|reset-pin)$/.exec(path)
    if (act) {
      if (m !== 'POST') return fail(405, 'method_not_allowed', '허용되지 않는 요청이에요.', origin)
      const id = safeDecode(act[1])
      if (id === null) return fail(400, 'bad_input', 'id가 올바르지 않아요.', origin)
      if (!ID_RE.test(id)) return fail(400, 'bad_input', 'id가 올바르지 않아요.', origin)
      const u = await db.prepare('SELECT name_key AS nameKey FROM users WHERE id = ?').bind(id).first<{ nameKey: string }>()
      if (!u) return fail(404, 'not_found', '이미 없어요.', origin)
      const kName = await sha256Hex(`name|${u.nameKey}`)
      if (act[2] === 'unlock') {
        // 이름 기준 키만 지울 수 있다. 「이름+IP」 키는 IP 없이는 특정할 수 없어 「모든 잠금 풀기」로 푼다.
        await db.prepare('DELETE FROM throttle WHERE key = ?').bind(kName).run()
        return reply({ ok: true, partial: true }, 200, origin)
      }
      // 새 임시 PIN은 응답에만 담는다(저장은 salt+해시, 로그 없음). 그 계정의 세션은 모두 끊는다.
      const pin = randomPin()
      const salt = randomHex(16)
      await db.prepare('UPDATE users SET pin_hash = ?, salt = ? WHERE id = ?').bind(await hashPin(pin, salt), salt, id).run()
      await db.prepare('DELETE FROM sessions WHERE user_id = ?').bind(id).run()
      await db.prepare('DELETE FROM throttle WHERE key = ?').bind(kName).run()
      await disconnectUser(env, deps, id) // 열려 있던 실시간 연결도 닫는다
      return reply({ ok: true, pin, self: id === a.user.id }, 200, origin)
    }

    const rm = /^\/admin\/(reports|users)\/([^/]+)$/.exec(path)
    if (rm) {
      if (m !== 'DELETE') return fail(405, 'method_not_allowed', '허용되지 않는 요청이에요.', origin)
      const id = safeDecode(rm[2])
      if (id === null) return fail(400, 'bad_input', 'id가 올바르지 않아요.', origin)
      if (!ID_RE.test(id)) return fail(400, 'bad_input', 'id가 올바르지 않아요.', origin)
      if (rm[1] === 'users' && id === a.user.id) return fail(400, 'self_delete', '내 계정은 여기서 지울 수 없어요.', origin)
      const ok = rm[1] === 'reports' ? await removeReport(db, id, now) : await removeUser(db, id, now)
      if (!ok) return fail(404, 'not_found', '이미 없어요.', origin)
      await notify(env, deps, 'reports') // 지운 제보를 다른 기기에서도 바로 지운다
      if (rm[1] === 'users') await disconnectUser(env, deps, id) // 지운 계정의 실시간 연결도 닫는다
      return reply({ ok: true }, 200, origin)
    }
    return fail(404, 'not_found', '없는 주소예요.', origin)
  } catch {
    console.log('wheelmap-ai error: admin_internal') // 오류 종류만 남긴다
    return fail(500, 'server_error', '서버에 문제가 생겼어요. 잠시 뒤에 다시 해 주세요.', origin)
  }
}
