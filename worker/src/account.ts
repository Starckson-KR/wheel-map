import { LOCK_FAILS, SESSION_DAYS, afterFailure, hashPin, isLocked, nameKey, normalizeName, randomHex, safeEqual, sha256Hex, validPin } from './auth.ts'
import type { Throttle } from './auth.ts'
import { mergeReport } from './merge.ts'
import { MAX_PREFS_BYTES, cleanPrefs } from './prefs.ts'
import type { D1Db, Env } from './types'

// 간편 계정·개인 설정·공유 제보·사진 엔드포인트. 로그에는 이름·PIN·토큰·IP를 남기지 않는다(console.log를 쓰지 않는다).
export const MAX_REPORT_BYTES = 64 * 1024
export const MAX_PHOTO_BYTES = 400 * 1024
export const MAX_AUTH_BYTES = 1024
export const DEFAULT_WRITE_LIMIT = 300
const NAME_FAIL_LIMIT = 30 // 이름 하나에 대한 전체(IP 무관) 실패 상한
const SIGNUP_LIMIT = 20 // IP당 10분 가입 시도 상한
const PAGE = 200

export type Deps = { now?: () => number }

export const isAccountPath = (p: string) => p.startsWith('/auth/') || p === '/prefs' || p === '/reports' || p.startsWith('/reports/') || p.startsWith('/photos/')

function reply(body: unknown, status: number, origin: string, extra: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'access-control-allow-origin': origin, vary: 'Origin', ...extra },
  })
}
const fail = (status: number, code: string, message: string, origin: string) => reply({ ok: false, code, message }, status, origin)

async function readBody(request: Request, max: number): Promise<{ ok: true; bytes: Uint8Array } | { ok: false; res: 'too_large' | 'bad' }> {
  const declared = Number(request.headers.get('content-length') ?? '0')
  if (declared > max) return { ok: false, res: 'too_large' }
  let buf: ArrayBuffer
  try {
    buf = await request.arrayBuffer()
  } catch {
    return { ok: false, res: 'bad' }
  }
  if (buf.byteLength > max) return { ok: false, res: 'too_large' }
  return { ok: true, bytes: new Uint8Array(buf) }
}
async function readJson(request: Request, max: number): Promise<{ ok: true; value: unknown } | { ok: false; res: 'too_large' | 'bad' }> {
  const b = await readBody(request, max)
  if (!b.ok) return b
  try {
    return { ok: true, value: JSON.parse(new TextDecoder().decode(b.bytes)) }
  } catch {
    return { ok: false, res: 'bad' }
  }
}

// ---- 실패 횟수 ----
async function getThrottle(db: D1Db, key: string): Promise<Throttle | null> {
  const r = await db.prepare('SELECT fails, window_start AS windowStart, locked_until AS lockedUntil FROM throttle WHERE key = ?').bind(key).first<Throttle>()
  return r ?? null
}
async function putThrottle(db: D1Db, key: string, t: Throttle) {
  await db
    .prepare('INSERT INTO throttle(key, fails, window_start, locked_until) VALUES(?,?,?,?) ON CONFLICT(key) DO UPDATE SET fails=excluded.fails, window_start=excluded.window_start, locked_until=excluded.locked_until')
    .bind(key, t.fails, t.windowStart, t.lockedUntil)
    .run()
}
async function recordFailure(db: D1Db, key: string, now: number, limit: number): Promise<Throttle> {
  const t = afterFailure(await getThrottle(db, key), now, limit)
  await putThrottle(db, key, t)
  return t
}

// ---- 세션 ----
async function newSession(db: D1Db, userId: string, now: number): Promise<string> {
  const token = randomHex(32)
  await db.prepare('INSERT INTO sessions(token_hash, user_id, expires_at) VALUES(?,?,?)').bind(await sha256Hex(token), userId, now + SESSION_DAYS * 86400000).run()
  await db.prepare('DELETE FROM sessions WHERE expires_at < ?').bind(now).run()
  return token
}
type AuthedUser = { id: string; name: string }
async function authenticate(db: D1Db, request: Request, now: number): Promise<{ user: AuthedUser; tokenHash: string } | null> {
  const h = request.headers.get('authorization') ?? ''
  const m = /^Bearer ([0-9a-f]{64})$/.exec(h)
  if (!m) return null
  const tokenHash = await sha256Hex(m[1])
  const row = await db
    .prepare('SELECT u.id AS id, u.name AS name FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ? AND s.expires_at > ?')
    .bind(tokenHash, now)
    .first<AuthedUser>()
  return row ? { user: row, tokenHash } : null
}

async function takeQuota(db: D1Db, userId: string, now: number, limit: number): Promise<boolean> {
  const day = new Date(now).toISOString().slice(0, 10)
  const r = await db
    .prepare('INSERT INTO write_quota(user_id, day, n) VALUES(?,?,1) ON CONFLICT(user_id, day) DO UPDATE SET n = n + 1 RETURNING n')
    .bind(userId, day)
    .first<{ n: number }>()
  return (r?.n ?? 1) <= limit
}

const AUTH_FAIL_MSG = '이름 또는 비밀번호가 맞지 않아요.'
const LOCKED_MSG = '잠시 후에 다시 시도해 주세요. (10분 뒤에 풀려요)'

async function handleAuth(request: Request, env: Env, db: D1Db, path: string, origin: string, now: number): Promise<Response> {
  if (path === '/auth/me') {
    if (request.method !== 'GET') return fail(405, 'method_not_allowed', '허용되지 않는 요청이에요.', origin)
    const a = await authenticate(db, request, now)
    if (!a) return fail(401, 'unauthorized', '다시 로그인해 주세요.', origin)
    return reply({ ok: true, user: a.user }, 200, origin)
  }
  if (path === '/auth/logout') {
    if (request.method !== 'POST') return fail(405, 'method_not_allowed', '허용되지 않는 요청이에요.', origin)
    const a = await authenticate(db, request, now)
    if (a) await db.prepare('DELETE FROM sessions WHERE token_hash = ?').bind(a.tokenHash).run()
    return reply({ ok: true }, 200, origin)
  }
  if (path !== '/auth/signup' && path !== '/auth/login') return fail(404, 'not_found', '없는 주소예요.', origin)
  if (request.method !== 'POST') return fail(405, 'method_not_allowed', '허용되지 않는 요청이에요.', origin)

  const body = await readJson(request, MAX_AUTH_BYTES)
  if (!body.ok) return fail(body.res === 'too_large' ? 413 : 400, 'bad_input', '요청 형식이 올바르지 않아요.', origin)
  const b = (body.value ?? {}) as { name?: unknown; pin?: unknown }
  const name = normalizeName(b.name)
  if (!name || !validPin(b.pin)) return fail(400, 'bad_input', '이름은 한글·영문·숫자·공백 1~10자, 비밀번호는 숫자 4자리예요.', origin)
  const pin = b.pin
  const nk = nameKey(name)
  const ip = request.headers.get('cf-connecting-ip') ?? 'unknown'
  const kPair = await sha256Hex(`pair|${nk}|${ip}`)
  const kName = await sha256Hex(`name|${nk}`)

  if (path === '/auth/signup') {
    const kIp = await sha256Hex(`signup|${ip}`)
    const t = await recordFailure(db, kIp, now, SIGNUP_LIMIT)
    if (t.lockedUntil > now) return fail(429, 'locked', '가입 시도가 너무 많아요. 잠시 뒤에 다시 해 주세요.', origin)
    const exists = await db.prepare('SELECT 1 AS x FROM users WHERE name_key = ?').bind(nk).first()
    if (exists) return fail(409, 'taken', '이미 쓰고 있는 이름이에요. 다른 이름으로 해 주세요.', origin)
    const id = `u_${randomHex(6)}`
    const salt = randomHex(16)
    const pinHash = await hashPin(pin, salt)
    try {
      await db.prepare('INSERT INTO users(id, name, name_key, pin_hash, salt, created_at) VALUES(?,?,?,?,?,?)').bind(id, name, nk, pinHash, salt, now).run()
    } catch {
      return fail(409, 'taken', '이미 쓰고 있는 이름이에요. 다른 이름으로 해 주세요.', origin)
    }
    const token = await newSession(db, id, now)
    return reply({ ok: true, token, user: { id, name } }, 200, origin)
  }

  // 로그인
  const [tPair, tName] = [await getThrottle(db, kPair), await getThrottle(db, kName)]
  if (isLocked(tPair, now) || isLocked(tName, now)) return fail(429, 'locked', LOCKED_MSG, origin)
  const user = await db.prepare('SELECT id, name, pin_hash AS pinHash, salt FROM users WHERE name_key = ?').bind(nk).first<{ id: string; name: string; pinHash: string; salt: string }>()
  // 이름이 없어도 같은 시간만큼 해시 계산을 해서, 응답 시간으로 이름 존재 여부를 알 수 없게 한다.
  const computed = await hashPin(pin, user?.salt ?? '0'.repeat(32))
  if (!user || !safeEqual(computed, user.pinHash)) {
    const a = await recordFailure(db, kPair, now, LOCK_FAILS)
    const c = await recordFailure(db, kName, now, NAME_FAIL_LIMIT)
    if (a.lockedUntil > now || c.lockedUntil > now) return fail(429, 'locked', LOCKED_MSG, origin)
    return fail(401, 'invalid', AUTH_FAIL_MSG, origin)
  }
  await db.prepare('DELETE FROM throttle WHERE key = ?').bind(kPair).run()
  const token = await newSession(db, user.id, now)
  void env
  return reply({ ok: true, token, user: { id: user.id, name: user.name } }, 200, origin)
}

// ---- 개인 설정(본인만) ----
async function handlePrefs(request: Request, env: Env, db: D1Db, user: AuthedUser, origin: string, now: number): Promise<Response> {
  if (request.method === 'GET') {
    const row = await db.prepare('SELECT data, updated_at AS updatedAt FROM prefs WHERE user_id = ?').bind(user.id).first<{ data: string; updatedAt: number }>()
    return reply({ ok: true, data: row ? JSON.parse(row.data) : null, updatedAt: row?.updatedAt ?? 0 }, 200, origin)
  }
  if (request.method !== 'PUT') return fail(405, 'method_not_allowed', '허용되지 않는 요청이에요.', origin)
  const body = await readJson(request, MAX_PREFS_BYTES)
  if (!body.ok) return fail(body.res === 'too_large' ? 413 : 400, body.res === 'too_large' ? 'too_large' : 'bad_input', '설정 형식이 올바르지 않아요.', origin)
  const incoming = cleanPrefs((body.value as { data?: unknown } | null)?.data)
  if (!incoming) return fail(400, 'bad_input', '설정 형식이 올바르지 않아요.', origin)
  if (!(await takeQuota(db, user.id, now, writeLimit(env)))) return fail(429, 'quota', '오늘 저장 횟수를 다 썼어요. 내일 다시 해 주세요.', origin)
  const row = await db.prepare('SELECT data FROM prefs WHERE user_id = ?').bind(user.id).first<{ data: string }>()
  const cur: Record<string, string> = row ? JSON.parse(row.data) : {}
  for (const [k, v] of Object.entries(incoming)) {
    if (v === null) delete cur[k]
    else cur[k] = v
  }
  const text = JSON.stringify(cur)
  if (new TextEncoder().encode(text).length > MAX_PREFS_BYTES) return fail(413, 'too_large', '설정이 너무 커요.', origin)
  await db.prepare('INSERT INTO prefs(user_id, data, updated_at) VALUES(?,?,?) ON CONFLICT(user_id) DO UPDATE SET data=excluded.data, updated_at=excluded.updated_at').bind(user.id, text, now).run()
  return reply({ ok: true, data: cur, updatedAt: now }, 200, origin)
}

const writeLimit = (env: Env) => (Number(env.DAILY_WRITE_LIMIT) > 0 ? Number(env.DAILY_WRITE_LIMIT) : DEFAULT_WRITE_LIMIT)

// ---- 공유 제보 ----
const ID_RE = /^[A-Za-z0-9_-]{1,64}$/
export function validateReport(v: unknown, id: string): string | null {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return '제보 형식이 올바르지 않아요.'
  const r = v as Record<string, unknown>
  if (r.id !== id) return '제보 id가 주소와 달라요.'
  if (r.demo || r.demoSet) return '시연 데이터는 서버에 올리지 않아요.'
  if (typeof r.userId !== 'string' || typeof r.createdAt !== 'string') return '제보 형식이 올바르지 않아요.'
  if (typeof r.lat !== 'number' || typeof r.lng !== 'number' || !Number.isFinite(r.lat) || !Number.isFinite(r.lng)) return '위치가 올바르지 않아요.'
  if (typeof r.type !== 'string' || typeof r.status !== 'string') return '제보 형식이 올바르지 않아요.'
  if (!Array.isArray(r.history) || r.history.length > 300) return '기록 형식이 올바르지 않아요.'
  if (!Array.isArray(r.photos) || r.photos.length > 20 || r.photos.some((p) => typeof p !== 'string' || p.length > 100)) return '사진 목록이 올바르지 않아요.'
  if (typeof r.verification !== 'object' || r.verification === null) return '검증 정보가 올바르지 않아요.'
  return null
}

async function handleReports(request: Request, env: Env, db: D1Db, user: AuthedUser, path: string, origin: string, now: number): Promise<Response> {
  if (path === '/reports') {
    if (request.method !== 'GET') return fail(405, 'method_not_allowed', '허용되지 않는 요청이에요.', origin)
    const since = Number(new URL(request.url).searchParams.get('since') ?? '0')
    const s = Number.isFinite(since) && since > 0 ? since : 0
    const { results } = await db.prepare('SELECT data, updated_at AS updatedAt FROM reports WHERE updated_at > ? ORDER BY updated_at ASC LIMIT ?').bind(s, PAGE + 1).all<{ data: string; updatedAt: number }>()
    const more = results.length > PAGE
    const page = more ? results.slice(0, PAGE) : results
    const users = (await db.prepare('SELECT id, name FROM users').all<{ id: string; name: string }>()).results
    return reply(
      {
        ok: true,
        serverTime: now,
        cursor: page.length > 0 ? page[page.length - 1].updatedAt : s,
        more,
        reports: page.map((r) => JSON.parse(r.data)),
        users: Object.fromEntries(users.map((u) => [u.id, u.name])),
      },
      200,
      origin,
    )
  }
  const id = decodeURIComponent(path.slice('/reports/'.length))
  if (!ID_RE.test(id)) return fail(400, 'bad_input', '제보 id가 올바르지 않아요.', origin)
  if (request.method !== 'PUT') return fail(405, 'method_not_allowed', '허용되지 않는 요청이에요.', origin)
  const body = await readJson(request, MAX_REPORT_BYTES)
  if (!body.ok) return fail(body.res === 'too_large' ? 413 : 400, body.res === 'too_large' ? 'too_large' : 'bad_input', body.res === 'too_large' ? '제보가 너무 커요(64KB 이하).' : '제보 형식이 올바르지 않아요.', origin)
  const err = validateReport(body.value, id)
  if (err) return fail(400, 'bad_input', err, origin)
  const incoming = body.value as Record<string, unknown>
  const row = await db.prepare('SELECT data FROM reports WHERE id = ?').bind(id).first<{ data: string }>()
  if (!row && incoming.userId !== user.id) return fail(400, 'bad_input', '내 계정으로 만든 제보만 새로 올릴 수 있어요.', origin)
  if (!(await takeQuota(db, user.id, now, writeLimit(env)))) return fail(429, 'quota', '오늘 저장 횟수를 다 썼어요. 내일 다시 해 주세요.', origin)
  const merged = mergeReport(row ? JSON.parse(row.data) : null, incoming)
  const text = JSON.stringify(merged)
  if (new TextEncoder().encode(text).length > MAX_REPORT_BYTES) return fail(413, 'too_large', '제보가 너무 커요(64KB 이하).', origin)
  await db
    .prepare('INSERT INTO reports(id, author_id, data, updated_at) VALUES(?,?,?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data, updated_at=excluded.updated_at')
    .bind(id, user.id, text, now)
    .run()
  return reply({ ok: true, report: merged, serverTime: now }, 200, origin)
}

// ---- 사진 ----
const PHOTO_ID_RE = /^[A-Za-z0-9_:.-]{1,100}$/
const MIMES = ['image/jpeg', 'image/png', 'image/webp']
function toBase64(bytes: Uint8Array): string {
  let s = ''
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(s)
}
function fromBase64(b64: string): Uint8Array {
  const s = atob(b64)
  const out = new Uint8Array(s.length)
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i)
  return out
}

async function handlePhotos(request: Request, env: Env, db: D1Db, user: AuthedUser, path: string, origin: string, now: number): Promise<Response> {
  const id = decodeURIComponent(path.slice('/photos/'.length))
  if (!PHOTO_ID_RE.test(id)) return fail(400, 'bad_input', '사진 id가 올바르지 않아요.', origin)
  if (request.method === 'GET') {
    const row = await db.prepare('SELECT mime, data FROM photos WHERE id = ?').bind(id).first<{ mime: string; data: string }>()
    if (!row) return fail(404, 'not_found', '사진이 없어요.', origin)
    return new Response(fromBase64(row.data).buffer as ArrayBuffer, { status: 200, headers: { 'content-type': row.mime, 'cache-control': 'private, max-age=3600', 'access-control-allow-origin': origin, vary: 'Origin' } })
  }
  if (request.method !== 'PUT') return fail(405, 'method_not_allowed', '허용되지 않는 요청이에요.', origin)
  const mime = (request.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase()
  if (!MIMES.includes(mime)) return fail(400, 'bad_input', '사진 형식이 올바르지 않아요.', origin)
  const body = await readBody(request, MAX_PHOTO_BYTES)
  if (!body.ok) return fail(body.res === 'too_large' ? 413 : 400, body.res === 'too_large' ? 'too_large' : 'bad_input', body.res === 'too_large' ? '사진이 너무 커요(400KB 이하).' : '사진을 읽지 못했어요.', origin)
  if (body.bytes.length === 0) return fail(400, 'bad_input', '사진이 비어 있어요.', origin)
  const owner = await db.prepare('SELECT owner_id AS ownerId FROM photos WHERE id = ?').bind(id).first<{ ownerId: string }>()
  if (owner && owner.ownerId !== user.id) return fail(403, 'forbidden', '다른 사람이 올린 사진은 바꿀 수 없어요.', origin)
  if (!(await takeQuota(db, user.id, now, writeLimit(env)))) return fail(429, 'quota', '오늘 저장 횟수를 다 썼어요. 내일 다시 해 주세요.', origin)
  await db
    .prepare('INSERT INTO photos(id, owner_id, mime, data, created_at) VALUES(?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET mime=excluded.mime, data=excluded.data')
    .bind(id, user.id, mime, toBase64(body.bytes), now)
    .run()
  return reply({ ok: true }, 200, origin)
}

// 계정 경로 진입점(출처 확인과 OPTIONS는 index.ts에서 이미 끝났다).
export async function handleAccount(request: Request, env: Env, origin: string, deps: Deps = {}): Promise<Response> {
  const db = env.DB
  if (!db) return fail(503, 'not_configured', '계정 저장소가 아직 연결되지 않았어요.', origin)
  const now = (deps.now ?? Date.now)()
  const path = new URL(request.url).pathname
  try {
    if (path.startsWith('/auth/')) return await handleAuth(request, env, db, path, origin, now)
    const a = await authenticate(db, request, now)
    if (!a) return fail(401, 'unauthorized', '다시 로그인해 주세요.', origin)
    if (path === '/prefs') return await handlePrefs(request, env, db, a.user, origin, now)
    if (path === '/reports' || path.startsWith('/reports/')) return await handleReports(request, env, db, a.user, path, origin, now)
    return await handlePhotos(request, env, db, a.user, path, origin, now)
  } catch {
    console.log('wheelmap-ai error: account_internal') // 오류 종류만 남긴다
    return fail(500, 'server_error', '서버에 문제가 생겼어요. 잠시 뒤에 다시 해 주세요.', origin)
  }
}
