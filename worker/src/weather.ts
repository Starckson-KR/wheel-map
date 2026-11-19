import { reply } from './account.ts'
import { windowAllowed } from './limit.ts'
import { toWeather, weatherUrl } from './weatherCore.ts'
import type { WeatherNow } from './weatherCore.ts'
import type { D1Db, Env } from './types'

// 날씨 중계: GET /weather → { ok:true, tempC, condition, observedAt } 또는 오류.
// 키(DATA_GO_KR_KEY, 광주 BIS와 같은 secret)는 Worker 안에서만 쓰고 응답·로그·오류에 내보내지 않는다(오류는 종류만).
// 10분 캐시는 BIS와 같은 D1 표(bis_cache)를 쓴다(workers.dev 주소는 Cache API가 안 돼서). 실패도 2분 동안 기억해 상류를 두드리지 않는다.
// 호출 수: 10분에 실황·예보 각 1건 = 하루 288건 안팎이라 별도 하루 상한은 두지 않고 IP별 분당 제한만 건다.
export const WEATHER_TTL_MS = 10 * 60_000
export const WEATHER_FAIL_TTL_MS = 2 * 60_000
const UPSTREAM_TIMEOUT_MS = 6000
const KEY = 'weather:yongbong'

export const isWeatherPath = (p: string) => p === '/weather'
export type Deps = { now?: () => number; fetch?: typeof fetch }

async function getJson(url: string, f: typeof fetch): Promise<unknown> {
  const ctl = new AbortController()
  const timer = setTimeout(() => ctl.abort(), UPSTREAM_TIMEOUT_MS)
  try {
    const r = await f(url, { signal: ctl.signal })
    if (!r.ok) return null
    return JSON.parse(await r.text())
  } catch {
    return null // 오류 객체에는 주소(키 포함)가 들어갈 수 있어 내용은 버린다
  } finally {
    clearTimeout(timer)
  }
}

async function readCache(db: D1Db, now: number): Promise<{ w: WeatherNow | null } | null> {
  const r = await db.prepare('SELECT body, fetched_at AS at FROM bis_cache WHERE key = ?').bind(KEY).first<{ body: string; at: number }>()
  if (!r || now < r.at) return null
  const w = JSON.parse(r.body) as WeatherNow | null
  return now - r.at < (w ? WEATHER_TTL_MS : WEATHER_FAIL_TTL_MS) ? { w } : null
}

export async function handleWeather(request: Request, env: Env, origin: string, deps: Deps = {}): Promise<Response> {
  if (request.method !== 'GET') return reply({ ok: false, error: 'GET만 허용합니다.' }, 405, origin)
  const db = env.DB
  if (!db) return reply({ ok: false, error: 'unavailable' }, 503, origin)
  const now = (deps.now ?? Date.now)()
  try {
    const ip = request.headers.get('cf-connecting-ip') ?? 'unknown'
    if (!(await windowAllowed(db, 'weather', ip, now, 30))) return reply({ ok: false, error: 'rate_limited' }, 429, origin)
    let hit = await readCache(db, now)
    if (!hit) {
      const key = (env.DATA_GO_KR_KEY ?? '').trim()
      if (!key) return reply({ ok: false, error: 'unavailable' }, 503, origin)
      const f = deps.fetch ?? fetch
      const [n, fc] = await Promise.all([getJson(weatherUrl('getUltraSrtNcst', key, now), f), getJson(weatherUrl('getUltraSrtFcst', key, now), f)])
      const w = toWeather(n, fc)
      await db
        .prepare('INSERT INTO bis_cache(key, body, fetched_at) VALUES(?,?,?) ON CONFLICT(key) DO UPDATE SET body=excluded.body, fetched_at=excluded.fetched_at')
        .bind(KEY, JSON.stringify(w), now)
        .run()
      hit = { w }
    }
    if (!hit.w) return reply({ ok: false, error: 'upstream' }, 502, origin)
    return reply({ ok: true, ...hit.w }, 200, origin)
  } catch {
    console.log('wheelmap-ai error: weather_internal') // 오류 종류만 남긴다
    return reply({ ok: false, error: 'internal' }, 500, origin)
  }
}
