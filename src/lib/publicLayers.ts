// 공공데이터 레이어(참고 정보). ○△X 판정과 무관하며, 데이터는 레이어를 켤 때 동적 import로 불러온다.
import { voucherHasAccessInfo } from './vouchers'

export type PubLayerId = 'crosswalk' | 'toilet' | 'facility' | 'bus' | 'voucher' | 'overpass' | 'welfare' | 'yellow' | 'flood' | 'shade' | 'airSignal' | 'schoolZone' | 'parkingZone'

export type PubItem = {
  id: string
  name: string
  lat: number | null
  lng: number | null
  address: string
  fields: Record<string, unknown>
}

export type PubDataset = {
  source: string
  provider: string
  url: string
  license: string
  fetchedAt: string
  count: number
  /** 핀으로 묶기 전 원본 기록 수(침수 이력) */
  recordCount?: number
  items: PubItem[]
}

export type PubLayerInfo = { id: PubLayerId; label: string; color: string; icon: string; desc: string }

// 색은 ○△X(초록·주황·빨강·회색)와 겹치지 않는 중립색. 모양은 선 아이콘(Icon.tsx 이름)으로 구분한다.
export const ALL_PUB_LAYERS: PubLayerInfo[] = [
  { id: 'crosswalk', label: '횡단보도', color: '#455a64', icon: 'cross', desc: '보도턱 낮춤 여부·폭 (북구 285곳)' },
  { id: 'toilet', label: '장애인화장실', color: '#5e35b1', icon: 'access', desc: '공중화장실과 장애인용 시설 수' },
  { id: 'facility', label: '장애인편의시설', color: '#6d4c41', icon: 'building', desc: '편의시설 현황 (시설 유형별)' },
  { id: 'bus', label: '버스 정류장', color: '#1e6fb5', icon: 'bus', desc: '정류소 이름과 번호' },
  { id: 'voucher', label: '상품권 가맹점', color: '#ad1457', icon: 'ticket', desc: '용봉동 지역사랑상품권 가맹점과 출입구 정보' },
  // 북구 공공데이터 파일 6종(2026-11-19). 모두 기본은 꺼짐.
  { id: 'overpass', label: '육교', color: '#00838f', icon: 'bridge', desc: '육교 위치와 장애인 편의시설 여부' },
  { id: 'welfare', label: '장애인시설', color: '#8e24aa', icon: 'heart', desc: '장애인 복지시설 위치와 운영기관' },
  { id: 'yellow', label: '옐로카펫', color: '#a15c00', icon: 'zebra', desc: '어린이 보호구역 옐로카펫 위치' },
  { id: 'flood', label: '침수 이력', color: '#0277bd', icon: 'drop', desc: '2025년 침수 피해가 있었던 곳' },
  { id: 'shade', label: '그늘막', color: '#827717', icon: 'umbrella', desc: '고정형·스마트형 그늘막 위치' },
  { id: 'airSignal', label: '대기질 신호등', color: '#00695c', icon: 'wind', desc: '대기질 신호등이 있는 교차로' },
  // 광주 C-ITS(2026-11-19). 기본은 꺼짐.
  { id: 'schoolZone', label: '어린이보호구역', color: '#6a4c93', icon: 'school', desc: '스쿨존 위치' },
  { id: 'parkingZone', label: '주정차 단속구간', color: '#37474f', icon: 'parking', desc: '불법 주정차 단속 구간 위치' },
]

/** 낯선 지도 용어의 뜻 한 줄(누르면 보인다). 옐로카펫: 서울시 교통 안내, 어린이보호구역: 도로교통법 제12조, 대기질 신호등: 서울시 환경 안내, 나머지는 이 지도의 자료 설명을 풀어 쓴 것 */
export const PUB_MEANING: Partial<Record<PubLayerId, string>> = {
  yellow: '횡단보도 앞 어린이 대기 공간을 노랗게 칠한 곳이에요. 운전자 눈에 잘 띄어요.',
  schoolZone: '학교 같은 시설 주변 도로에서 차가 시속 30km 안으로 달리도록 정한 구역이에요.',
  airSignal: '미세먼지 정도를 신호등 색으로 보여 주는 표시등이에요.',
  flood: '2025년에 비로 물이 찬 피해가 있었던 곳이에요.',
  parkingZone: '불법 주정차를 단속하는 구간이에요.',
}

// 기본 지도는 「길 가기」 묶음(장애요소·육교·장애인화장실)이다(2026-11-19, lib/layerPresets.ts).
// 횡단보도는 길찾기에서만 쓴다 — 데이터와 로더는 유지. 버스 정류장은 「버스 타기」·「비 오는 날」 칩과 직접 고르기에서 켠다.
// 북구 6종(육교·장애인시설·옐로카펫·침수 이력·그늘막·대기질 신호등)도 기본은 꺼짐 — 켜면 북구 전체를 보이되 그림 개수 상한(전체 합계 PUB_TOTAL_DRAW, lib/pubDraw.ts)이 있다.
// 상품권 가맹점(2026-11-17)은 용봉동만, 기본은 꺼짐. 편의시설(AI 검색 카드의 「편의시설 지도 보기」용)도 기본은 꺼짐.
export const PUB_LAYERS: PubLayerInfo[] = ALL_PUB_LAYERS.filter((l) => l.id !== 'crosswalk')

export const PUB_MAX_LEVEL = 5 // 이 레벨보다 넓게 보면 그리지 않는다(숫자가 클수록 넓음)

const LOADERS: Record<PubLayerId, () => Promise<unknown>> = {
  crosswalk: () => import('../../data/public/crosswalks.json'),
  toilet: () => import('../../data/public/toilets.json'),
  facility: () => import('../../data/public/facilities.json'),
  bus: () => import('../../data/public/bus-stops.json'),
  voucher: () => import('../../data/public/vouchers.json'),
  overpass: () => import('../../data/public/overpass.json'),
  welfare: () => import('../../data/public/welfare-facilities.json'),
  yellow: () => import('../../data/public/yellow-carpets.json'),
  flood: () => import('../../data/public/flood.json'),
  shade: () => import('../../data/public/shade.json'),
  airSignal: () => import('../../data/public/air-signals.json'),
  schoolZone: () => import('../../data/public/school-zones.json'),
  parkingZone: () => import('../../data/public/parking-zones.json'),
}

export async function loadPubDataset(id: PubLayerId): Promise<PubDataset> {
  const mod = (await LOADERS[id]()) as { default: unknown }
  return mod.default as PubDataset
}

export type LayerState = {
  team: boolean // 팀 조사·시민 제보
  crosswalk: boolean
  toilet: boolean
  facility: boolean
  bus: boolean
  voucher: boolean
  overpass: boolean
  welfare: boolean
  yellow: boolean
  flood: boolean
  shade: boolean
  airSignal: boolean
  schoolZone: boolean
  parkingZone: boolean
  toiletAccessibleOnly: boolean
  voucherAccessibleOnly: boolean // 출입구 정보가 있는 가맹점만
}

const KEY = 'wheelmap.layers'
export const DEFAULT_LAYERS: LayerState = { team: true, crosswalk: false, toilet: true, facility: false, bus: false, voucher: false, overpass: true, welfare: false, yellow: false, flood: false, shade: false, airSignal: false, schoolZone: false, parkingZone: false, toiletAccessibleOnly: true, voucherAccessibleOnly: false }

/** 옛 기본값: 장애요소와 장애인화장실만 켜진 상태 */
export const isOldDefault = (s: LayerState) =>
  s.team && s.toilet && !s.crosswalk && !s.facility && !s.bus && !s.voucher && !s.overpass && !s.welfare && !s.yellow && !s.flood && !s.shade && !s.airSignal && !s.schoolZone && !s.parkingZone

export function loadLayers(): LayerState {
  try {
    const raw = localStorage.getItem(KEY)
    if (raw) {
      const v = JSON.parse(raw) as Partial<LayerState>
      const out = { ...DEFAULT_LAYERS }
      for (const k of Object.keys(DEFAULT_LAYERS) as (keyof LayerState)[]) if (typeof v[k] === 'boolean') out[k] = v[k]
      // 11/19 전에 저장된 값이 옛 기본(장애요소+장애인화장실만)이면 새 기본(길 가기: 육교 포함)으로 올린다
      if ((v as { v?: number }).v !== 2 && isOldDefault(out)) out.overpass = true
      return out
    }
  } catch {
    /* 저장소를 못 써도 기본값으로 동작 */
  }
  return { ...DEFAULT_LAYERS }
}

export function saveLayers(s: LayerState) {
  try {
    localStorage.setItem(KEY, JSON.stringify({ ...s, v: 2 }))
  } catch {
    /* 저장 실패는 무시(다음 방문에 기본값) */
  }
}

export const toiletAccessible = (it: PubItem) => Number(it.fields['장애인용위생시설합계'] ?? 0) > 0

/** 지도에 그릴 항목인지(레이어별 보기 설정). 장애인화장실·상품권 가맹점만 설정이 있다. */
export function pubItemShown(layer: PubLayerId, it: PubItem, s: Pick<LayerState, 'toiletAccessibleOnly' | 'voucherAccessibleOnly'>): boolean {
  if (layer === 'toilet') return !s.toiletAccessibleOnly || toiletAccessible(it)
  if (layer === 'voucher') return !s.voucherAccessibleOnly || voucherHasAccessInfo(it)
  return true
}
