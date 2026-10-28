import demo from '../../../data/routes/demo.json'
import pairsData from '../../../data/routes/pairs.json'
import { viaKey, type Pt, type RouteData } from './engine.ts'

// 경로 가져오기. 배포(빌드)에서는 미리 저장한 시연 경로(data/routes/demo.json)만 쓰고,
// 개발 서버에서는 저장본이 없을 때만 개발 서버 중계(vite.config.ts)를 통해 TMAP을 부른다. 키는 브라우저에 없다.

export type Place = { name: string; lat: number; lng: number; address?: string; id?: string }
export type DemoPair = { id: string; label: string; fromId: string; toId: string; fromName: string; toName: string }
export const DEMO_PAIRS = pairsData as DemoPair[]

// 개발 모드에서만 자유 검색(빌드에서는 false로 치환되어 중계 호출 코드가 제거된다)
export const FREE_SEARCH: boolean = import.meta.env.DEV

type Stored = Record<string, { routes: Record<string, RouteData> }>
const STORED = (demo as unknown as { pairs: Stored }).pairs

export type NetStats = { stored: number; requested: number; cached: number; error: string }
export const newStats = (): NetStats => ({ stored: 0, requested: 0, cached: 0, error: '' })

const memory = new Map<string, RouteData>()

async function viaRelay(from: Place, to: Place, via: Pt[], opt: number | undefined, stats: NetStats): Promise<RouteData | null> {
  const mk = `${from.lat},${from.lng}|${to.lat},${to.lng}|${viaKey(via, opt)}`
  const hit = memory.get(mk)
  if (hit) {
    stats.cached++
    return hit
  }
  try {
    const r = await fetch('/wheel-map/__tmap/pedestrian', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: [from.lat, from.lng], to: [to.lat, to.lng], fromName: from.name, toName: to.name, via, ...(opt ? { searchOption: opt } : {}) }),
    })
    if (!r.ok) {
      stats.error =
        r.status === 404 || r.status === 405
          ? '경로 중계를 찾지 못했습니다. 개발 서버를 다시 시작해야 할 수 있습니다.'
          : '경로를 받지 못했습니다(TMAP 응답 오류 또는 경로 없음).'
      return null
    }
    const route = (await r.json()) as RouteData
    if (r.headers.get('X-Tmap-Cache') === 'hit') stats.cached++
    else stats.requested++
    memory.set(mk, route)
    return route
  } catch {
    stats.error = '경로 중계에 연결하지 못했습니다.'
    return null
  }
}

// pairId가 있으면 저장본을 먼저 본다. 저장본에 없는 조합은 배포에서는 'not-stored'(확인하지 못함).
export function makeFetcher(pairId: string | null, from: Place, to: Place, stats: NetStats) {
  return async (via: Pt[], opt?: number): Promise<RouteData | null | 'not-stored'> => {
    const stored = pairId ? STORED[pairId]?.routes[viaKey(via, opt)] : undefined
    if (stored) {
      stats.stored++
      return stored
    }
    if (import.meta.env.DEV) return viaRelay(from, to, via, opt, stats)
    return 'not-stored'
  }
}
