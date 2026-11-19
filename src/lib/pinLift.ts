// 위치 고르기 중앙 핀: 지도를 끌어 놓았을 때 "실제로 옮겨졌는지" 판단하는 순수 함수.
export type LatLng = { lat: number; lng: number }

/** 두 좌표 사이 거리(m). 가까운 거리용 근사식. */
export function metersBetween(a: LatLng, b: LatLng): number {
  const dLat = (b.lat - a.lat) * 111_320
  const dLng = (b.lng - a.lng) * 111_320 * Math.cos(((a.lat + b.lat) / 2) * (Math.PI / 180))
  return Math.hypot(dLat, dLng)
}

/** 이 거리(m) 넘게 옮겨졌을 때만 "내려앉는" 반응(진동·표시)을 한다. 눌렀다 뗀 정도는 제외. */
export const PIN_MOVED_M = 1

export function pinMoved(from: LatLng | null, to: LatLng): boolean {
  return !from || metersBetween(from, to) > PIN_MOVED_M
}
