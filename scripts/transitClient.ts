// TMAP 대중교통 경로 호출(서버·스크립트 전용, 브라우저 번들에 들어가지 않는다).
// 개발 서버 중계(vite.config.ts)와 scripts/prefetch.ts가 함께 쓴다. appKey는 호출하는 쪽이 .env에서 읽어 넘긴다.
// SK open API 상품 정보(공식 문서 확인): 대중교통 API 무료 상품은 하루 10건 → 하루 호출 상한을 스스로 건다(TRANSIT_DAILY_CAP).
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import type { Pt } from '../src/lib/routing/engine.ts'
import { parseTransit, type TItinerary } from '../src/lib/transit/parse.ts'

export const TRANSIT_DAILY_CAP = 8 // 무료 10건/일 중 여유 2건을 남긴다. 유료 상품이면 올려도 된다.

export type TransitReq = { from: Pt; to: Pt }
const inKorea = (p: unknown): p is Pt =>
  Array.isArray(p) && p.length === 2 && typeof p[0] === 'number' && typeof p[1] === 'number' && p[0] > 33 && p[0] < 39 && p[1] > 124 && p[1] < 132

export function validateTransitReq(x: unknown): TransitReq | null {
  const r = x as Partial<TransitReq> | null
  if (!r || !inKorea(r.from) || !inKorea(r.to)) return null
  return { from: r.from, to: r.to }
}

const dirOf = (root: string) => path.join(root, 'data', 'routes', '.cache')
const keyOf = (r: TransitReq) => {
  const f = (p: Pt) => `${p[1].toFixed(6)},${p[0].toFixed(6)}`
  return 'transit-' + crypto.createHash('sha1').update(`${f(r.from)}|${f(r.to)}`).digest('hex').slice(0, 20)
}

export function transitCallsToday(root: string): number {
  try {
    const v = JSON.parse(fs.readFileSync(path.join(dirOf(root), 'transit-calls.json'), 'utf8')) as { days: Record<string, number> }
    return v.days[new Date().toISOString().slice(0, 10)] ?? 0
  } catch {
    return 0
  }
}
function bump(root: string) {
  try {
    const p = path.join(dirOf(root), 'transit-calls.json')
    let v: { total: number; days: Record<string, number> } = { total: 0, days: {} }
    try {
      v = JSON.parse(fs.readFileSync(p, 'utf8'))
    } catch {
      /* 처음 */
    }
    const day = new Date().toISOString().slice(0, 10)
    v.total++
    v.days[day] = (v.days[day] ?? 0) + 1
    fs.writeFileSync(p, JSON.stringify(v))
  } catch {
    /* 무시 */
  }
}

export type TransitOut =
  | { ok: true; itineraries: TItinerary[]; fromCache: boolean }
  | { ok: false; error: string; code?: string; limit?: boolean }

// 캐시 → (없으면) 실제 호출. 실패는 캐시하지 않는다. 오류 문구에는 키를 넣지 않는다.
export async function callTransit(req: TransitReq, appKey: string, root: string): Promise<TransitOut> {
  const dir = dirOf(root)
  fs.mkdirSync(dir, { recursive: true })
  const file = path.join(dir, keyOf(req) + '.json')
  try {
    return { ok: true, itineraries: JSON.parse(fs.readFileSync(file, 'utf8')) as TItinerary[], fromCache: true }
  } catch {
    /* 캐시 없음 */
  }
  if (!appKey) return { ok: false, error: 'TMAP_APP_KEY가 .env에 없습니다.' }
  if (transitCallsToday(root) >= TRANSIT_DAILY_CAP) return { ok: false, error: `오늘 대중교통 길찾기 호출 상한(${TRANSIT_DAILY_CAP}회)에 닿았습니다.`, limit: true }
  bump(root)
  try {
    const r = await fetch('https://apis.openapi.sk.com/transit/routes', {
      method: 'POST',
      headers: { appKey, 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ startX: String(req.from[1]), startY: String(req.from[0]), endX: String(req.to[1]), endY: String(req.to[0]), lang: 0, format: 'json', count: 3 }),
    })
    const text = await r.text()
    let json: unknown = null
    try {
      json = JSON.parse(text)
    } catch {
      /* 아래에서 처리 */
    }
    const p = parseTransit(json)
    if (!p.ok) return { ok: false, code: p.code, error: `대중교통 경로 없음/오류 (HTTP ${r.status}, 코드 ${p.code || '-'}): ${p.message}`.split(appKey).join('<KEY>') }
    fs.writeFileSync(file, JSON.stringify(p.itineraries))
    return { ok: true, itineraries: p.itineraries, fromCache: false }
  } catch (e) {
    return { ok: false, error: '대중교통 호출 실패: ' + (e instanceof Error ? e.message : String(e)).split(appKey).join('<KEY>') }
  }
}
