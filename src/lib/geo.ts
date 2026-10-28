import type { Geometry } from '../types'

// 두 지점 사이 거리(m), 하버사인.
export function distanceM(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371000
  const rad = Math.PI / 180
  const dLat = (lat2 - lat1) * rad
  const dLng = (lng2 - lng1) * rad
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(a))
}

// 모양의 꼭짓점 중 가장 가까운 곳까지 거리(근사값: 선분 위 최근접점은 계산하지 않는다).
export function distanceToGeometryM(lat: number, lng: number, g: Geometry): number {
  const pts = g.kind === 'point' ? [g.at] : g.path
  return Math.min(...pts.map((p) => distanceM(lat, lng, p[0], p[1])))
}
