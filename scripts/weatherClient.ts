// 날씨 호출(개발 서버 전용 중계가 쓴다, 브라우저 번들에 들어가지 않는다). 기상청 호출·응답 가공은 Worker와 같은 순수 모듈(worker/src/weatherCore.ts)을 쓴다.
// serviceKey는 호출하는 쪽이 .env에서 읽어 넘기고 오류 문구에는 넣지 않는다. 10분 동안은 메모리에 둔 값을 다시 쓴다.
import { toWeather, weatherUrl } from '../worker/src/weatherCore.ts'
import type { WeatherNow } from '../worker/src/weatherCore.ts'

const TTL_MS = 10 * 60_000
let cache: { at: number; w: WeatherNow } | null = null

async function getJson(url: string): Promise<unknown> {
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(6000) })
    return r.ok ? JSON.parse(await r.text()) : null
  } catch {
    return null
  }
}

export async function callWeather(key: string): Promise<{ ok: true; w: WeatherNow; fromCache: boolean } | { ok: false; error: string }> {
  if (cache && Date.now() - cache.at < TTL_MS) return { ok: true, w: cache.w, fromCache: true }
  const k = key.trim().slice(0, 64) // .env 줄 뒤에 붙은 `# 설명` 주석을 잘라 낸다
  if (!k) return { ok: false, error: 'DATA_GO_KR_KEY가 .env에 없습니다.' }
  const now = Date.now()
  const [n, f] = await Promise.all([getJson(weatherUrl('getUltraSrtNcst', k, now)), getJson(weatherUrl('getUltraSrtFcst', k, now))])
  const w = toWeather(n, f)
  if (!w) return { ok: false, error: '날씨를 받지 못했습니다.' }
  cache = { at: now, w }
  return { ok: true, w, fromCache: false }
}
