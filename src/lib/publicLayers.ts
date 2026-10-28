// 공공데이터 레이어(참고 정보). ○△X 판정과 무관하며, 데이터는 레이어를 켤 때 동적 import로 불러온다.
export type PubLayerId = 'crosswalk' | 'toilet' | 'facility' | 'bus'

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
  items: PubItem[]
}

export type PubLayerInfo = { id: PubLayerId; label: string; glyph: string; color: string; icon: string; desc: string }

// 색은 ○△X(초록·주황·빨강·회색)와 겹치지 않는 중립색. 모양은 글자로 구분한다.
export const ALL_PUB_LAYERS: PubLayerInfo[] = [
  { id: 'crosswalk', label: '횡단보도', glyph: '횡', color: '#455a64', icon: '🚸', desc: '보도턱 낮춤 여부·폭 (북구 285곳)' },
  { id: 'toilet', label: '장애인화장실', glyph: '♿WC', color: '#5e35b1', icon: '🚻', desc: '공중화장실과 장애인용 시설 수' },
  { id: 'facility', label: '장애인편의시설', glyph: '편', color: '#6d4c41', icon: '♿', desc: '편의시설 현황 (시설 유형별)' },
  { id: 'bus', label: '버스정류장', glyph: '버스', color: '#1e6fb5', icon: '🚌', desc: '정류소 이름과 번호' },
]

// 기본 지도에는 이동 중 바로 필요한 장애인화장실만 둔다(2026-10-26 사용자 결정).
// 횡단보도·정류장은 길찾기(5·7단계), 편의시설은 목적지 정보에서 쓴다 — 데이터와 로더는 유지.
export const PUB_LAYERS: PubLayerInfo[] = ALL_PUB_LAYERS.filter((l) => l.id === 'toilet')

export const PUB_MAX_LEVEL = 5 // 이 레벨보다 넓게 보면 그리지 않는다(숫자가 클수록 넓음)
export const PUB_MAX_DRAW = 500 // 한 번에 그리는 최대 개수

const LOADERS: Record<PubLayerId, () => Promise<unknown>> = {
  crosswalk: () => import('../../data/public/crosswalks.json'),
  toilet: () => import('../../data/public/toilets.json'),
  facility: () => import('../../data/public/facilities.json'),
  bus: () => import('../../data/public/bus-stops.json'),
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
  toiletAccessibleOnly: boolean
}

const KEY = 'wheelmap.layers'
export const DEFAULT_LAYERS: LayerState = { team: true, crosswalk: false, toilet: true, facility: false, bus: false, toiletAccessibleOnly: true }

export function loadLayers(): LayerState {
  try {
    const raw = localStorage.getItem(KEY)
    if (raw) {
      const v = JSON.parse(raw) as Partial<LayerState>
      const out = { ...DEFAULT_LAYERS }
      for (const k of Object.keys(DEFAULT_LAYERS) as (keyof LayerState)[]) if (typeof v[k] === 'boolean') out[k] = v[k]
      return out
    }
  } catch {
    /* 저장소를 못 써도 기본값으로 동작 */
  }
  return { ...DEFAULT_LAYERS }
}

export function saveLayers(s: LayerState) {
  try {
    localStorage.setItem(KEY, JSON.stringify(s))
  } catch {
    /* 저장 실패는 무시(다음 방문에 기본값) */
  }
}

export const toiletAccessible = (it: PubItem) => Number(it.fields['장애인용위생시설합계'] ?? 0) > 0
