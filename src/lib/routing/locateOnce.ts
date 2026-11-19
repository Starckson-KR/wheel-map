// 브라우저 위치를 한 번 묻는다(출발지 '내 위치'용). 위치는 화면 계산에만 쓰고 저장·전송하지 않는다.
import type { PermState, StartPos } from './startPlace.ts'

export const hasGeo = () => typeof navigator !== 'undefined' && 'geolocation' in navigator

/** 위치 권한 상태. 조회를 지원하지 않는 브라우저(일부 아이폰)는 'unknown' */
export async function readGeoPermission(): Promise<PermState> {
  try {
    const s = await navigator.permissions?.query({ name: 'geolocation' as PermissionName })
    return s ? (s.state as PermState) : 'unknown'
  } catch {
    return 'unknown'
  }
}

/** 시간 제한 안에 위치를 못 받으면 null. 2분 안의 최근 위치는 다시 쓴다 */
export function locateOnce(timeoutMs = 5000): Promise<StartPos | null> {
  return new Promise((resolve) => {
    if (!hasGeo()) return resolve(null)
    const timer = setTimeout(() => resolve(null), timeoutMs + 500)
    navigator.geolocation.getCurrentPosition(
      (p) => {
        clearTimeout(timer)
        resolve({ lat: p.coords.latitude, lng: p.coords.longitude })
      },
      () => {
        clearTimeout(timer)
        resolve(null)
      },
      { enableHighAccuracy: false, timeout: timeoutMs, maximumAge: 120_000 },
    )
  })
}
