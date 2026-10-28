// TMAP 보행자 경로 호출(서버·스크립트 전용, 브라우저 번들에 들어가지 않는다).
// 개발 서버 중계(vite.config.ts)와 scripts/prefetch.ts가 함께 쓴다. appKey는 호출하는 쪽이 .env에서 읽어 넘긴다.
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { parseTmap, viaKey, type Pt, type RouteData } from '../src/lib/routing/engine.ts'

export type TmapReq = { from: Pt; to: Pt; fromName?: string; toName?: string; via: Pt[]; searchOption?: number }

// 보행자 경로 searchOption(SK open API 문서): 0 추천(기본), 4 추천+대로우선, 10 최단, 30 최단+계단 제외
const OPTIONS = [4, 10, 30]

const inKorea = (p: unknown): p is Pt =>
  Array.isArray(p) && p.length === 2 && typeof p[0] === 'number' && typeof p[1] === 'number' && p[0] > 33 && p[0] < 39 && p[1] > 124 && p[1] < 132

// 중계로 들어온 요청 검증(허용된 필드만, 국내 좌표만, 경유지 5개 이하).
export function validateReq(x: unknown): TmapReq | null {
  const r = x as Partial<TmapReq> | null
  if (!r || !inKorea(r.from) || !inKorea(r.to)) return null
  const via = Array.isArray(r.via) ? r.via : []
  if (via.length > 5 || !via.every(inKorea)) return null
  const nm = (s: unknown) => (typeof s === 'string' ? s.slice(0, 40) : undefined)
  const so = typeof r.searchOption === 'number' && OPTIONS.includes(r.searchOption) ? r.searchOption : undefined
  return { from: r.from, to: r.to, fromName: nm(r.fromName), toName: nm(r.toName), via, ...(so ? { searchOption: so } : {}) }
}

export const cacheDirOf = (root: string) => path.join(root, 'data', 'routes', '.cache')

export function cacheKey(req: TmapReq): string {
  const f = (p: Pt) => `${p[1].toFixed(6)},${p[0].toFixed(6)}`
  return crypto.createHash('sha1').update(`${f(req.from)}|${f(req.to)}|${viaKey(req.via, req.searchOption)}`).digest('hex').slice(0, 20)
}

function bumpCounter(cacheDir: string) {
  try {
    const p = path.join(cacheDir, 'calls.json')
    let v: { total: number; days: Record<string, number> } = { total: 0, days: {} }
    try {
      v = JSON.parse(fs.readFileSync(p, 'utf8'))
    } catch {
      /* 처음 호출 */
    }
    const day = new Date().toISOString().slice(0, 10)
    v.total++
    v.days[day] = (v.days[day] ?? 0) + 1
    fs.writeFileSync(p, JSON.stringify(v))
  } catch {
    /* 카운터 실패는 무시 */
  }
}

// 캐시 → (없으면) 실제 호출. 실패는 캐시하지 않는다. 오류 문구에는 키를 넣지 않는다.
export async function callTmap(req: TmapReq, appKey: string, root: string): Promise<{ route: RouteData | null; fromCache: boolean; error?: string }> {
  const dir = cacheDirOf(root)
  fs.mkdirSync(dir, { recursive: true })
  const file = path.join(dir, cacheKey(req) + '.json')
  try {
    return { route: JSON.parse(fs.readFileSync(file, 'utf8')) as RouteData, fromCache: true }
  } catch {
    /* 캐시 없음 */
  }
  if (!appKey) return { route: null, fromCache: false, error: 'TMAP_APP_KEY가 .env에 없습니다.' }
  const body: Record<string, unknown> = {
    startX: req.from[1],
    startY: req.from[0],
    endX: req.to[1],
    endY: req.to[0],
    reqCoordType: 'WGS84GEO',
    resCoordType: 'WGS84GEO',
    startName: encodeURIComponent(req.fromName ?? '출발'),
    endName: encodeURIComponent(req.toName ?? '도착'),
  }
  if (req.searchOption) body.searchOption = req.searchOption
  if (req.via.length > 0) body.passList = req.via.map((p) => `${p[1].toFixed(6)},${p[0].toFixed(6)}`).join('_')
  bumpCounter(dir)
  try {
    const r = await fetch('https://apis.openapi.sk.com/tmap/routes/pedestrian?version=1', {
      method: 'POST',
      headers: { appKey, 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(body),
    })
    if (!r.ok) return { route: null, fromCache: false, error: `TMAP 응답 오류 HTTP ${r.status}` }
    const route = parseTmap(await r.json())
    if (!route) return { route: null, fromCache: false, error: 'TMAP 응답에서 경로를 읽지 못했습니다.' }
    fs.writeFileSync(file, JSON.stringify(route))
    return { route, fromCache: false }
  } catch (e) {
    return { route: null, fromCache: false, error: 'TMAP 호출 실패: ' + (e instanceof Error ? e.message : String(e)).split(appKey).join('<KEY>') }
  }
}
