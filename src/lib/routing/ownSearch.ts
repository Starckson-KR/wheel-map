// 자체 보행망 길찾기 한 번: 기본 길(장애요소 벌점 없음)과 피해 가는 길(장애요소 벌점 있음)을 같은 보행망에서 구하고,
// 기존 TMAP 방식과 같은 모양(SearchResult)으로 돌려준다. 그래서 화면의 카드·판정·타임라인을 그대로 쓴다.
import { analyze, summarize, type Hit, type Obstacle, type Pt, type RouteCfg, type SearchResult } from './engine.ts'
import { findWalkRoute, type OwnRoute, type SoftSpot, type WalkCfg } from './walkRoute.ts'
import { spotsNearRoute } from './layerRoute.ts'
import type { WalkGraph } from './walkGraph.ts'

const isX = (h: Hit) => h.role === 'X'
const gk = (h: Hit) => h.o.parentId ?? h.o.id

export type OwnSearch = {
  res: SearchResult
  base: OwnRoute | null
  detour: OwnRoute | null // 피해 가는 길(기본 길과 다를 때만)
  avoided: Hit[] // 기본 길에는 있었는데 피해 가는 길에는 없는 지나가기 장애요소(X·△)
  error?: 'outside' | 'no-path'
}

const sameRoute = (a: OwnRoute, b: OwnRoute) => a.coords.length === b.coords.length && a.coords.every((p, i) => p[0] === b.coords[i][0] && p[1] === b.coords[i][1])

export function searchOwn(g: WalkGraph, from: Pt, to: Pt, obstacles: Obstacle[], cfg: RouteCfg, wcfg: WalkCfg, soft: SoftSpot[] = []): OwnSearch {
  const res: SearchResult = { base: null, baseHits: [], detour: null, detourHits: [], via: [], unresolved: [], untested: [], endpoint: [], attempts: [], requests: 0, summary: { base: null, detour: null } }
  const b = findWalkRoute(g, from, to, wcfg, { avoid: false })
  if (!b.route) return { res, base: null, detour: null, avoided: [], error: b.error }
  const base = b.route
  res.base = base
  res.baseHits = analyze(base.coords, obstacles, cfg.radiusM)
  // 출발·도착 지점 자체의 X는 어떤 길도 피할 수 없다(기존 방식과 같은 처리)
  const atEnds = (h: Hit) => {
    const near = (p: Pt) => Math.hypot((h.anchor[0] - p[0]) * 111320, (h.anchor[1] - p[1]) * 111320 * Math.cos((p[0] * Math.PI) / 180)) <= cfg.radiusM
    return near(base.coords[0]) || near(base.coords[base.coords.length - 1])
  }
  const endpointIds = new Set(res.baseHits.filter((h) => isX(h) && atEnds(h)).map(gk))
  // 육교·침수 지점(soft)을 지나도 피해 가는 길을 찾아 본다
  const need = res.baseHits.some((h) => (isX(h) || h.role === 'T') && !endpointIds.has(gk(h))) || spotsNearRoute(base.coords, soft).length > 0

  let detour: OwnRoute | null = null
  if (need) {
    const a = findWalkRoute(g, from, to, wcfg, { avoid: true, obstacles, soft })
    if (a.route && !sameRoute(a.route, base) && a.route.distance <= base.distance * wcfg.maxDetourRatio) detour = a.route
  }
  const finalHits = detour ? analyze(detour.coords, obstacles, cfg.radiusM) : res.baseHits
  if (detour) {
    res.detour = detour
    res.detourHits = finalHits
  }
  const rest = finalHits.filter(isX)
  res.endpoint = rest.filter((h) => endpointIds.has(gk(h)) || atEnds(h))
  res.unresolved = rest.filter((h) => !res.endpoint.includes(h))
  res.summary.base = summarize(base.coords, res.baseHits, obstacles, [...endpointIds], cfg)
  if (detour) res.summary.detour = summarize(detour.coords, finalHits, obstacles, res.endpoint.map((h) => h.o.id), cfg)
  // 피해 간 곳: 기본 길 위의 지나가기 장애요소 중 최종 길에 없는 것
  const still = new Set(finalHits.map(gk))
  const avoided = detour ? res.baseHits.filter((h) => (isX(h) || h.role === 'T') && !still.has(gk(h)) && !endpointIds.has(gk(h))) : []
  return { res, base, detour, avoided }
}
