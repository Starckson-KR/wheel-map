import { authenticate, fail, readJson, reply } from './account.ts'
import { sha256Hex } from './auth.ts'
import { parseUa } from './ua.ts'
import type { D1Db, Env } from './types'

// 접속 기록·오류 기록 받기(로그인한 본인 것만). 조회는 admin.ts(개발자 전용).
//  - 사용자의 하루 쓰기 한도(DAILY_WRITE_LIMIT)에는 세지 않고, 아래 상한을 따로 둔다.
//  - IP는 읽지도 저장하지도 않는다. User-Agent는 기기 한 줄에 최신 원문(300자)만 둔다.
//  - 기록하지 못해도 앱은 신경 쓰지 않는다(앱은 실패를 무시한다).
export const isActivityPath = (p: string) => p === '/activity/visit' || p === '/activity/error'

const DAY_MS = 24 * 60 * 60 * 1000
const KST_MS = 9 * 60 * 60 * 1000
export const KEEP_MS = 30 * DAY_MS // 접속·오류 기록 보관
export const DEVICE_KEEP_MS = 90 * DAY_MS // 기기 요약(처음·횟수)은 조금 더 오래
export const VISIT_DEDUP_MS = 10 * 60 * 1000 // 같은 기기 10분 안 중복은 무시
export const MAX_VISITS = 200 // 사용자당
export const MAX_DEVICES = 20 // 사용자당
export const MAX_ERRORS_PER_DAY = 20 // 사용자당 하루(한국 시간 기준)
export const MAX_BODY = 8 * 1024

const DEVICE_RE = /^[A-Za-z0-9_-]{8,64}$/
const BUILD_RE = /^[A-Za-z0-9._+\- ]{1,40}$/
const KINDS = ['open', 'resume', 'login', 'signup']
const cut = (s: string, n: number) => [...s].slice(0, n).join('')

const intIn = (v: unknown, min: number, max: number) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(max, Math.max(min, Math.round(v))) : 0)
const dayStart = (now: number) => Math.floor((now + KST_MS) / DAY_MS) * DAY_MS - KST_MS

async function cleanupVisits(db: D1Db, userId: string, now: number) {
  await db.prepare('DELETE FROM visits WHERE at < ?').bind(now - KEEP_MS).run()
  await db.prepare('DELETE FROM user_devices WHERE last_at < ?').bind(now - DEVICE_KEEP_MS).run()
  await db.prepare('DELETE FROM visits WHERE user_id = ? AND id NOT IN (SELECT id FROM visits WHERE user_id = ? ORDER BY at DESC, id DESC LIMIT ?)').bind(userId, userId, MAX_VISITS).run()
  await db
    .prepare('DELETE FROM user_devices WHERE user_id = ? AND device_id NOT IN (SELECT device_id FROM user_devices WHERE user_id = ? ORDER BY last_at DESC LIMIT ?)')
    .bind(userId, userId, MAX_DEVICES)
    .run()
}

async function handleVisit(request: Request, db: D1Db, userId: string, origin: string, now: number): Promise<Response> {
  const body = await readJson(request, MAX_BODY)
  if (!body.ok) return fail(body.res === 'too_large' ? 413 : 400, 'bad_input', '요청 형식이 올바르지 않아요.', origin)
  const b = (body.value ?? {}) as { deviceId?: unknown; build?: unknown; standalone?: unknown; screen?: unknown; kind?: unknown }
  if (typeof b.deviceId !== 'string' || !DEVICE_RE.test(b.deviceId) || typeof b.build !== 'string' || !BUILD_RE.test(b.build)) return fail(400, 'bad_input', '요청 형식이 올바르지 않아요.', origin)
  const s = (b.screen ?? {}) as { w?: unknown; h?: unknown }
  const screen = `${intIn(s.w, 0, 20000)}x${intIn(s.h, 0, 20000)}`
  const kind = typeof b.kind === 'string' && KINDS.includes(b.kind) ? b.kind : 'open'
  const standalone = b.standalone === true ? 1 : 0

  const prev = await db.prepare('SELECT last_at AS lastAt, build FROM user_devices WHERE user_id = ? AND device_id = ?').bind(userId, b.deviceId).first<{ lastAt: number; build: string }>()
  // 빌드가 바뀌었으면(자동 업데이트 직후 등) 10분 안이어도 기록하고 기기 빌드를 갱신한다.
  if (prev && prev.build === b.build && now >= prev.lastAt && now - prev.lastAt < VISIT_DEDUP_MS) return reply({ ok: true, skipped: true }, 200, origin)

  const ua = cut(request.headers.get('user-agent') ?? '', 300)
  const { device, os, browser } = parseUa(ua)
  await db
    .prepare('INSERT INTO visits(user_id, device_id, at, kind, build, standalone, screen, device, os, browser) VALUES(?,?,?,?,?,?,?,?,?,?)')
    .bind(userId, b.deviceId, now, kind, b.build, standalone, screen, device, os, browser)
    .run()
  await db
    .prepare(
      'INSERT INTO user_devices(user_id, device_id, first_at, last_at, count, device, os, browser, ua, build, standalone, screen) VALUES(?,?,?,?,1,?,?,?,?,?,?,?) ' +
        'ON CONFLICT(user_id, device_id) DO UPDATE SET last_at=excluded.last_at, count=count+1, device=excluded.device, os=excluded.os, browser=excluded.browser, ua=excluded.ua, build=excluded.build, standalone=excluded.standalone, screen=excluded.screen',
    )
    .bind(userId, b.deviceId, now, now, device, os, browser, ua, b.build, standalone, screen)
    .run()
  await cleanupVisits(db, userId, now)
  return reply({ ok: true }, 200, origin)
}

// 화면 경로: 쿼리·해시 조각을 빼고 경로만(주소에 개인 정보가 실리지 않게).
export function cleanRoute(v: unknown): string {
  if (typeof v !== 'string') return ''
  return cut(v.replace(/^#/, '').split(/[?#]/)[0], 100)
}

async function handleError(request: Request, db: D1Db, userId: string, origin: string, now: number): Promise<Response> {
  const body = await readJson(request, MAX_BODY)
  if (!body.ok) return fail(body.res === 'too_large' ? 413 : 400, 'bad_input', '요청 형식이 올바르지 않아요.', origin)
  const b = (body.value ?? {}) as { deviceId?: unknown; build?: unknown; message?: unknown; stack?: unknown; route?: unknown; at?: unknown }
  if (typeof b.deviceId !== 'string' || !DEVICE_RE.test(b.deviceId) || typeof b.build !== 'string' || !BUILD_RE.test(b.build)) return fail(400, 'bad_input', '요청 형식이 올바르지 않아요.', origin)
  const message = typeof b.message === 'string' ? cut(b.message.trim(), 300) : ''
  if (!message) return fail(400, 'bad_input', '요청 형식이 올바르지 않아요.', origin)
  const stack = typeof b.stack === 'string' ? cut(b.stack, 2000) : ''
  const at = typeof b.at === 'number' && Number.isFinite(b.at) && b.at >= now - DAY_MS && b.at <= now + 60_000 ? Math.round(b.at) : now

  const key = (await sha256Hex(`${message}|${b.build}`)).slice(0, 16)
  const start = dayStart(now)
  const dup = await db.prepare('SELECT 1 AS x FROM client_errors WHERE user_id = ? AND device_id = ? AND key = ? AND at >= ? LIMIT 1').bind(userId, b.deviceId, key, start).first()
  if (dup) return reply({ ok: true, skipped: true }, 200, origin)
  const today = await db.prepare('SELECT COUNT(*) AS n FROM client_errors WHERE user_id = ? AND at >= ?').bind(userId, start).first<{ n: number }>()
  if ((today?.n ?? 0) >= MAX_ERRORS_PER_DAY) return reply({ ok: true, skipped: true }, 200, origin)

  await db
    .prepare('INSERT INTO client_errors(user_id, device_id, at, build, key, message, stack, route) VALUES(?,?,?,?,?,?,?,?)')
    .bind(userId, b.deviceId, at, b.build, key, message, stack, cleanRoute(b.route))
    .run()
  await db.prepare('DELETE FROM client_errors WHERE at < ?').bind(now - KEEP_MS).run()
  return reply({ ok: true }, 200, origin)
}

export async function handleActivity(request: Request, env: Env, origin: string, deps: { now?: () => number } = {}): Promise<Response> {
  const db = env.DB
  if (!db) return fail(503, 'not_configured', '계정 저장소가 아직 연결되지 않았어요.', origin)
  const now = (deps.now ?? Date.now)()
  const path = new URL(request.url).pathname
  try {
    if (request.method !== 'POST') return fail(405, 'method_not_allowed', '허용되지 않는 요청이에요.', origin)
    const a = await authenticate(db, request, now)
    if (!a) return fail(401, 'unauthorized', '다시 로그인해 주세요.', origin)
    return path === '/activity/visit' ? await handleVisit(request, db, a.user.id, origin, now) : await handleError(request, db, a.user.id, origin, now)
  } catch {
    console.log('wheelmap-ai error: activity_internal') // 오류 종류만 남긴다
    return fail(500, 'server_error', '서버에 문제가 생겼어요.', origin)
  }
}
