import { loadKakao } from './kakao'

// 좌표 → 행정동(카카오 coord2RegionCode). 결과는 localStorage에 캐시한다(좌표를 코드에 적지 않는다).
const KEY = 'wheelmap.dongCache'

function readCache(): Record<string, string> {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? '{}') as Record<string, string>
  } catch {
    return {}
  }
}

export const dongKey = (lat: number, lng: number) => `${lat.toFixed(4)},${lng.toFixed(4)}`

export async function loadDongs(points: { lat: number; lng: number }[]): Promise<Record<string, string>> {
  const cache = readCache()
  const todo = points.filter((p) => !cache[dongKey(p.lat, p.lng)])
  if (todo.length > 0) {
    const k = await loadKakao()
    const geo = new k.maps.services.Geocoder()
    for (const p of todo) {
      const name = await new Promise<string>((resolve) => {
        try {
          geo.coord2RegionCode(p.lng, p.lat, (res, status) => {
            const h = status === k.maps.services.Status.OK ? (res.find((x) => x.region_type === 'H') ?? res[0]) : undefined
            resolve(h?.region_3depth_name ?? '확인 필요')
          })
        } catch {
          resolve('확인 필요')
        }
      })
      cache[dongKey(p.lat, p.lng)] = name
    }
    try {
      localStorage.setItem(KEY, JSON.stringify(cache))
    } catch {
      /* 캐시 저장 실패는 무시 */
    }
  }
  return cache
}
