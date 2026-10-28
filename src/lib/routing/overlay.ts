import type { Hit, Pt } from './engine.ts'
import type { Place } from './provider.ts'

// 길찾기 결과를 지도에 그리기 위한 정보(RoutePanel → BarrierMap)
export type RouteMarker = { lat: number; lng: number; text: string; title: string; cls: string }
export type RouteOverlay = {
  start: Place
  end: Place
  base: Pt[] | null
  detour: Pt[] | null
  active: 'base' | 'detour'
  hits: Hit[]
  unresolvedIds: string[]
  markers: RouteMarker[]
  focus: string | null
  fitKey: number
}
