import { reply } from './account.ts'
import { windowAllowed } from './limit.ts'
import { isNoRouteCode, ODSAY_KEY_HEADER, odsayUrl, parseOdsay } from '../../src/lib/transit/odsay.ts'
import type { TItinerary } from '../../src/lib/transit/parse.ts'
import type { D1Db, Env } from './types'

// 대중교통(버스) 길찾기 중계: GET /transit?from=위도,경도&to=위도,경도 → { ok:true, itineraries, cached } 또는 { ok:false, error }.
// ODsay(디지털융합플랫폼) 키 KOREACONNECT_KEY는 secret으로만 읽고 응답·로그·오류에 내보내지 않는다(오류는 종류만).
// 캐시는 BIS와 같은 D1 표(bis_cache)를 쓴다: 좌표를 소수 4자리(약 10m)로 맞춰 같은 구간은 6시간 동안 상류를 부르지 않고,
// 길을 못 찾은 결과도 1시간 기억한다. 하루 상류 호출 상한은 bis_calls 표에 'transit:날짜' 키로 센다(포털에 일 한도 표기가 없어 기본 300).
export const TRANSIT_TTL_MS = 6 * 3_600_000
export const TRANSIT_NOROUTE_TTL_MS = 3_600_000
export const TRANSIT_FAIL_TTL_MS = 3 * 60_000 // 상류 실패는 3분 기억(그동안 상류·하루 상한을 쓰지 않고 같은 502)
export const DEFAULT_TRANSIT_DAILY_CAP = 300
export const DEFAULT_TRANSIT_PER_MINUTE = 10
const UPSTREAM_TIMEOUT_MS = 8000

export const isTransitPath = (p: string) => p === '/transit'
export type Deps = { now?: () => number; fetch?: typeof fetch }

type Pt = [number, number]
type Cached = { itineraries: TItinerary[] } | { noRoute: string } | { fail: true; status: number; message: string }

const posInt = (v: string | undefined, d: number) => (Number(v) > 0 ? Math.floor(Number(v)) : d)
const dayOf = (now: number) => new Date(now).toISOString().slice(0, 10)

function point(s: string | null): Pt | null {
  const m = /^(-?\d{1,3}(?:\.\d{1,8})?),(-?\d{1,3}(?:\.\d{1,8})?)$/.exec(s ?? '')
  if (!m) return null
  const lat = Number(m[1])
  const lng = Number(m[2])
  return lat > 33 && lat < 39 && lng > 124 && lng < 132 ? [lat, lng] : null
}
const round = (p: Pt): Pt => [Math.round(p[0] * 1e4) / 1e4, Math.round(p[1] * 1e4) / 1e4]

async function readCache(db: D1Db, key: string, now: number): Promise<Cached | null> {
  const r = await db.prepare('SELECT body, fetched_at AS at FROM bis_cache WHERE key = ?').bind(key).first<{ body: string; at: number }>()
  if (!r || now < r.at) return null
  const v = JSON.parse(r.body) as Cached
  const ttl = 'fail' in v ? TRANSIT_FAIL_TTL_MS : 'noRoute' in v ? TRANSIT_NOROUTE_TTL_MS : TRANSIT_TTL_MS
  return now - r.at < ttl ? v : null
}
async function writeCache(db: D1Db, key: string, v: Cached, now: number) {
  await db
    .prepare('INSERT INTO bis_cache(key, body, fetched_at) VALUES(?,?,?) ON CONFLICT(key) DO UPDATE SET body=excluded.body, fetched_at=excluded.fetched_at')
    .bind(key, JSON.stringify(v), now)
    .run()
}
// 하루 호출 수를 하나 올린다. 상한에 닿았으면 올리지 않고 false.
async function takeCall(db: D1Db, now: number, cap: number): Promise<boolean> {
  const r = await db.prepare('INSERT INTO bis_calls(day, n) VALUES(?,1) ON CONFLICT(day) DO UPDATE SET n = n + 1 WHERE n < ? RETURNING n').bind(`transit:${dayOf(now)}`, cap).first<{ n: number }>()
  return !!r
}
async function prune(db: D1Db, now: number) {
  await db.prepare("DELETE FROM bis_cache WHERE key LIKE 'transit:%' AND fetched_at < ?").bind(now - 2 * 86_400_000).run()
  await db.prepare("DELETE FROM bis_calls WHERE day LIKE 'transit:%' AND day < ?").bind(`transit:${dayOf(now - 7 * 86_400_000)}`).run()
}

class Fail extends Error {
  status: number
  constructor(status: number, msg: string) {
    super(msg)
    this.status = status
  }
}

async function upstream(from: Pt, to: Pt, key: string, f: typeof fetch): Promise<Cached> {
  const ctl = new AbortController()
  const timer = setTimeout(() => ctl.abort(), UPSTREAM_TIMEOUT_MS)
  try {
    const r = await f(odsayUrl(from, to), { headers: { [ODSAY_KEY_HEADER]: key, accept: 'application/json', 'user-agent': 'Mozilla/5.0 (compatible; wheelmap-ai/1.0)', 'accept-language': 'ko-KR,ko;q=0.9' }, signal: ctl.signal })
    const text = await r.text()
    let json: unknown = null
    try {
      json = JSON.parse(text)
    } catch {
      /* 아래에서 처리 */
    }
    const p = parseOdsay(json, from, to)
    if (p.ok) return { itineraries: p.itineraries }
    if (isNoRouteCode(p.code)) return { noRoute: p.message }
    // 11/20 확인: 포털 앞단 웹 방화벽이 Cloudflare에서 오는 요청을 막아 HTML 차단 화면이 온다(HTTP 200). 국내 PC(개발 중계·prefetch)에서는 정상.
    console.log(`wheelmap-ai transit_upstream http=${r.status} code=${p.code ?? '-'} ${json ? 'json' : text.includes('Web firewall') ? 'waf_blocked' : 'nonjson'}`) // 종류만(키·주소 없음)
    throw new Fail(502, '지금은 버스 경로를 찾지 못했어요.')
  } catch (e) {
    if (e instanceof Fail) throw e
    console.log(`wheelmap-ai transit_fetch_fail ${ctl.signal.aborted ? 'timeout' : (e as Error)?.name ?? 'error'}`) // 종류만
    // 오류 객체의 문구에는 주소가 들어갈 수 있어 종류만 남긴다.
    throw new Fail(502, ctl.signal.aborted ? '지금은 버스 경로를 찾지 못했어요.' : '지금은 버스 경로를 찾지 못했어요.')
  } finally {
    clearTimeout(timer)
  }
}

// 진입점(출처 확인과 OPTIONS는 index.ts에서 이미 끝났다).
export async function handleTransit(request: Request, env: Env, origin: string, deps: Deps = {}): Promise<Response> {
  const bad = (status: number, error: string) => reply({ ok: false, error }, status, origin)
  if (request.method !== 'GET') return bad(405, 'GET만 허용합니다.')
  const db = env.DB
  if (!db) return bad(503, '버스 경로 중계가 아직 준비되지 않았어요.')
  const now = (deps.now ?? Date.now)()
  const u = new URL(request.url)
  const from = point(u.searchParams.get('from'))
  const to = point(u.searchParams.get('to'))
  if (!from || !to) return bad(400, '출발·도착 좌표 형식이 올바르지 않습니다.')
  try {
    const ip = request.headers.get('cf-connecting-ip') ?? 'unknown'
    if (!(await windowAllowed(db, 'transit', ip, now, posInt(env.TRANSIT_PER_MINUTE, DEFAULT_TRANSIT_PER_MINUTE)))) return bad(429, '잠시 뒤에 다시 해 주세요.')
    const a = round(from)
    const b = round(to)
    const cacheKey = `transit:${a[0]},${a[1]}|${b[0]},${b[1]}`
    let v = await readCache(db, cacheKey, now)
    if (v && 'fail' in v) return bad(v.status, v.message) // 최근에 상류가 실패한 구간: 상류도 하루 상한도 건드리지 않는다
    const cached = !!v
    if (!v) {
      const key = (env.KOREACONNECT_KEY ?? '').trim()
      if (!key) return bad(503, '버스 경로 중계가 아직 준비되지 않았어요.')
      if (!(await takeCall(db, now, posInt(env.TRANSIT_DAILY_CAP, DEFAULT_TRANSIT_DAILY_CAP)))) return bad(429, '오늘 버스 경로 조회 한도에 닿았어요.')
      try {
        v = await upstream(a, b, key, deps.fetch ?? fetch)
      } catch (e) {
        if (e instanceof Fail) {
          await writeCache(db, cacheKey, { fail: true, status: e.status, message: e.message }, now)
          await prune(db, now)
        }
        throw e
      }
      await writeCache(db, cacheKey, v, now)
      await prune(db, now)
    }
    if ('noRoute' in v) return bad(422, v.noRoute)
    return reply({ ok: true, itineraries: v.itineraries, cached }, 200, origin)
  } catch (e) {
    if (e instanceof Fail) return bad(e.status, e.message)
    console.log('wheelmap-ai error: transit_internal') // 오류 종류만 남긴다
    return bad(500, '지금은 버스 경로를 찾지 못했어요.')
  }
}
