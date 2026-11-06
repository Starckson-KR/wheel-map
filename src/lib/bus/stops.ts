// 정류소 짝짓기(순수 함수). 브라우저와 Node가 함께 쓴다. 좌표는 [위도, 경도].
import { distM, type Pt } from '../routing/engine.ts'
import type { StopRef } from './types.ts'

export type BisStop = { id: string; name: string; lat: number; lng: number; ars?: string; next?: string }

export const PILOT_MATCH_RADIUS_M = 40 // 시범 정류장 ↔ BIS 정류소: 좌표 40m 이내(사용자 지시)
export const TRANSIT_MATCH_RADIUS_M = 60 // TMAP 경로의 정류장 ↔ BIS 정류소(이름이 같으면 더 멀어도 인정하지 않고 이 범위 안에서만)

const norm = (s: string) => s.replace(/[\s()·\-,.]/g, '').toLowerCase()

/** 점(또는 영역의 꼭짓점·중심)에서 가까운 BIS 정류소를 거리순으로 */
export function stopsNear(points: Pt[], list: BisStop[], radiusM: number): StopRef[] {
  const out: StopRef[] = []
  for (const s of list) {
    const d = Math.min(...points.map((p) => distM(p, [s.lat, s.lng])))
    if (d <= radiusM) out.push({ stationId: s.id, name: s.name, ...(s.ars ? { ars: s.ars } : {}), ...(s.next ? { next: s.next } : {}), distM: Math.round(d) })
  }
  return out.sort((a, b) => a.distM - b.distM)
}

export type PilotStatus = 'ok' | 'ambiguous' | 'none'
// 시범 정류장 한 곳의 짝짓기 결과. 가장 가까운 후보가 25m 이내이고, 후보가 하나뿐이거나 1·2위 거리 차가 10m 이상이면 ok, 아니면 애매(ambiguous)로 표시한다.
export function classifyMatch(matches: StopRef[]): { status: PilotStatus; primary: string | null; note: string } {
  if (matches.length === 0) return { status: 'none', primary: null, note: `${PILOT_MATCH_RADIUS_M}m 안에 BIS 정류소가 없음` }
  if (matches[0].distM > 25) return { status: 'ambiguous', primary: matches[0].stationId, note: `가장 가까운 정류소가 ${matches[0].distM}m로 멀어 같은 정류장인지 확인 필요` }
  if (matches.length === 1) return { status: 'ok', primary: matches[0].stationId, note: '' }
  const gap = matches[1].distM - matches[0].distM
  if (gap >= 10) return { status: 'ok', primary: matches[0].stationId, note: `반대편 후보 ${matches.length - 1}개 있음` }
  return { status: 'ambiguous', primary: matches[0].stationId, note: `후보 ${matches.length}개가 비슷한 거리(1·2위 차 ${gap}m) — 방면 확인 필요` }
}

/** TMAP 경로의 정류장(이름·좌표·다음 정류장 이름) → BIS 정류소. 이름 일치·진행 방향 일치를 거리보다 우선한다. */
export function matchBisStop(stop: { name: string; lat: number; lng: number }, nextName: string | undefined, list: BisStop[]): { stop: BisStop; distM: number } | null {
  let best: { stop: BisStop; distM: number; score: number } | null = null
  for (const s of list) {
    const d = distM([stop.lat, stop.lng], [s.lat, s.lng])
    if (d > TRANSIT_MATCH_RADIUS_M) continue
    let score = d
    const a = norm(stop.name)
    const b = norm(s.name)
    if (a && (a === b || a.includes(b) || b.includes(a))) score -= 40
    if (nextName && s.next && norm(nextName) === norm(s.next)) score -= 30
    if (!best || score < best.score) best = { stop: s, distM: Math.round(d), score }
  }
  return best ? { stop: best.stop, distM: best.distM } : null
}

export type PilotStopEntry = { barrierId: string; matches: StopRef[]; status: PilotStatus; primary: string | null; note: string }
export type PilotStopsFile = { source: string; generatedAt: string; radiusM: number; items: Record<string, PilotStopEntry> }
