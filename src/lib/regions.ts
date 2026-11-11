import { loadKakao } from './kakao'

// 좌표 → 행정동(카카오 coord2RegionCode). 결과는 localStorage에 캐시한다(좌표를 코드에 적지 않는다).
const KEY = 'wheelmap.dongCache'
const CONCURRENCY = 6 // 동시에 보내는 조회 수
const DEADLINE_MS = 8000 // 이 시간이 지나면 찾은 데까지만 돌려준다

function readCache(): Record<string, string> {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? '{}') as Record<string, string>
  } catch {
    return {}
  }
}

function writeCache(cache: Record<string, string>) {
  try {
    localStorage.setItem(KEY, JSON.stringify(cache))
  } catch {
    /* 캐시 저장 실패는 무시 */
  }
}

export const dongKey = (lat: number, lng: number) => `${lat.toFixed(4)},${lng.toFixed(4)}`

export type DongResult = {
  dongs: Record<string, string>
  /** 시간 안에 못 찾았거나 조회가 실패한 서로 다른 지점 수 */
  missing: number
  /** 카카오 SDK를 불러오지 못했거나 시간 안에 뜨지 않았는가 */
  sdkFailed: boolean
}

type Status = 'ok' | 'zero' | 'fail'

// 같은 좌표(소수 4자리)는 한 번만 조회하고, 동시 요청 수를 제한하며, 전체 제한 시간을 둔다.
// 실패해도 예외를 던지지 않고 찾은 만큼 돌려준다(그래서 "찾고 있어요…"로 영원히 남지 않는다).
export async function loadDongsDetailed(points: { lat: number; lng: number }[]): Promise<DongResult> {
  const cache = readCache()
  const todo = new Map<string, { lat: number; lng: number }>()
  for (const p of points) {
    const key = dongKey(p.lat, p.lng)
    if (!cache[key] && !todo.has(key)) todo.set(key, p)
  }
  if (todo.size === 0) return { dongs: cache, missing: 0, sdkFailed: false }

  const deadline = Date.now() + DEADLINE_MS
  const timeLeft = () => Math.max(0, deadline - Date.now())
  const timeout = <T,>(v: T) => new Promise<T>((resolve) => setTimeout(() => resolve(v), timeLeft()))

  const k = await Promise.race([loadKakao().catch(() => null), timeout(null)])
  if (!k) return { dongs: cache, missing: todo.size, sdkFailed: true }

  const geo = new k.maps.services.Geocoder()
  const queue = [...todo.entries()]
  let found = 0
  let dirty = 0

  const lookup = (p: { lat: number; lng: number }) =>
    new Promise<{ s: Status; name: string }>((resolve) => {
      try {
        geo.coord2RegionCode(p.lng, p.lat, (res, status) => {
          if (status === k.maps.services.Status.OK) {
            const h = res.find((x) => x.region_type === 'H') ?? res[0]
            resolve({ s: 'ok', name: h?.region_3depth_name ?? '확인 필요' })
          } else if (status === k.maps.services.Status.ZERO_RESULT) resolve({ s: 'zero', name: '확인 필요' })
          else resolve({ s: 'fail', name: '' })
        })
      } catch {
        resolve({ s: 'fail', name: '' })
      }
    })

  const worker = async () => {
    while (queue.length > 0 && timeLeft() > 0) {
      const [key, p] = queue.shift() as [string, { lat: number; lng: number }]
      const r = await Promise.race([lookup(p), timeout<{ s: Status; name: string }>({ s: 'fail', name: '' })])
      if (r.s === 'fail') continue // 실패는 캐시하지 않는다(다음에 다시 시도)
      cache[key] = r.name
      found++
      dirty++
      if (dirty >= 20) {
        writeCache(cache)
        dirty = 0
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, queue.length) }, worker))
  if (found > 0) writeCache(cache)

  const missing = [...todo.keys()].filter((key) => !cache[key]).length
  return { dongs: cache, missing, sdkFailed: false }
}

// 기존 호출용: 찾은 만큼의 지도(캐시 포함)를 돌려준다.
export async function loadDongs(points: { lat: number; lng: number }[]): Promise<Record<string, string>> {
  return (await loadDongsDetailed(points)).dongs
}
