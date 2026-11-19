import { reply } from './account.ts'
import { windowAllowed } from './limit.ts'
import type { D1Db, Env } from './types'

// 광주 BIS(저상버스 실시간 도착) 중계. 앱은 키를 모르고 이 Worker만 부른다.
// serviceKey는 secret(DATA_GO_KR_KEY)에서만 읽고, 응답·오류·로그에는 어떤 경로로도 내보내지 않는다(오류는 종류만).
// 개발 중계(scripts/bisClient.ts)와 응답 모양이 같다: /bis/arrive?station=, /bis/line?name=
// 공공데이터포털 「광주버스정보」 개발계정 트래픽은 100건(신청 가능 트래픽 표기)이라 하루 호출 상한 기본값을 80으로 둔다.
const BASE = 'http://apis.data.go.kr/6290000/gj_bis/'
export const ARRIVE_TTL_MS = 25_000
export const LOC_TTL_MS = 10 * 60_000
export const LINEINFO_TTL_MS = 24 * 3_600_000
export const DEFAULT_BIS_DAILY_CAP = 80
export const DEFAULT_BIS_PER_MINUTE = 30
const UPSTREAM_TIMEOUT_MS = 8000

export type Deps = { now?: () => number; fetch?: typeof fetch }

export const isBisPath = (p: string) => p === '/bis/arrive' || p === '/bis/line'

type Arrival = { lineId: string; lineName: string; remainMin: number | null; remainStop: number | null; low: boolean; kind: number | null; dirEnd?: string }
type Raw = { RESPONSE?: { RESULT?: { RESULT_CODE?: string }; [k: string]: unknown } }
type LineRow = { id: string; short: string; name: string }

class BisError extends Error {
  status: number
  msg: string
  constructor(status: number, msg: string) {
    super(msg)
    this.status = status
    this.msg = msg
  }
}

const err = (status: number, msg: string, origin: string) => reply({ ok: false, error: msg }, status, origin)

const asArray = <T>(x: T | T[] | undefined): T[] => (Array.isArray(x) ? x : x ? [x] : [])
function listOf(json: Raw): Record<string, unknown>[] {
  const resp = json.RESPONSE ?? {}
  for (const [k, v] of Object.entries(resp)) {
    if (k === 'RESULT' || !v || typeof v !== 'object') continue
    const item = (v as { ITEM?: unknown }).ITEM
    if (item) return asArray(item as Record<string, unknown> | Record<string, unknown>[])
  }
  return []
}
const num = (v: unknown): number | null => (v === null || v === undefined || v === '' || Number.isNaN(Number(v)) ? null : Number(v))

export function toArrivals(json: Raw): Arrival[] {
  const out: Arrival[] = listOf(json).map((x) => ({
    lineId: String(x.LINE_ID ?? ''),
    lineName: String(x.SHORT_LINE_NAME ?? x.LINE_NAME ?? ''),
    remainMin: num(x.REMAIN_MIN),
    remainStop: num(x.REMAIN_STOP),
    low: String(x.LOW_BUS) === '1',
    kind: num(x.LINE_KIND),
    ...(x.DIR_END ? { dirEnd: String(x.DIR_END) } : {}),
  }))
  out.sort((a, b) => (a.remainMin ?? 9999) - (b.remainMin ?? 9999))
  return out
}

// ---- 캐시·상한(D1) ----
async function getCached(db: D1Db, key: string, ttl: number, now: number): Promise<{ body: string; at: number } | null> {
  const r = await db.prepare('SELECT body, fetched_at AS at FROM bis_cache WHERE key = ?').bind(key).first<{ body: string; at: number }>()
  return r && now - r.at < ttl && now >= r.at ? r : null
}
async function putCached(db: D1Db, key: string, body: string, now: number) {
  await db.prepare('INSERT INTO bis_cache(key, body, fetched_at) VALUES(?,?,?) ON CONFLICT(key) DO UPDATE SET body=excluded.body, fetched_at=excluded.fetched_at').bind(key, body, now).run()
}
const dayOf = (now: number) => new Date(now).toISOString().slice(0, 10)
// 하루 호출 수를 하나 올린다. 상한에 닿았으면 올리지 않고 false(RETURNING이 비어 돌아온다).
async function takeCall(db: D1Db, now: number, cap: number): Promise<boolean> {
  const r = await db.prepare('INSERT INTO bis_calls(day, n) VALUES(?,1) ON CONFLICT(day) DO UPDATE SET n = n + 1 WHERE n < ? RETURNING n').bind(dayOf(now), cap).first<{ n: number }>()
  return !!r
}
async function prune(db: D1Db, now: number) {
  await db.prepare('DELETE FROM bis_cache WHERE fetched_at < ?').bind(now - 2 * 86_400_000).run()
  await db.prepare('DELETE FROM bis_calls WHERE day < ?').bind(dayOf(now - 7 * 86_400_000)).run()
}

// ---- 상류(공공데이터포털) 호출 ----
async function upstream(op: string, params: Record<string, string>, key: string, f: typeof fetch): Promise<Raw> {
  const qs = Object.entries(params)
    .map(([k, v]) => `${k}=${encodeURIComponent(v)}`)
    .join('&')
  const ctl = new AbortController()
  const timer = setTimeout(() => ctl.abort(), UPSTREAM_TIMEOUT_MS)
  try {
    const r = await f(`${BASE}${op}?serviceKey=${encodeURIComponent(key)}&${qs}&resultType=json`, { signal: ctl.signal })
    const text = await r.text()
    if (!r.ok) throw new BisError(502, `BIS 응답 오류 HTTP ${r.status}`)
    let json: Raw
    try {
      json = JSON.parse(text) as Raw
    } catch {
      throw new BisError(502, 'BIS 응답을 읽지 못했어요.')
    }
    const code = json.RESPONSE?.RESULT?.RESULT_CODE
    if (code !== 'SUCCESS') throw new BisError(502, `BIS 결과 ${String(code ?? '알 수 없음').replace(/[^\w-]/g, '').slice(0, 20)}`)
    return json
  } catch (e) {
    if (e instanceof BisError) throw e
    // 오류 객체의 문구에는 주소(키 포함)가 들어갈 수 있어 종류만 남긴다.
    throw new BisError(502, ctl.signal.aborted ? 'BIS 응답이 늦어요.' : 'BIS 호출에 실패했어요.')
  } finally {
    clearTimeout(timer)
  }
}

type Ctx = { db: D1Db; key: string; now: number; cap: number; f: typeof fetch }

// 캐시에 있으면 그대로, 없으면 하루 상한을 확인하고 한 번 호출해서 가공한 결과를 캐시에 넣는다.
async function cachedOp<T>(c: Ctx, cacheKey: string, ttl: number, op: string, params: Record<string, string>, shape: (j: Raw) => T): Promise<{ data: T; at: number; cached: boolean }> {
  const hit = await getCached(c.db, cacheKey, ttl, c.now)
  if (hit) return { data: JSON.parse(hit.body) as T, at: hit.at, cached: true }
  if (!c.key) throw new BisError(503, '실시간 중계가 아직 준비되지 않았어요.')
  if (!(await takeCall(c.db, c.now, c.cap))) throw new BisError(429, '오늘 실시간 조회 한도에 닿았어요.')
  const data = shape(await upstream(op, params, c.key, c.f))
  await putCached(c.db, cacheKey, JSON.stringify(data), c.now)
  return { data, at: c.now, cached: false }
}

const posInt = (v: string | undefined, d: number) => (Number(v) > 0 ? Math.floor(Number(v)) : d)

// 진입점(출처 확인과 OPTIONS는 index.ts에서 이미 끝났다).
export async function handleBis(request: Request, env: Env, origin: string, deps: Deps = {}): Promise<Response> {
  if (request.method !== 'GET') return err(405, 'GET만 허용합니다.', origin)
  const db = env.DB
  if (!db) return err(503, '실시간 중계가 아직 준비되지 않았어요.', origin)
  const now = (deps.now ?? Date.now)()
  const u = new URL(request.url)
  try {
    const ip = request.headers.get('cf-connecting-ip') ?? 'unknown'
    if (!(await windowAllowed(db, 'bis', ip, now, posInt(env.BIS_PER_MINUTE, DEFAULT_BIS_PER_MINUTE)))) return err(429, '잠시 뒤에 다시 해 주세요.', origin)
    const c: Ctx = { db, key: (env.DATA_GO_KR_KEY ?? '').trim(), now, cap: posInt(env.BIS_DAILY_CAP, DEFAULT_BIS_DAILY_CAP), f: deps.fetch ?? fetch }

    if (u.pathname === '/bis/arrive') {
      const id = u.searchParams.get('station') ?? ''
      if (!/^\d{1,7}$/.test(id)) return err(400, '정류소 번호 형식이 올바르지 않습니다.', origin)
      const r = await cachedOp(c, `arrive:${id}`, ARRIVE_TTL_MS, 'arriveInfo', { BUSSTOP_ID: id }, toArrivals)
      return reply({ stationId: id, collectedAt: new Date(r.at).toISOString(), arrivals: r.data, cached: r.cached }, 200, origin)
    }

    // 노선 이름으로 지금 운행 중인 버스 중 저상 수. 노선 목록은 하루 한 번만 받는다.
    const name = u.searchParams.get('name') ?? ''
    if (!/^[\w가-힣-]{1,20}$/.test(name)) return err(400, '노선 이름 형식이 올바르지 않습니다.', origin)
    const li = await cachedOp<LineRow[]>(c, 'lineinfo', LINEINFO_TTL_MS, 'lineInfo', { _: 'all' }, (j) =>
      listOf(j).map((l) => ({ id: String(l.LINE_ID ?? ''), short: String(l.SHORT_LINE_NAME ?? l.LINE_NAME ?? ''), name: String(l.LINE_NAME ?? '') })),
    )
    if (!li.cached) await prune(db, now)
    let same = li.data.filter((l) => l.short === name || l.name === name).slice(0, 2)
    // 길찾기가 주는 번호만(예: 07)이면 이름 앞에 지역 글자가 붙은 노선(진월07)으로 찾는다. 후보가 하나일 때만 인정한다.
    if (same.length === 0) {
      const tail = li.data.filter((l) => l.short.endsWith(name) && /^[^\d]+$/.test(l.short.slice(0, l.short.length - name.length)))
      if (tail.length === 1) same = tail
    }
    if (same.length === 0) return err(502, `노선 ${name}을 BIS 노선 목록에서 찾지 못했습니다.`, origin)
    let total = 0
    let low = 0
    let oldest = now
    for (const l of same) {
      if (!/^[\w-]{1,20}$/.test(l.id)) continue
      const r = await cachedOp<{ total: number; low: number }>(c, `loc:${l.id}`, LOC_TTL_MS, 'busLocationInfo', { LINE_ID: l.id }, (j) => {
        const buses = listOf(j)
        return { total: buses.length, low: buses.filter((b) => String(b.LOW_BUS) === '1').length }
      })
      total += r.data.total
      low += r.data.low
      oldest = Math.min(oldest, r.at)
    }
    return reply({ lineName: name, total, low, collectedAt: new Date(oldest).toISOString() }, 200, origin)
  } catch (e) {
    if (e instanceof BisError) return err(e.status, e.msg, origin)
    console.log('wheelmap-ai error: bis_internal') // 오류 종류만 남긴다
    return err(500, '중계 처리 중 문제가 생겼어요.', origin)
  }
}
