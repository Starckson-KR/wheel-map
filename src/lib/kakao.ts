// 카카오맵 JavaScript SDK 로더. 키는 .env의 VITE_KAKAO_JS_KEY에서 읽는다(코드에 쓰지 않는다).
// 도메인 제한이 걸린 JS 키만 브라우저에 노출한다. REST 키는 여기서 쓰지 않는다.

import { rankPlaces, type LatLngLike } from './placeRank.ts'

const SDK_URL = 'https://dapi.kakao.com/v2/maps/sdk.js'

let loading: Promise<typeof kakao> | null = null

export function loadKakao(): Promise<typeof kakao> {
  if (loading) return loading

  const key = import.meta.env.VITE_KAKAO_JS_KEY
  if (!key) {
    return Promise.reject(new Error('VITE_KAKAO_JS_KEY가 설정되어 있지 않습니다. .env 파일을 확인해 주세요.'))
  }

  loading = new Promise((resolve, reject) => {
    const script = document.createElement('script')
    script.src = `${SDK_URL}?appkey=${encodeURIComponent(key)}&libraries=services&autoload=false`
    script.async = true
    script.onload = () => window.kakao.maps.load(() => resolve(window.kakao))
    script.onerror = () => {
      loading = null
      reject(new Error(`카카오맵 SDK를 불러오지 못했습니다. 키와 웹 도메인 등록(${window.location.origin})을 확인해 주세요.`))
    }
    document.head.appendChild(script)
  })
  return loading
}

// TODO(확인 필요): 지도 중심은 좌표를 직접 적지 않고, 카카오 지오코더로 아래 주소를 조회해 정한다.
// 최종 중심 좌표는 사용자가 지도에서 확인한 뒤 확정한다.
export const CENTER_ADDRESS_CANDIDATES = [
  '광주 북구 용봉동 300',
  '전남광주통합특별시 북구 용봉동 300',
]

export type KeywordSearchResult =
  // outsideBukgu: 광주 북구 결과가 하나도 없을 때 true(화면에 안내 문구를 띄운다)
  | { status: 'ok'; items: kakao.maps.services.PlaceResult[]; outsideBukgu: boolean }
  | { status: 'empty' }
  | { status: 'error' }

// 장소 검색 기준점(전남대·용봉동 일대). 좌표를 코드에 적지 않고 지도 중심과 같은 주소를 지오코딩해 한 번만 구한다.
let anchorPromise: Promise<LatLngLike | null> | null = null
function searchAnchor(k: typeof kakao): Promise<LatLngLike | null> {
  if (anchorPromise) return anchorPromise
  anchorPromise = (async () => {
    for (const address of CENTER_ADDRESS_CANDIDATES) {
      const c = await geocode(k, address)
      if (c) return { lat: c.getLat(), lng: c.getLng() }
    }
    return null
  })()
  void anchorPromise.then((a) => {
    if (!a) anchorPromise = null // 실패는 다음에 다시 시도
  })
  return anchorPromise
}

const NEAR_RADIUS_M = 5000 // 1차: 기준점 반경(북구청·후문·정류장까지 닿는 거리)
const PAGE = 15 // Places 한 페이지 최대 개수

function rawSearch(
  k: typeof kakao,
  query: string,
  options: kakao.maps.services.PlacesSearchOptions,
): Promise<{ items: kakao.maps.services.PlaceResult[]; status: 'ok' | 'empty' | 'error' }> {
  return new Promise((resolve) => {
    new k.maps.services.Places().keywordSearch(
      query,
      (items, status) => {
        if (status === k.maps.services.Status.OK && items.length > 0) resolve({ items, status: 'ok' })
        else if (status === k.maps.services.Status.ZERO_RESULT) resolve({ items: [], status: 'empty' })
        else resolve({ items: [], status: 'error' })
      },
      options,
    )
  })
}

// 카카오 장소 검색(JS SDK Places). 결과는 '후보'일 뿐이며 확정은 사용자가 한다.
// 공통 규칙: 기준점 반경 5km를 거리순으로 먼저 찾고(1회), 결과가 없거나 북구 결과가 없으면 반경 없이 전국에서 거리순으로 한 번 더 찾아 합친다(2회, 최대 2회).
// 받은 결과는 광주 북구 → 광주 다른 구 → 나머지, 같은 묶음에서는 기준점에서 가까운 순으로 다시 정렬한다.
export async function keywordSearch(k: typeof kakao, query: string, size = 5): Promise<KeywordSearchResult> {
  const anchor = await searchAnchor(k).catch(() => null)
  let r
  if (anchor) {
    const location = new k.maps.LatLng(anchor.lat, anchor.lng)
    const sort = k.maps.services.SortBy.DISTANCE
    r = await rawSearch(k, query, { size: PAGE, location, radius: NEAR_RADIUS_M, sort })
    // 반경 안에 결과가 없거나, 있어도 북구 결과가 없으면 반경 없이 한 번 더 찾아 합친다(최대 2회).
    if (r.status === 'empty' || (r.status === 'ok' && !rankPlaces(r.items, anchor).hasBukgu)) {
      const wide = await rawSearch(k, query, { size: PAGE, location, sort })
      if (wide.status === 'ok') {
        const seen = new Set(r.items.map((p) => p.id))
        r = { status: 'ok' as const, items: [...r.items, ...wide.items.filter((p) => !seen.has(p.id))] }
      } else if (r.status === 'empty') r = wide
    }
  } else {
    r = await rawSearch(k, query, { size: PAGE })
  }
  if (r.status !== 'ok') return { status: r.status }
  const ranked = rankPlaces(r.items, anchor)
  return { status: 'ok', items: ranked.items.slice(0, size), outsideBukgu: !ranked.hasBukgu }
}

export function geocode(k: typeof kakao, address: string): Promise<kakao.maps.LatLng | null> {
  return new Promise((resolve) => {
    const geocoder = new k.maps.services.Geocoder()
    geocoder.addressSearch(address, (result, status) => {
      if (status === k.maps.services.Status.OK && result.length > 0) {
        resolve(new k.maps.LatLng(Number(result[0].y), Number(result[0].x)))
      } else {
        resolve(null)
      }
    })
  })
}

// 좌표 → 주소(도로명 우선). 실패하면 null.
export function reverseGeocode(k: typeof kakao, lat: number, lng: number): Promise<string | null> {
  return new Promise((resolve) => {
    try {
      new k.maps.services.Geocoder().coord2Address(lng, lat, (result, status) => {
        if (status === k.maps.services.Status.OK && result.length > 0) {
          resolve(result[0].road_address?.address_name ?? result[0].address?.address_name ?? null)
        } else resolve(null)
      })
    } catch {
      resolve(null)
    }
  })
}
