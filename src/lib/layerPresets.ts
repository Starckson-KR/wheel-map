// 동행지도 상황 칩(길 가기·버스 타기…)과 「직접 고르기」 묶음. 순수 함수만 둔다(시험: tests/layerPresets.test.ts).
// 칩은 따로 저장하지 않는다: 지금 켜진 레이어가 어떤 칩의 묶음과 똑같으면 그 칩이 고른 것으로 보인다(직접 바꾸면 저절로 풀린다).
import type { LayerState, PubItem, PubLayerId } from './publicLayers'
import { distanceM } from './geo'
import { HIGH_TEMP_C, isWet, type WeatherNow } from './weather/model.ts'

export type ChipId = 'walk' | 'bus' | 'toilet' | 'rain' | 'child' | 'hot'
export type LayerKey = 'team' | PubLayerId

export type ChipInfo = { id: ChipId; label: string; icon: string; on: LayerKey[] }

// docs/레이어_활용_시안.md 2장 표 그대로
export const CHIPS: Record<ChipId, ChipInfo> = {
  walk: { id: 'walk', label: '길 가기', icon: 'walk', on: ['team', 'overpass', 'toilet'] },
  bus: { id: 'bus', label: '버스 타기', icon: 'bus', on: ['bus', 'team'] },
  toilet: { id: 'toilet', label: '화장실 찾기', icon: 'access', on: ['toilet', 'facility'] },
  rain: { id: 'rain', label: '비 오는 날', icon: 'rain', on: ['flood', 'bus', 'team'] },
  child: { id: 'child', label: '아이와 함께', icon: 'child', on: ['schoolZone', 'yellow', 'overpass', 'parkingZone'] },
  hot: { id: 'hot', label: '더운 날', icon: 'sun', on: ['shade', 'airSignal', 'toilet'] },
}

// 켜고 끄는 레이어 전부(보기 설정 두 개는 뺀다)
export const LAYER_KEYS: LayerKey[] = ['team', 'crosswalk', 'toilet', 'facility', 'bus', 'voucher', 'overpass', 'welfare', 'yellow', 'flood', 'shade', 'airSignal', 'schoolZone', 'parkingZone']

/** 칩을 고르면 그 묶음만 켠다. 장애인화장실은 장애인용 시설이 있는 곳만 보이게 한다. 가맹점 보기 설정은 건드리지 않는다. */
export function applyChip(id: ChipId, prev: LayerState): LayerState {
  const next = { ...prev }
  const on = new Set(CHIPS[id].on)
  for (const k of LAYER_KEYS) next[k] = on.has(k)
  if (on.has('toilet')) next.toiletAccessibleOnly = true
  return next
}

/** 지금 켜진 레이어와 묶음이 똑같은 칩. 없으면 null(직접 고른 상태) */
export function chipOf(layers: LayerState): ChipId | null {
  for (const c of Object.values(CHIPS)) {
    const on = new Set(c.on)
    if (LAYER_KEYS.every((k) => layers[k] === on.has(k))) return c.id
  }
  return null
}

export const isHot = (w: WeatherNow | null) => !!w && !isWet(w) && w.tempC >= HIGH_TEMP_C

/** 칩 순서. 비·눈이면 「비 오는 날」이 맨 앞, 더우면 그 자리에 「더운 날」이 대신 나와 맨 앞에 선다. */
export function chipOrder(w: WeatherNow | null): ChipId[] {
  if (w && isWet(w)) return ['rain', 'walk', 'bus', 'toilet', 'child']
  if (isHot(w)) return ['hot', 'walk', 'bus', 'toilet', 'child']
  return ['walk', 'bus', 'toilet', 'rain', 'child']
}

// ───── 직접 고르기: 다섯 묶음 ─────
export type LayerGroup = { id: string; label: string; keys: LayerKey[] }
export const LAYER_GROUPS: LayerGroup[] = [
  { id: 'barrier', label: '길 위 장애물', keys: ['team', 'overpass'] },
  { id: 'rest', label: '쉬어 갈 곳', keys: ['toilet', 'shade', 'facility', 'welfare'] },
  { id: 'weather', label: '날씨', keys: ['flood', 'airSignal'] },
  { id: 'child', label: '아이와 함께', keys: ['schoolZone', 'yellow'] },
  { id: 'life', label: '교통·생활', keys: ['bus', 'parkingZone', 'voucher'] },
]
/** 타일에 쓰는 짧은 이름(없으면 레이어 이름 그대로) */
export const TILE_LABEL: Partial<Record<LayerKey, string>> = { team: '장애요소', facility: '편의시설', parkingZone: '주정차 단속' }

// ───── 요약 한 줄 ─────
export const NEAR_M = 1500 // 「N곳」을 세는 반경(지도 가운데 기준)
export const BUS_NEAR_M = 500 // 가까운 정류장

type Pt = { lat: number; lng: number }
function distM(a: Pt, b: Pt): number {
  return distanceM(a.lat, a.lng, b.lat, b.lng)
}
const placed = (items: PubItem[]) => items.filter((i): i is PubItem & Pt => i.lat != null && i.lng != null)

/** 가운데에서 반경 안에 있는 항목 수(좌표 없는 항목은 세지 않는다) */
export const countNear = (items: PubItem[], c: Pt, radiusM: number) => placed(items).filter((i) => distM(c, i) <= radiusM).length

/** 가장 가까운 항목까지 거리(m, 10m 단위). 항목이 없으면 null */
export function nearestM(items: PubItem[], c: Pt): number | null {
  const ps = placed(items)
  if (ps.length === 0) return null
  return Math.round(Math.min(...ps.map((i) => distM(c, i))) / 10) * 10
}

export type SummaryCounts = { bus?: number; toilet?: number; toiletM?: number | null; flood?: number; schoolZone?: number; shade?: number }
/** 요약 한 줄: 앞말 + 굵은 숫자 + 뒷말. 숫자를 아직 모르면 null(줄을 숨긴다). 길 가기는 줄이 없다. */
export type Summary = { icon: string; color: string; before: string; strong: string; after: string }

const n = (v: number) => v.toLocaleString('ko-KR')
const distText = (m: number) => (m >= 1000 ? `${(m / 1000).toFixed(1)}km` : `${m}m`)

export function chipSummary(id: ChipId, c: SummaryCounts): Summary | null {
  if (id === 'bus' && c.bus != null) return { icon: 'bus', color: '#1e6fb5', before: '가까운 정류장 ', strong: `${n(c.bus)}곳`, after: '을 보여 드려요' }
  if (id === 'toilet') {
    if (c.toiletM != null) return { icon: 'access', color: '#5e35b1', before: '가장 가까운 장애인화장실까지 ', strong: distText(c.toiletM), after: '' }
    if (c.toilet != null) return { icon: 'access', color: '#5e35b1', before: '가까운 장애인화장실 ', strong: `${n(c.toilet)}곳`, after: '을 보여 드려요' }
  }
  // 정류장에 지붕이 있는지는 자료에 없다. 「가까운 정류장」이라고만 쓴다.
  if (id === 'rain' && c.flood != null) return { icon: 'drop', color: '#0277bd', before: '물이 찼던 곳 ', strong: `${n(c.flood)}곳`, after: '과 가까운 정류장을 보여 드려요' }
  if (id === 'child' && c.schoolZone != null) return { icon: 'school', color: '#6a4c93', before: '스쿨존 ', strong: `${n(c.schoolZone)}곳`, after: '과 옐로카펫을 보여 드려요' }
  if (id === 'hot' && c.shade != null) return { icon: 'umbrella', color: '#3949ab', before: '그늘막 ', strong: `${n(c.shade)}곳`, after: '과 대기질 신호등을 보여 드려요' }
  return null
}
