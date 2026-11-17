import type { Hit, Pt } from './engine.ts'
import type { Place } from './provider.ts'

// 길찾기 결과를 지도에 그리기 위한 정보(RoutePanel → BarrierMap)
export type RouteMarker = { lat: number; lng: number; text: string; title: string; cls: string }
// 버스 타고 가는 길(7단계): 걷는 구간(파란 점선)과 버스 구간(노선 종류 색 실선)을 따로 그린다
export type RouteLeg = { coords: Pt[]; kind: 'walk' | 'bus'; route?: string; lineName?: string }
export type RouteOverlay = {
  start: Place
  end: Place
  base: Pt[] | null
  detour: Pt[] | null
  legs?: RouteLeg[]
  active: 'base' | 'detour'
  hits: Hit[]
  unresolvedIds: string[]
  markers: RouteMarker[]
  focus: string | null
  fitKey: number
  /** 안내 모드: 지금 단계를 지도에서 강조한다 */
  guide?: { coords: Pt[]; next: Pt[]; at: Pt; turn: string; n: number }
  /** 자체 보행망(OpenStreetMap) 경로를 보여 줄 때 true: 출처 표시를 같이 보인다 */
  osm?: boolean
}
