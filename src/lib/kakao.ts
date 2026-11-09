// 카카오맵 JavaScript SDK 로더. 키는 .env의 VITE_KAKAO_JS_KEY에서 읽는다(코드에 쓰지 않는다).
// 도메인 제한이 걸린 JS 키만 브라우저에 노출한다. REST 키는 여기서 쓰지 않는다.

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
  | { status: 'ok'; items: kakao.maps.services.PlaceResult[] }
  | { status: 'empty' }
  | { status: 'error' }

// 카카오 장소 검색(JS SDK Places). 결과는 '후보'일 뿐이며 확정은 사용자가 한다.
export function keywordSearch(k: typeof kakao, query: string, size = 5): Promise<KeywordSearchResult> {
  return new Promise((resolve) => {
    const places = new k.maps.services.Places()
    places.keywordSearch(
      query,
      (items, status) => {
        if (status === k.maps.services.Status.OK && items.length > 0) resolve({ status: 'ok', items })
        else if (status === k.maps.services.Status.ZERO_RESULT) resolve({ status: 'empty' })
        else resolve({ status: 'error' })
      },
      { size },
    )
  })
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
