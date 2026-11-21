import { fmtDay } from '../lib/format'
import { facilityLabel, groupFacilities } from '../lib/facilityGroups'
import { clusterByScreen } from '../lib/routing/markerCluster'
import { Suspense, lazy, useEffect, useMemo, useRef, useState } from 'react'
import { CENTER_ADDRESS_CANDIDATES, geocode, loadKakao } from '../lib/kakao'
import { loadBarriers } from '../lib/seed'
import { NAV_STEP_NEAR_M, NAV_Z } from '../lib/config'
import { confirmSheet, toast } from '../lib/uiStore'
import type { Barrier, Geometry, LatLng, Rating } from '../types'
import { RATING_STYLE } from '../lib/rating'
import { CATEGORY_INFO, CATEGORY_ORDER, IMPACT_INFO, categoryOf, styleOf, impactLine, impactOf, obstacleName, shortName, type Category, type ImpactKey } from '../lib/display'
import { impactOfReport } from '../lib/routing/impact.ts'
import BarrierDetail from './BarrierDetail'
import ReportDetail from '../components/ReportDetail'
import ViewSettings from '../components/ViewSettings'
import Icon, { iconSvg } from '../components/Icon'
import { isDesktopLayout } from '../lib/viewPrefs'
import { glNavEnabled } from '../lib/guideGl/core.ts'
import { webglOk } from '../lib/guideGl/support.ts'
import { colsStyle } from '../lib/gridCols'
import { useVisibleAddress } from '../lib/addressCache'
import DemoTools, { MockStrip } from '../components/DemoTools'
import { useSheetSnap, type Snap } from '../components/useSheetSnap'
import { placeFromQuery, typeFromQuery } from '../lib/aiSearch/handoff'
import { DEFAULT_FILTER, showCitizen, type MapFilter } from '../lib/mapFilter'
import ReportFlow, { type Loc } from '../components/ReportFlow'
import ReportsPanel from '../components/ReportsPanel'
import MyRewards from '../components/MyRewards'
import LayerPanel from '../components/LayerPanel'
import PubCard from '../components/PubCard'
import RoutePanel from '../components/RoutePanel'
import PlaceSearchPanel from '../components/PlaceSearchPanel'
import { ROLE_STYLE } from '../lib/routing/roleStyle.ts'
import type { RouteMarker, RouteOverlay } from '../lib/routing/overlay.ts'
import type { DemoPair, Place } from '../lib/routing/provider.ts'
import { busColor } from '../lib/routing/busColor.ts'
import { arrowSpots, makeNearRoute } from '../lib/routing/near.ts'
import ProgressPanel from '../components/ProgressPanel'
import { PROGRESS_INFO, PROGRESS_ORDER, PERIODS, buildProgress, type PeriodId, type ProgressItem, type ProgressStage } from '../lib/progress'
import { usePlan } from '../lib/planStore'
import { STATUS_LABEL, isExpired, nowMs, useReports } from '../lib/reportStore'
import type { Report, ReportStatus } from '../types'
import {
  PUB_LAYERS,
  PUB_MAX_DRAW,
  PUB_MAX_LEVEL,
  loadLayers,
  loadPubDataset,
  saveLayers,
  pubItemShown,
  type LayerState,
  type PubDataset,
  type PubItem,
  type PubLayerId,
} from '../lib/publicLayers'
import { Sentences } from '../components/Sentences'
import SituationChips from '../components/SituationChips'
import { BUS_NEAR_M, NEAR_M, applyChip, chipOf, chipOrder, chipSummary, countNear, nearestM, type ChipId, type SummaryCounts } from '../lib/layerPresets'
import { useWeather } from '../lib/weather/store'
import { toiletAccessible } from '../lib/publicLayers'
import { Wordmark } from '../components/Wordmark'
import { CENTER_DEADBAND_PX, centerDelta, compassHeading, easeOut, isStepNear, lerpLatLng, smoothHeading } from '../lib/routing/followNav.ts'
import { prefersCalm } from '../lib/viewPrefs'
import { isMockReport, realFirst } from '../lib/realFirst'
import CenterPin from '../components/CenterPin'
import { haptic } from '../lib/haptic'
import { pinMoved } from '../lib/pinLift'

const BARRIERS = loadBarriers()
const BY_ID = new Map(BARRIERS.map((b) => [b.id, b]))
const UNPLACED = BARRIERS.filter((b) => b.locationStatus && !b.provisional)
const PROVISIONAL = BARRIERS.filter((b) => b.provisional && !b.geometry)

function anchorOf(g: Geometry): LatLng {
  return g.kind === 'point' ? g.at : g.path[0]
}

// 하위 점에 평가가 없으면 상위 항목의 평가 색을 따른다(상위 항목에 모양이 없는 여러 점 구조 때문).
// 팀 조사 지점에서 민원 흐름을 시작한 경우, 그 흐름의 평가(재확인 통과 시 ○)가 지점 색을 덮어쓴다.
function ratingOf(b: Barrier, override?: Map<string, Rating | undefined>) {
  const r = override?.has(b.id) ? override.get(b.id) : (b.rating ?? (b.parentId ? BY_ID.get(b.parentId)?.rating : undefined))
  return RATING_STYLE[r ?? 'none']
}

function ratingKeyOf(b: Barrier, override?: Map<string, Rating | undefined>): Rating | 'none' {
  return (override?.has(b.id) ? override.get(b.id) : (b.rating ?? (b.parentId ? BY_ID.get(b.parentId)?.rating : undefined))) ?? 'none'
}

// 아래 시트에 보여 줄 한 줄(팀 조사 지점 또는 시민 제보)
type HomeRow = { key: string; kind: 'seed' | 'report'; id: string; title: string; sub: string; rating: Rating | 'none'; cat: Category; impact: ImpactKey; pos?: { lat: number; lng: number; type: string; at: string } }

// 지도 아래 목록의 한 줄. 시민 제보는 보이는 줄만 주소를 조회해 "유형 · 주소 · 접수일"로 서로 구분되게 한다.
// 목록에서는 제목 끝의 괄호 설명을 떼고 보인다(상세에서는 전체 제목). 데이터는 그대로.
const listTitle = (t: string) => t.replace(/\s*\([^()]*\)\s*$/, '') || t

function HomeListRow({ r, onPick }: { r: HomeRow; onPick: (r: HomeRow) => void }) {
  const [ref, addr] = useVisibleAddress<HTMLLIElement>(r.pos?.lat ?? 0, r.pos?.lng ?? 0)
  const st = styleOf(r.impact, r.rating)
  const day = r.pos ? fmtDay(r.pos.at) : ''
  const date = day ? `${day} 접수` : ''
  const title = r.pos ? `${r.pos.type}${addr.short ? ` · ${addr.short}` : ''}` : r.title
  const sub = r.pos ? [r.sub, date].filter(Boolean).join(' · ') : r.sub
  return (
    <li ref={r.pos ? ref : undefined}>
      <button type="button" className="lr" onClick={() => onPick(r)}>
        <i className="lr-glyph" style={{ background: st.color, color: st.ink }}>
          {st.glyph}
        </i>
        <span className="lr-main">
          <span className="lr-title">{listTitle(title)}</span>
          <span className="lr-sub">{sub}</span>
        </span>
        <span className="lr-chev" aria-hidden="true" />
      </button>
    </li>
  )
}

// 지도 핀: 줌에 따라 점(dot) → 점+종류(chip) → 이름까지(full)
type PinMode = 'lite' | 'dot' | 'chip' | 'full'
type PinItem = {
  key: string
  lat: number
  lng: number
  rating: Rating | 'none'
  impact: ImpactKey | null
  name: string
  title?: string
  small: boolean
  sel: boolean
  dim: boolean
  route: boolean
  citizen?: boolean
  expired?: boolean
  count?: number // 같은 지점에 합쳐진 시민 제보 건수
  prov?: boolean // 위치 임시(카카오 검색 결과)
  pg?: { stage: ProgressStage; label: string } // 개선 현황 보기의 핀
  onClick: () => void
}
const DOT_PX = 14 // 작은 색 점의 폭(겹침 계산용)
const ROUTE_WALK = '#1250c9' // 도보 경로(진한 파랑). 장애요소 등급 색(빨강·주황·노랑·초록)과 겹치지 않게 한다.
const ROUTE_BASE = '#7b8aa6' // 비교할 때 고르지 않은 쪽 길(연한 회색 파랑 실선)
const NEAR_ROUTE_M = 40 // 경로에서 이 거리 안의 핀만 또렷하게 둔다
const PIN_H = 26 // 핀 높이(겹침 계산용, map.css .bm-pin과 같은 값)
const PUB_ICON_PX = 13 // 공공데이터 핀 안 아이콘
const PUB_ICON_STROKE = 2.4 // 작은 핀에서는 선을 조금 굵게(13px에서 약 1.3px)

const SHOWN_ON_MAP: ReportStatus[] = ['verified', 'filed', 'assigned', 'in_progress', 'resolved', 'rechecked']

// 아래 시트 단계(0 최소 · 1 기본 · 2 펼침). 처음엔 지도가 가장 잘 보이는 최소로 시작하고, 사용자가 고른 단계(최소·기본)는 기억한다.
const SNAP_KEY = 'wheelmap.sheetSnap2' // 11/18: 접힌 단계가 한 줄로 바뀌어 이전 저장값(칩이 보이던 단계)은 이어 쓰지 않는다
function loadSnap(): Snap {
  try {
    return localStorage.getItem(SNAP_KEY) === '1' ? 1 : 0
  } catch {
    return 0
  }
}
function saveSnap(s: Snap) {
  try {
    localStorage.setItem(SNAP_KEY, s === 0 ? '0' : '1') // 펼침(2)은 다음에 열 때 기본(1)으로
  } catch {
    /* 저장하지 못해도 화면은 그대로 쓴다 */
  }
}
// 손잡이 버튼 이름(누르면 다음 단계로: 최소 → 기본 → 펼침 → 최소, 순서는 useSheetSnap)
const SNAP_BTN: Record<Snap, { label: string }> = {
  0: { label: '장애요소 목록 보기' },
  1: { label: '장애요소 목록 보기' },
  2: { label: '지도 넓게 보기' },
}

// 길 안내 새 지도 시험판(MapLibre): 안내를 시작할 때 처음 내려받는다(첫 화면 번들에 넣지 않는다). 기본은 꺼짐: 개발 서버이거나 주소에 navmap=gl일 때만.
const GuideGlMap = lazy(() => import('../components/GuideGlMap'))
const GL_NAV_ON = glNavEnabled(import.meta.env.DEV, location.search, location.hash)

// 지도 아래를 덮는 시트(요약·상세)의 높이(px). 작은 화면에서 지금 보이는 시트 중 윗변이 가장 높은 것 기준. 큰 화면은 왼쪽 패널이라 0.
function coverOf(mapEl: HTMLElement | null): number {
  if (!mapEl || isDesktopLayout()) return 0
  const mb = mapEl.getBoundingClientRect()
  let top = mb.bottom
  mapEl.parentElement?.querySelectorAll<HTMLElement>('[data-sheet]:not(.ms)').forEach((el) => {
    if (el.hidden) return
    const cs = getComputedStyle(el)
    if (cs.visibility === 'hidden' || cs.display === 'none') return
    const r = el.getBoundingClientRect()
    if (r.height > 0 && r.top < top && r.top > mb.top) top = r.top
  })
  return Math.max(0, mb.bottom - top)
}

// 지도 위쪽을 덮는 검색줄·칩의 높이(px). 지도에 맞출 때 위쪽 여백으로 쓴다. 큰 화면은 왼쪽 패널이라 0.
function topCoverOf(mapEl: HTMLElement | null): number {
  if (!mapEl || isDesktopLayout()) return 0
  const top = mapEl.parentElement?.querySelector<HTMLElement>('.hm-top')
  if (!top) return 0
  const cs = getComputedStyle(top)
  if (top.hidden || cs.display === 'none' || cs.visibility === 'hidden') return 0
  const mb = mapEl.getBoundingClientRect()
  let bottom = 0
  top.querySelectorAll<HTMLElement>(':scope > *').forEach((c) => {
    const r = c.getBoundingClientRect()
    if (r.height > 0) bottom = Math.max(bottom, r.bottom)
  })
  return Math.max(0, Math.round(bottom - mb.top))
}

export default function BarrierMap({ intent = '', active = true }: { intent?: string; active?: boolean }) {
  const [start] = useState(() => {
    const q = new URLSearchParams(intent)
    const rid = q.get('report')
    const lat = Number(q.get('lat'))
    const lng = Number(q.get('lng'))
    const at = q.get('lat') && q.get('lng') && lat > 33 && lat < 39 && lng > 124 && lng < 132 ? { lat, lng } : null // AI 카드가 정한 중심(한국 안의 값만)
    return { go: q.get('go'), layer: q.get('layer'), at, type: typeFromQuery(q.get('type')), skipType: q.get('step') === 'where', from: placeFromQuery(q.get('from')), to: placeFromQuery(q.get('to')), mode: q.get('mode') === 'bus' ? ('bus' as const) : ('walk' as const), report: rid ? (useReports.getState().reports.find((r) => r.id === rid) ?? null) : null }
  })
  const container = useRef<HTMLDivElement>(null)
  const kRef = useRef<typeof kakao | null>(null)
  const mapRef = useRef<kakao.maps.Map | null>(null)
  const [state, setState] = useState<{ status: 'loading' | 'ready' } | { status: 'error'; message: string }>({ status: 'loading' })
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [snap, setSnapState] = useState<Snap>(loadSnap)
  const setSnap = (s: Snap) => {
    setSnapState(s)
    saveSnap(s)
  }
  const [legendOpen, setLegendOpen] = useState(false)
  const [filter, setFilter] = useState<MapFilter>(DEFAULT_FILTER)
  const [selectedReportId, setSelectedReportId] = useState<string | null>(start.report?.id ?? null)
  const [flowOpen, setFlowOpen] = useState(start.go === 'report')
  const [picking, setPicking] = useState(false)
  const [draftPos, setDraftPos] = useState<Loc | null>(null)
  const [pinLifted, setPinLifted] = useState(false) // 지도를 끄는 동안 중앙 핀이 떠 있다
  const [pinLanded, setPinLanded] = useState(0) // 내려앉을 때마다 +1(바닥 물결 다시 재생)
  const pickBackup = useRef<Loc | null>(null) // 위치 고르기를 시작할 때의 위치(취소하면 되돌린다)
  const [panelOpen, setPanelOpen] = useState(start.go === 'reports')
  const [rewardsOpen, setRewardsOpen] = useState(start.go === 'rewards')
  const [progressOpen, setProgressOpen] = useState(start.go === 'progress') // 개선 현황 목록 패널
  const [progressMode, setProgressMode] = useState(start.go === 'progress') // 개선 현황 보기(마커·범례가 바뀜)
  const [period, setPeriod] = useState<PeriodId>('90')
  const [pgStages, setPgStages] = useState<ProgressStage[]>(PROGRESS_ORDER)
  const [focusIds, setFocusIds] = useState<string[]>([])
  // AI 검색이 「가맹점 지도 보기」처럼 레이어를 켜 달라고 하면(layer=voucher|toilet) 그 레이어를 켠 채로 연다.
  const [layers, setLayers] = useState<LayerState>(() => {
    const l = loadLayers()
    return start.layer === 'voucher' ? { ...l, voucher: true } : start.layer === 'toilet' ? { ...l, toilet: true } : start.layer === 'facility' ? { ...l, facility: true } : l
  })
  const [layerOpen, setLayerOpen] = useState(false)
  const [pubData, setPubData] = useState<Partial<Record<PubLayerId, PubDataset>>>({})
  const [pubError, setPubError] = useState<Partial<Record<PubLayerId, boolean>>>({})
  const requested = useRef(new Set<PubLayerId>())
  const [view, setView] = useState<{ level: number; b: [number, number, number, number] } | null>(null)
  const [pubSel, setPubSel] = useState<{ layer: PubLayerId; item: PubItem } | null>(null)
  const [kObj, setKObj] = useState<typeof kakao | null>(null)
  const [routeOpen, setRouteOpen] = useState(start.go === 'route')
  // 위쪽 검색바가 입력칸이다: 누르면 그 자리에서 키보드가 뜨고, 아래에 장소 검색 결과가 나온다
  const [searchOpen, setSearchOpen] = useState(false)
  const [searchQ, setSearchQ] = useState('')
  const searchInput = useRef<HTMLInputElement>(null)
  // 검색에서 고른 도착지(또는 추천 경로)로 길찾기를 연다. n이 바뀌면 길찾기 화면을 새로 연다
  const [routeLaunch, setRouteLaunch] = useState<{ to?: Place; pair?: DemoPair; n: number } | null>(null)
  const launchN = useRef(0)
  const [locMsg, setLocMsg] = useState('')
  const meRef = useRef<kakao.maps.CustomOverlay | null>(null)
  const accRef = useRef<kakao.maps.Circle | null>(null)
  const watchRef = useRef<number | null>(null)
  const wantLocRef = useRef(false) // 사용자가 내 위치를 켰는가
  const followRef = useRef(false)
  const firstFixRef = useRef(false)
  const lastPosRef = useRef<kakao.maps.LatLng | null>(null)
  const followOffRef = useRef<() => void>(() => {})
  const [myPos, setMyPos] = useState<{ lat: number; lng: number } | null>(null) // 길 안내가 단계를 넘길 때 쓰는 내 위치(화면 계산에만 쓰고 저장·전송하지 않는다)
  const meElRef = useRef<HTMLElement | null>(null)
  const gstepElRef = useRef<HTMLElement | null>(null) // 지금 단계의 주황 화살표 원(내 위치가 가까우면 작고 흐리게)
  const headingRef = useRef<number | null>(null) // 폰이 향한 방향(북=0, 시계 방향). 모르면 null
  const compassRef = useRef<(() => void) | null>(null) // 나침반 듣기 해제 함수
  const moveRaf = useRef(0)
  const [locMode, setLocMode] = useState<'off' | 'follow' | 'free'>('off')
  const sheetRef = useRef<HTMLElement>(null)
  const [routePick, setRoutePick] = useState<'from' | 'to' | null>(null)
  const [routePicked, setRoutePicked] = useState<{ which: 'from' | 'to'; place: Place; n: number } | null>(null)
  const [overlay, setOverlay] = useState<RouteOverlay | null>(null)
  const [glFailed, setGlFailed] = useState(false) // 새 지도를 못 열었으면 카카오 지도로 계속한다
  const glPath = useMemo(() => {
    if (!overlay) return []
    if (overlay.legs?.length) return overlay.legs.flatMap((l) => l.coords)
    return (overlay.active === 'base' ? overlay.base : overlay.detour) ?? overlay.base ?? overlay.detour ?? []
  }, [overlay?.legs, overlay?.active, overlay?.base, overlay?.detour]) // eslint-disable-line react-hooks/exhaustive-deps
  const glOn = GL_NAV_ON && !glFailed && !!overlay?.guide && glPath.length >= 2
  useEffect(() => {
    if (glOn && !webglOk()) setGlFailed(true)
  }, [glOn])
  const routePickRef = useRef<'from' | 'to' | null>(null)
  const pickN = useRef(0)
  const lastFit = useRef(0)
  const pickingRef = useRef(false)
  const draftRef = useRef<Loc | null>(null)
  const keepRef = useRef<{ lat: number; lng: number; level: number } | null>(null)
  const fitRef = useRef<{ bounds: kakao.maps.LatLngBounds; top: number } | null>(null) // 마지막으로 화면에 맞춘 범위(시트 단계가 바뀔 때 다시 맞춘다)
  const movedRef = useRef(false) // 사용자가 직접 지도를 움직였는가(움직였으면 시트 변화만으로 지도를 옮기지 않는다)
  const drawnLevel = useRef<number | null>(null) // 직전에 핀을 그린 줌 단계(줌이 바뀐 때만 핀을 부드럽게 나타낸다)
  useEffect(() => {
    pickingRef.current = picking
    draftRef.current = draftPos
  }, [picking, draftPos])
  useEffect(() => {
    routePickRef.current = routePick
  }, [routePick])
  // 시트가 가린 아래쪽만큼 여백을 두고 범위를 맞춘다(처음 진입·경로 강조·시트 단계 변경 뒤 다시 맞춤)
  const fitWithSheet = (map: kakao.maps.Map, bounds: kakao.maps.LatLngBounds, top: number) => {
    const d = isDesktopLayout()
    const bottom = d ? 60 : Math.max(40, Math.round(Math.min(coverOf(container.current), (container.current?.clientHeight ?? 600) * 0.6)) + 24)
    map.setBounds(bounds, d ? 60 : Math.max(top, topCoverOf(container.current) + 12), d ? 60 : 40, bottom, d ? 460 : 40)
  }
  // 시트 단계가 바뀌고 멈춘 뒤 한 번만: 선택한 핀이 시트·상단에 가려졌을 때만 부드럽게 옮기고, 선택이 없으면 처음 맞춤을 새 여백으로 다시 맞춘다(사용자가 지도를 움직였으면 하지 않는다)
  const revealSelected = () => {
    const k = kRef.current
    const map = mapRef.current
    const el = container.current
    if (!k || !map || !el || isDesktopLayout()) return
    let at: [number, number] | null = null
    if (selectedId) {
      const b = BY_ID.get(selectedId)
      if (b?.geometry) at = anchorOf(b.geometry)
      else if (b?.provisional) at = [b.provisional.lat, b.provisional.lng]
    } else if (selectedReportId) {
      const r = useReports.getState().reports.find((x) => x.id === selectedReportId)
      if (r) at = [r.lat, r.lng]
    }
    const h = el.clientHeight
    const w = el.clientWidth
    const cover = coverOf(el)
    if (at) {
      const pt = map.getProjection().containerPointFromCoords(new k.maps.LatLng(at[0], at[1]))
      const topY = 28 // 상세가 올라온 동안에는 위쪽 검색줄이 가려져 있다
      const botY = h - cover - 28
      const ok = pt.y >= topY && pt.y <= botY && pt.x >= 24 && pt.x <= w - 24
      if (!ok && botY > topY) map.panBy(pt.x >= 24 && pt.x <= w - 24 ? 0 : pt.x - w / 2, pt.y >= topY && pt.y <= botY ? 0 : pt.y - (topY + (botY - topY) / 2)) // 보이는 영역의 가운데로
      return
    }
    const f = fitRef.current
    if (f && !movedRef.current && snap !== 2) fitWithSheet(map, f.bounds, f.top)
  }
  const openReportRef = useRef<(id: string) => void>(() => {})
  const openSeedRef = useRef<(id: string) => void>(() => {})
  const pickRoutePlace = (lat: number, lng: number, name: string) => {
    const which = routePickRef.current
    if (!which) return false
    setRoutePicked({ which, place: { name, lat, lng }, n: ++pickN.current })
    setRoutePick(null)
    return true
  }
  const reports = useReports((s) => s.reports)
  const startSeedFlow = useReports((s) => s.startSeedFlow)
  const seedOverride = useMemo(() => {
    const m = new Map<string, Rating | undefined>()
    for (const r of reports) if (r.seedId && !m.has(r.seedId)) m.set(r.seedId, r.verification.rating) // 같은 지점의 민원이 여러 건이어도 첫 건의 평가를 쓴다(ratingOfBarrier의 find와 같은 기준)
    return m
  }, [reports])
  const resetAll = useReports((s) => s.resetAll)
  const offsetDays = useReports((s) => s.offsetDays)
  const plans = usePlan((s) => s.entries)
  // 개선 현황: 기간은 시연 시각(nowMs) 기준
  const progress = useMemo(() => {
    void offsetDays
    return buildProgress({
      reports,
      barriers: BARRIERS,
      plans,
      now: nowMs(),
      periodDays: PERIODS.find((p) => p.id === period)?.days ?? null,
      placeName: (r) => {
        const sid = r.seedId ?? r.barrierId
        const b = sid ? BY_ID.get(sid) : null
        return b ? shortName(b.id, b.name) : `시민 제보${r.locationKind ? ` · ${r.locationKind}` : ''}`
      },
      seedName: (b) => shortName(b.id, b.name),
    })
  }, [reports, plans, period, offsetDays])
  const pgShown = useMemo(() => progress.items.filter((i) => pgStages.includes(i.stage)), [progress, pgStages])
  const ready = state.status === 'ready'

  useEffect(() => {
    let cancelled = false
    async function init() {
      try {
        const k = await loadKakao()
        const located = BARRIERS.filter((b) => b.geometry)
        let center: kakao.maps.LatLng | null = null
        if (located.length > 0) {
          const a = anchorOf(located[0].geometry as Geometry)
          center = new k.maps.LatLng(a[0], a[1])
        } else {
          for (const address of CENTER_ADDRESS_CANDIDATES) {
            center = await geocode(k, address)
            if (center) break
          }
        }
        if (start.report) center = new k.maps.LatLng(start.report.lat, start.report.lng)
        else if (start.at) center = new k.maps.LatLng(start.at.lat, start.at.lng)
        if (cancelled || !container.current) return
        if (!center) throw new Error('지도 중심 주소를 찾지 못했어요. 카카오 앱의 지도·로컬 사용 설정을 확인해 주세요.')
        const map = new k.maps.Map(container.current, { center, level: Math.min(4, PUB_MAX_LEVEL) })
        // 레이어를 켜 달라고 온 경우(layer=…)는 점이 보이는 확대(PUB_MAX_LEVEL 이하)로 열어야 해서 전체 보기로 넓히지 않는다.
        if (located.length > 0 && !start.report && !start.layer) {
          const bounds = new k.maps.LatLngBounds()
          for (const b of located) {
            const g = b.geometry as Geometry
            const pts = g.kind === 'point' ? [g.at] : g.path
            pts.forEach((p) => bounds.extend(new k.maps.LatLng(p[0], p[1])))
          }
          setTimeout(() => {
            map.relayout()
            fitRef.current = { bounds, top: 80 }
            movedRef.current = false
            fitWithSheet(map, bounds, 80)
          }, 150)
        }
        const markMoved = () => {
          movedRef.current = true
        }
        k.maps.event.addListener(map, 'dragstart', markMoved)
        k.maps.event.addListener(map, 'dragstart', () => followOffRef.current())
        container.current.addEventListener('wheel', markMoved, { passive: true })
        k.maps.event.addListener(map, 'click', (e) => {
          if (routePickRef.current) pickRoutePlace(e.latLng.getLat(), e.latLng.getLng(), `지도에서 고른 위치 (${e.latLng.getLat().toFixed(5)}, ${e.latLng.getLng().toFixed(5)})`)
          else if (pickingRef.current) setDraftPos({ lat: e.latLng.getLat(), lng: e.latLng.getLng() })
        })
        kRef.current = k
        setKObj(k)
        mapRef.current = map
        const readView = () => {
          const b = map.getBounds()
          const sw = b.getSouthWest()
          const ne = b.getNorthEast()
          const level = map.getLevel()
          const box: [number, number, number, number] = [sw.getLat(), sw.getLng(), ne.getLat(), ne.getLng()]
          // 같은 자리에서 멈췄으면 상태를 바꾸지 않아 공공 핀을 다시 그리지 않는다
          setView((prev) => (prev && prev.level === level && prev.b[0] === box[0] && prev.b[1] === box[1] && prev.b[2] === box[2] && prev.b[3] === box[3] ? prev : { level, b: box }))
        }
        k.maps.event.addListener(map, 'idle', readView)
        // 다른 탭에 다녀와도 같은 자리를 보여 주려고 마지막 위치를 기억해 둔다
        k.maps.event.addListener(map, 'idle', () => {
          const c = map.getCenter()
          keepRef.current = { lat: c.getLat(), lng: c.getLng(), level: map.getLevel() }
        })
        setState({ status: 'ready' })
        setTimeout(readView, 400)
        let focus: string[] = []
        try {
          const raw = sessionStorage.getItem('wheelmap.focusRoute')
          if (raw) {
            focus = JSON.parse(raw) as string[]
            sessionStorage.removeItem('wheelmap.focusRoute')
          }
        } catch {
          /* 강조 정보를 못 읽으면 일반 화면으로 */
        }
        const fb = new k.maps.LatLngBounds()
        let any = false
        for (const id of focus) {
          const g = BY_ID.get(id)?.geometry
          if (!g) continue
          any = true
          for (const pt of g.kind === 'point' ? [g.at] : g.path) fb.extend(new k.maps.LatLng(pt[0], pt[1]))
        }
        if (any) {
          setFocusIds(focus)
          setTimeout(() => {
            map.relayout()
            fitRef.current = { bounds: fb, top: 90 }
            movedRef.current = false
            fitWithSheet(map, fb, 90)
          }, 300)
        }
      } catch (e) {
        if (!cancelled) setState({ status: 'error', message: e instanceof Error ? e.message : String(e) })
      }
    }
    init()
    return () => {
      cancelled = true
    }
  }, [start])

  // 길찾기 중에는 경로와 관련 있는 지점만 또렷하게 보이고 나머지는 흐리게 한다.
  const routeIds = useMemo(() => {
    if (!overlay) return null
    const s = new Set<string>()
    for (const h of overlay.hits) s.add(h.o.id)
    for (const id of [overlay.start.id, overlay.end.id]) {
      if (!id) continue
      s.add(id)
      const p = BY_ID.get(id)?.parentId
      if (p) s.add(p)
    }
    return s
  }, [overlay])
  // 경로에서 먼 핀은 흐리게(경로 근처·경로가 지나는 지점은 그대로)
  const nearRoute = useMemo(() => {
    if (!overlay) return null
    const paths = [overlay.base, overlay.detour, ...(overlay.legs ?? []).map((l) => l.coords)].filter((p): p is [number, number][] => !!p)
    return makeNearRoute(paths, NEAR_ROUTE_M)
  }, [overlay])
  const mapLevel = view?.level ?? 4

  // 점·선·영역을 ○△X 색으로 그린다. 글자(○△X)도 같이 표시해 색만으로 구분하지 않게 한다.
  // 핀은 줌 단계에 따라 점 → 점+종류 → 이름까지 보여 주고, 화면에서 겹치는 핀은 숫자 묶음으로 합친다.
  useEffect(() => {
    const k = kRef.current
    const map = mapRef.current
    if (!ready || !k || !map) return
    const shapes: { setMap(m: kakao.maps.Map | null): void }[] = []
    const items: PinItem[] = []
    const dimOf = (id: string) => {
      if (!routeIds || routeIds.has(id)) return false
      const g = BY_ID.get(id)?.geometry
      const pts = g ? (g.kind === 'point' ? [g.at] : g.path) : []
      return !(nearRoute && pts.some((p) => nearRoute(p[0], p[1])))
    }
    for (const b of layers.team && !progressMode ? BARRIERS : []) {
      const g = b.geometry
      if (!g && b.provisional && !b.parentId) {
        // 확정 좌표가 없는 곳은 임시 위치를 점 하나로 그린다(길찾기 위치 고르기에는 쓰지 않는다)
        const pv = b.provisional
        const rk = ratingKeyOf(b, seedOverride)
        items.push({
          key: b.id,
          lat: pv.lat,
          lng: pv.lng,
          rating: rk,
          impact: impactOf(b, null),
          name: shortName(b.id, b.name),
          small: false,
          sel: b.id === selectedId,
          dim: !!routeIds && !(nearRoute && nearRoute(pv.lat, pv.lng)),
          route: false,
          prov: true,
          onClick: () => {
            if (routePickRef.current || pickingRef.current) return
            setSelectedId(b.id)
            setSelectedReportId(null)
          },
        })
        continue
      }
      if (!g) continue
      const isSel = b.id === selectedId
      const dim = dimOf(b.id)
      const rk = ratingKeyOf(b, seedOverride)
      const impact = impactOf(b, b.parentId ? BY_ID.get(b.parentId) : null)
      const st = styleOf(impact, rk)
      const select = () => {
        if (routePickRef.current) {
          const at = anchorOf(g)
          pickRoutePlace(at[0], at[1], b.parentId ? `${shortName(b.parentId, BY_ID.get(b.parentId)?.name ?? '')} (${b.name})` : shortName(b.id, b.name))
          return
        }
        if (pickingRef.current) {
          // 위치 선택 중에 기존 지점의 핀을 누르면 그 지점 위치를 제보 위치로 쓴다(중복 제보 확인용)
          const at = anchorOf(g)
          setDraftPos({ lat: at[0], lng: at[1] })
          return
        }
        setSelectedId(b.id)
        setSelectedReportId(null)
      }
      const pickOrSelect = (e: kakao.maps.event.MapMouseEvent) => {
        if (routePickRef.current && e?.latLng) pickRoutePlace(e.latLng.getLat(), e.latLng.getLng(), `지도에서 고른 위치 (${e.latLng.getLat().toFixed(5)}, ${e.latLng.getLng().toFixed(5)})`)
        else if (pickingRef.current && e?.latLng) setDraftPos({ lat: e.latLng.getLat(), lng: e.latLng.getLng() })
        else select()
      }
      if (g.kind === 'line') {
        const line = new k.maps.Polyline({
          map,
          path: g.path.map((p) => new k.maps.LatLng(p[0], p[1])),
          strokeWeight: isSel ? 10 : 7,
          strokeColor: st.color,
          strokeOpacity: dim ? 0.3 : 0.9,
          zIndex: isSel ? 2 : 1,
        })
        k.maps.event.addListener(line, 'click', pickOrSelect)
        shapes.push(line)
      } else if (g.kind === 'area') {
        // 영역은 테두리 위주로 옅게, 선택했을 때만 진하게 보인다(핀보다 항상 아래).
        const poly = new k.maps.Polygon({
          map,
          path: g.path.map((p) => new k.maps.LatLng(p[0], p[1])),
          strokeWeight: isSel ? 4 : 2,
          strokeColor: st.color,
          strokeOpacity: dim ? 0.3 : isSel ? 0.95 : 0.7,
          strokeStyle: isSel ? 'solid' : 'shortdash',
          fillColor: st.color,
          fillOpacity: dim ? 0.02 : isSel ? 0.28 : 0.07,
          zIndex: 0,
        })
        k.maps.event.addListener(poly, 'click', pickOrSelect)
        shapes.push(poly)
      }
      const a = anchorOf(g)
      items.push({
        key: b.id,
        lat: a[0],
        lng: a[1],
        rating: rk,
        impact,
        name: shortName(b.id, b.name),
        small: !!b.parentId,
        sel: isSel,
        dim,
        route: focusIds.includes(b.id),
        onClick: select,
      })
    }
    // 시민 제보 중 검증 완료된 건(source citizen). 판정 전이면 평가 없음 색으로 표시한다.
    // 표시 규칙: 레이어 메뉴의 상태·유형 선택에 맞는 건만 핀으로 그리고, 같은 지점의 여러 건은 한 핀에 건수로 합친다.
    const now = nowMs()
    const spots = new Map<string, Report[]>()
    for (const r of reports) {
      if (progressMode || !SHOWN_ON_MAP.includes(r.status) || r.seedId || !layers.team) continue
      if (!showCitizen(r, impactOfReport(r.type, r.locationKind), filter, now)) continue
      const sk = `${r.lat.toFixed(5)},${r.lng.toFixed(5)}`
      const g = spots.get(sk)
      if (g) g.push(r)
      else spots.set(sk, [r])
    }
    const sev = (r: Report) => ({ X: 3, TRIANGLE: 2, none: 1, O: 0 } as Record<string, number>)[r.verification.rating ?? 'none']
    for (const group of spots.values()) {
      const r = group.length > 1 ? group.slice().sort((a, b) => sev(b) - sev(a))[0] : group[0]
      const n = group.length
      items.push({
        key: r.id,
        lat: r.lat,
        lng: r.lng,
        rating: r.verification.rating ?? 'none',
        impact: impactOfReport(r.type, r.locationKind),
        name: '시민 제보',
        title: `시민 제보 · ${r.type}${r.verification.rating ? '' : ' · 판정 대기'}${r.status === 'verified' ? '' : ` · ${STATUS_LABEL[r.status]}`}${isExpired(r) ? ' · 만료' : ''}${n > 1 ? ` · 같은 곳 ${n}건` : ''}`,
        small: false,
        sel: group.some((x) => x.id === selectedReportId),
        dim: !!routeIds && !(nearRoute && nearRoute(r.lat, r.lng)),
        route: false,
        citizen: true,
        expired: isExpired(r),
        count: n,
        onClick: () => {
          if (pickingRef.current) {
            setDraftPos({ lat: r.lat, lng: r.lng })
            return
          }
          setSelectedReportId(r.id)
          setSelectedId(null)
        },
      })
    }
    if (progressMode) {
      for (const it of pgShown) {
        const isReport = it.kind === 'report'
        items.push({
          key: it.key,
          lat: it.lat,
          lng: it.lng,
          rating: 'none',
          impact: null,
          name: it.title,
          small: false,
          sel: isReport ? it.id === selectedReportId : it.id === selectedId,
          dim: false,
          route: false,
          pg: { stage: it.stage, label: PROGRESS_INFO[it.stage].short },
          onClick: () => (isReport ? openReportRef.current(it.id) : openSeedRef.current(it.id)),
        })
      }
    }

    // 경로를 띄운 동안에는 경로에서 40m 안의 핀만 작은 점으로 남기고, 경로가 지나는 지점(고리 표시가 따로 있음)·먼 핀·묶음은 그리지 않는다
    if (routeIds) for (let n = items.length - 1; n >= 0; n--) if (!items[n].sel && (items[n].dim || routeIds.has(items[n].key))) items.splice(n, 1)
    const level = map.getLevel()
    const fade = drawnLevel.current !== null && drawnLevel.current !== level ? ' bm-fade-in' : ''
    drawnLevel.current = level
    const proj = (map as unknown as { getProjection(): { containerPointFromCoords(c: kakao.maps.LatLng): { x: number; y: number } } }).getProjection()
    const px = items.map((it) => proj.containerPointFromCoords(new k.maps.LatLng(it.lat, it.lng)))
    const prio = (it: PinItem) => (it.sel ? 100 : 0) + (it.small ? 0 : 5) + (it.pg ? ({ overdue: 3, agency: 2, intake: 2, done: 1, rechecked: 1, plan: 1 } as Record<string, number>)[it.pg.stage] : ({ X: 3, TRIANGLE: 2, none: 1, O: 0 } as Record<string, number>)[it.rating])

    // 1) 점끼리 가까우면 묶음으로(선택한 핀은 묶지 않는다). 멀리서 볼수록 더 크게 묶고, 시민 제보는 팀 조사 지점과 따로 더 크게 묶는다.
    //    묶음 원은 건수에 따라 크기가 달라지고, 서로 겹치면 하나로 합쳐 숫자 원끼리 겹치지 않게 한다.
    const baseR = level >= 6 ? 64 : level === 5 ? 54 : level === 4 ? 44 : level === 3 ? 34 : 26
    const cnt = (m: number[]) => m.reduce((s, i) => s + (items[i].count ?? 1), 0)
    const diaOf = (n: number) => Math.min(46, Math.round(24 + 6 * Math.log2(n)))
    type Cl = { m: number[]; x: number; y: number }
    const centroid = (m: number[]): Cl => ({ m, x: m.reduce((s, i) => s + px[i].x, 0) / m.length, y: m.reduce((s, i) => s + px[i].y, 0) / m.length })
    const buildGroup = (idxs: number[], radius: number) => {
      const sorted = idxs.slice().sort((a, b) => prio(items[b]) - prio(items[a]))
      const used = new Set<number>()
      const cls: Cl[] = []
      const rest: number[] = []
      for (const i of sorted) {
        if (used.has(i)) continue
        used.add(i)
        const m = [i]
        if (!items[i].sel) {
          for (const j of sorted) {
            if (used.has(j) || items[j].sel) continue
            if (Math.hypot(px[i].x - px[j].x, px[i].y - px[j].y) < radius) {
              used.add(j)
              m.push(j)
            }
          }
        }
        if (m.length > 1) cls.push(centroid(m))
        else rest.push(i)
      }
      const mergeAll = () => {
        for (;;) {
          let found = false
          for (let a = 0; a < cls.length && !found; a++) {
            for (let b = a + 1; b < cls.length; b++) {
              if (Math.hypot(cls[a].x - cls[b].x, cls[a].y - cls[b].y) < (diaOf(cnt(cls[a].m)) + diaOf(cnt(cls[b].m))) / 2 + 3) {
                cls[a] = centroid([...cls[a].m, ...cls[b].m])
                cls.splice(b, 1)
                found = true
                break
              }
            }
          }
          if (!found) return
        }
      }
      mergeAll()
      // 남은 점이 묶음 원에 닿으면 그 묶음에 넣는다
      const singles: number[] = []
      for (const i of rest) {
        const c = items[i].sel ? undefined : cls.find((cc) => Math.hypot(cc.x - px[i].x, cc.y - px[i].y) < diaOf(cnt(cc.m)) / 2 + 14)
        if (c) c.m.push(i)
        else singles.push(i)
      }
      mergeAll()
      return { cls, singles }
    }
    const all = items.map((_, i) => i)
    const teamG = buildGroup(all.filter((i) => !items[i].citizen), baseR)
    const citG = buildGroup(all.filter((i) => items[i].citizen), Math.round(baseR * 1.35))
    const clusters = routeIds ? [] : [...teamG.cls.map((c) => ({ m: c.m, x: c.x, y: c.y, cit: false })), ...citG.cls.map((c) => ({ m: c.m, x: c.x, y: c.y, cit: true }))]
    // 팀 조사 지점 위에 겹치는 시민 제보 점·묶음은 그리지 않는다(팀 조사 지점이 항상 먼저 보이게)
    const teamBoxes = [
      ...teamG.cls.map((c) => ({ x: c.x, y: c.y, r: diaOf(cnt(c.m)) / 2 })),
      ...teamG.singles.map((i) => ({ x: px[i].x, y: px[i].y, r: 13 })),
    ]
    const underTeam = (x: number, y: number, r: number) => teamBoxes.some((b) => Math.hypot(b.x - x, b.y - y) < b.r + r + 1)
    for (let n = clusters.length - 1; n >= 0; n--) if (clusters[n].cit && underTeam(clusters[n].x, clusters[n].y, diaOf(cnt(clusters[n].m)) / 2)) clusters.splice(n, 1)
    const singles = routeIds ? all : [...teamG.singles, ...citG.singles.filter((i) => items[i].sel || !underTeam(px[i].x, px[i].y, 7))]

    // 2) 남은 핀은 줌 단계가 허용하는 가장 풍부한 모양으로, 다른 글자와 겹치면 한 단계씩 줄인다. 시민 제보는 멀리서는 작은 색 점으로만 그린다.
    const allowed: PinMode[] = level >= 3 ? ['dot'] : level === 2 ? ['chip', 'dot'] : ['full', 'chip', 'dot'] // 글자·아이콘은 충분히 확대했을 때만
    const placed: { x: number; y: number; w: number }[] = []
    const hit = (x: number, y: number, w: number) => placed.some((p) => Math.abs(p.x - x) < (p.w + w) / 2 + 3 && Math.abs(p.y - y) < PIN_H + 3)
    const widthOf = (it: PinItem, m: PinMode) => (m === 'lite' ? 14 : m === 'dot' ? DOT_PX : it.pg ? 38 + it.pg.label.length * 12.5 : m === 'chip' ? 52 : 26 + 27 + it.name.length * 13.5 + 12)
    const modeOf = new Map<number, PinMode>()
    const teamOrder = singles.filter((i) => !items[i].citizen || items[i].sel).sort((i, j) => prio(items[j]) - prio(items[i]))
    for (const i of teamOrder) {
      const it = items[i]
      const chipOnly = (a: PinMode[]) => a.map((x) => (x === 'full' ? ('chip' as PinMode) : x))
      const tryModes: PinMode[] = it.pg ? (it.sel ? ['chip'] : chipOnly(allowed)) : it.sel ? ['full'] : it.small ? ['dot'] : it.citizen ? ['dot'] : allowed
      const m = it.sel ? (it.pg ? 'chip' : 'full') : (tryModes.find((mm) => !hit(px[i].x, px[i].y, widthOf(it, mm))) ?? 'dot')
      modeOf.set(i, m)
      placed.push({ x: px[i].x, y: px[i].y, w: widthOf(it, m) })
    }
    for (const i of singles) if (!modeOf.has(i)) modeOf.set(i, level >= 4 ? 'lite' : 'dot')

    for (const i of singles) {
      const it = items[i]
      const mode = modeOf.get(i) ?? 'dot'
      if (it.pg) {
        // 개선 현황 핀: 색 + 글자(접·처·!·완·확·계)로 단계를 구분하고, 가까이에서는 단계 이름도 쓴다.
        const pe = document.createElement('div')
        pe.className = `bm-pin bm-pin--${mode} bm-pin-pg pg-${it.pg.stage}` + (it.sel ? ' bm-pin-sel' : '') + fade
        const text = `${it.name} · ${PROGRESS_INFO[it.pg.stage].label}`
        pe.title = text
        pe.setAttribute('role', 'button')
        pe.tabIndex = 0
        pe.setAttribute('aria-label', text)
        const pgG = document.createElement('span')
        pgG.className = 'bm-pin-g'
        pgG.textContent = PROGRESS_INFO[it.pg.stage].glyph
        pe.appendChild(pgG)
        if (mode !== 'dot') {
          const pn = document.createElement('span')
          pn.className = 'bm-pin-n'
          pn.textContent = it.pg.label
          pe.appendChild(pn)
        }
        pe.addEventListener('click', (e) => {
          e.stopPropagation()
          it.onClick()
        })
        pe.addEventListener('keydown', (e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            it.onClick()
          }
        })
        shapes.push(new k.maps.CustomOverlay({ position: new k.maps.LatLng(it.lat, it.lng), content: pe, map, xAnchor: 0.5, yAnchor: 0.5, zIndex: it.sel ? 10 : 4 }))
        continue
      }
      const st = styleOf(it.impact ?? 'passage', it.rating)
      const el = document.createElement('div')
      el.className = `bm-pin bm-pin--${mode}` + (it.small ? ' bm-pin-small' : '') + (it.sel ? ' bm-pin-sel' : '') + (it.route ? ' bm-pin-route' : '') + (it.citizen ? ' bm-pin-citizen' : '') + (it.expired ? ' bm-pin-expired' : '') + (it.dim ? ' bm-pin-dim' : '') + fade
      el.style.background = st.color
      el.style.color = st.ink
      const kindText = it.impact ? IMPACT_INFO[it.impact].label : ''
      const line = it.impact ? impactLine(it.impact, it.rating) : ''
      const full = it.title ?? `${it.name} · ${line}`
      el.title = full
      el.setAttribute('role', 'button')
      el.tabIndex = 0
      el.setAttribute('aria-label', `${full}, ${RATING_STYLE[it.rating].label}`)
      const g = document.createElement('span')
      g.className = 'bm-pin-g'
      g.textContent = st.glyph
      el.appendChild(g)
      if (mode !== 'dot' && mode !== 'lite' && it.impact) {
        const kk = document.createElement('span')
        kk.className = 'bm-pin-k'
        kk.textContent = IMPACT_INFO[it.impact].glyph
        kk.setAttribute('aria-hidden', 'true')
        el.appendChild(kk)
      }
      if (it.count && it.count > 1 && mode !== 'lite') {
        const cc = document.createElement('span')
        cc.className = 'bm-pin-cnt'
        cc.textContent = `×${it.count}`
        el.appendChild(cc)
      }
      if (mode === 'full') {
        const n = document.createElement('span')
        n.className = 'bm-pin-n'
        n.textContent = it.name
        el.appendChild(n)
      }
      void kindText
      el.addEventListener('click', (e) => {
        e.stopPropagation()
        it.onClick()
      })
      el.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          it.onClick()
        }
      })
      shapes.push(new k.maps.CustomOverlay({ position: new k.maps.LatLng(it.lat, it.lng), content: el, map, xAnchor: 0.5, yAnchor: 0.5, zIndex: it.sel ? 10 : it.citizen ? 5 : 4 }))
    }

    for (const cl of clusters) {
      const ms = cl.m.map((i) => items[i])
      const total = ms.reduce((s, m) => s + (m.count ?? 1), 0)
      const lat = ms.reduce((s, m) => s + m.lat, 0) / ms.length
      const lng = ms.reduce((s, m) => s + m.lng, 0) / ms.length
      const el = document.createElement('div')
      el.className = 'bm-cluster' + (cl.cit ? ' bm-cluster--cit' : '') + (ms.every((m) => m.dim) ? ' bm-pin-dim' : '') + fade
      const d = diaOf(total)
      el.style.width = el.style.height = `${d}px`
      el.style.fontSize = total >= 100 ? '0.75rem' : '0.8125rem'
      el.textContent = String(total)
      el.title = `${total}건이 모여 있어요. 누르면 확대해요.`
      el.setAttribute('role', 'button')
      el.tabIndex = 0
      el.setAttribute('aria-label', `${total}건이 모여 있어요. 누르면 확대해요.`)
      const zoomIn = () => {
        const b = new k.maps.LatLngBounds()
        ms.forEach((m) => b.extend(new k.maps.LatLng(m.lat, m.lng)))
        map.setBounds(b, Math.max(80, topCoverOf(container.current) + 16), 60, Math.max(80, coverOf(container.current) + 24), 60)
        if (map.getLevel() >= level) map.setLevel(Math.max(1, level - 1))
      }
      el.addEventListener('click', (e) => {
        e.stopPropagation()
        zoomIn()
      })
      el.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          zoomIn()
        }
      })
      shapes.push(new k.maps.CustomOverlay({ position: new k.maps.LatLng(lat, lng), content: el, map, xAnchor: 0.5, yAnchor: 0.5, zIndex: cl.cit ? 3 : 5 }))
    }
    return () => shapes.forEach((s) => s.setMap(null))
  }, [ready, selectedId, layers.team, seedOverride, focusIds, reports, selectedReportId, routeIds, nearRoute, mapLevel, progressMode, pgShown, filter, offsetDays])

  // 레이어를 켤 때 해당 데이터만 동적 import로 불러온다.
  useEffect(() => {
    for (const l of PUB_LAYERS) {
      if (!layers[l.id] || requested.current.has(l.id)) continue
      requested.current.add(l.id)
      loadPubDataset(l.id)
        .then((d) => setPubData((s) => ({ ...s, [l.id]: d })))
        .catch(() => {
          requested.current.delete(l.id)
          setPubError((s) => ({ ...s, [l.id]: true }))
        })
    }
  }, [layers])

  // 화면 범위 안의 공공데이터 항목(레벨이 넓으면 그리지 않음)
  // 켜진 레이어의 표시 대상(화면 범위와 무관해서 지도를 움직일 때는 다시 거르지 않는다)
  const pubPools = useMemo(() => {
    const out: { id: PubLayerId; pool: PubItem[] }[] = []
    for (const l of PUB_LAYERS) {
      const d = pubData[l.id]
      if (!layers[l.id] || !d) continue
      out.push({ id: l.id, pool: (l.id === 'facility' ? groupFacilities(d.items) : d.items).filter((i) => i.lat != null && i.lng != null && pubItemShown(l.id, i, layers)) })
    }
    return out
  }, [pubData, layers])
  const pubVisible = useMemo(() => {
    const out: { layer: PubLayerId; items: PubItem[]; total: number; inView: number }[] = []
    for (const { id, pool } of pubPools) {
      if (!view) {
        out.push({ layer: id, items: [], total: pool.length, inView: 0 })
        continue
      }
      const [s, w, n, e] = view.b
      const inView = pool.filter((i) => (i.lat as number) >= s && (i.lat as number) <= n && (i.lng as number) >= w && (i.lng as number) <= e)
      out.push({ layer: id, items: view.level > PUB_MAX_LEVEL ? [] : inView.slice(0, PUB_MAX_DRAW), total: pool.length, inView: inView.length })
    }
    return out
  }, [pubPools, view])

  useEffect(() => {
    const k = kRef.current
    const map = mapRef.current
    if (!ready || !k || !map) return
    const shapes: { setMap(m: kakao.maps.Map | null): void }[] = []
    for (const g of pubVisible) {
      const info = PUB_LAYERS.find((l) => l.id === g.layer)
      if (!info) continue
      for (const it of g.items) {
        const warn = g.layer === 'crosswalk' && it.fields['보도턱낮춤여부'] === 'N'
        const acc = g.layer === 'voucher' && it.fields['access'] === 'info' // 출입구 정보가 있는 가맹점
        const isSel = pubSel?.item.id === it.id && pubSel.layer === g.layer
        const el = document.createElement('div')
        const dot = mapLevel > 3 && !isSel
        el.className = 'bm-pub' + (warn ? ' bm-pub-warn' : '') + (acc ? ' bm-pub-acc' : '') + (isSel ? ' bm-pub-sel' : '') + (dot ? ' bm-pub--dot' : '')
        el.style.background = info.color
        el.innerHTML = dot ? '' : iconSvg(info.icon, PUB_ICON_PX, PUB_ICON_STROKE) + (warn ? '<b>!</b>' : '') + (acc ? iconSvg('access', PUB_ICON_PX, PUB_ICON_STROKE) : '')
        const shownName = g.layer === 'facility' ? facilityLabel(it) : it.name
        el.title = warn ? `${shownName} (보도턱 낮춤 없음)` : acc ? `${shownName} (출입구 정보 있음)` : shownName
        el.setAttribute('role', 'button')
        el.tabIndex = 0
        el.setAttribute('aria-label', `${info.label}, ${el.title}`)
        el.addEventListener('keydown', (e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            setPubSel({ layer: g.layer, item: it })
          }
        })
        el.addEventListener('click', (e) => {
          e.stopPropagation()
          if (pickingRef.current) {
            setDraftPos({ lat: it.lat as number, lng: it.lng as number })
            return
          }
          setPubSel({ layer: g.layer, item: it })
        })
        shapes.push(new k.maps.CustomOverlay({ position: new k.maps.LatLng(it.lat as number, it.lng as number), content: el, map, yAnchor: 0.5, xAnchor: 0.5, zIndex: isSel ? 3 : 2 }))
      }
    }
    return () => shapes.forEach((s) => s.setMap(null))
  }, [ready, pubVisible, pubSel, mapLevel])

  // 길찾기 결과: 경로선(최단=회색 점선, 우회=파란 실선), 출발·도착, 경로상 장애요소 강조, 횡단보도·정류장 표시
  useEffect(() => {
    const k = kRef.current
    const map = mapRef.current
    if (!ready || !k || !map || !overlay) return
    const shapes: { setMap(m: kakao.maps.Map | null): void }[] = []
    const ll = (p: [number, number]) => new k.maps.LatLng(p[0], p[1])
    // 경로선: 흰 테두리(아래) + 색 실선(위). 모두 같은 굵기, 끝은 둥글게(map.css). 도보=파랑, 버스=노선 종류 색.
    // 기존 최단길과 개선 경로를 같이 보여 줄 때는 고른 쪽이 파랑, 다른 쪽은 연한 회색 파랑으로 둔다.
    const W = 7
    const both = !!(overlay.base && overlay.detour)
    const draw = (path: [number, number][] | null, kind: 'base' | 'detour') => {
      if (!path) return
      const on = !both || overlay.active === kind
      const lls = path.map(ll)
      shapes.push(
        new k.maps.Polyline({ map, path: lls, strokeWeight: W + 4, strokeColor: '#ffffff', strokeOpacity: on ? 1 : 0.75, strokeStyle: 'solid', zIndex: on ? 8 : 6 }),
        new k.maps.Polyline({ map, path: lls, strokeWeight: W, strokeColor: on ? ROUTE_WALK : ROUTE_BASE, strokeOpacity: on ? 1 : 0.6, strokeStyle: 'solid', zIndex: on ? 9 : 7 }),
      )
    }
    draw(overlay.base, 'base')
    draw(overlay.detour, 'detour')
    // 버스가 섞인 경로: 걷는 구간은 파랑 실선, 버스 구간은 노선 종류 색 실선
    for (const l of overlay.legs ?? []) {
      const lls = l.coords.map(ll)
      const col = l.kind === 'bus' ? busColor(l.route) : ROUTE_WALK
      shapes.push(
        new k.maps.Polyline({ map, path: lls, strokeWeight: W + 4, strokeColor: '#ffffff', strokeOpacity: 1, strokeStyle: 'solid', zIndex: 8 }),
        new k.maps.Polyline({ map, path: lls, strokeWeight: W, strokeColor: col, strokeOpacity: 1, strokeStyle: 'solid', zIndex: 9 }),
      )
    }
    for (const h of overlay.hits) {
      const st = ROLE_STYLE[h.role]
      const el = document.createElement('div')
      el.className = 'rt-ring' + (overlay.focus === h.o.id ? ' on' : '')
      el.style.background = st.color
      el.style.color = (st as { ink?: string }).ink ?? '#fff'
      el.textContent = st.glyph
      el.title = `${obstacleName(h.o)} — ${st.label}`
      shapes.push(new k.maps.CustomOverlay({ position: new k.maps.LatLng(h.anchor[0], h.anchor[1]), content: el, map, xAnchor: 0.5, yAnchor: 0.5, zIndex: 11 }))
    }
    return () => shapes.forEach((x) => x.setMap(null))
  }, [ready, overlay])

  // 길찾기 지도의 작은 딱지(횡단보도·정류장·화장실 등). 확대·축소하면 정류장 묶음만 다시 계산한다.
  useEffect(() => {
    const k = kRef.current
    const map = mapRef.current
    if (!ready || !k || !map || !overlay) return
    const shapes: { setMap(m: kakao.maps.Map | null): void }[] = []
    // 정류장 딱지(「정류장」「버스」)는 화면에서 가까운 것끼리 묶어 하나로 보인다. 확대하면 풀린다.
    const isStop = (m: RouteMarker) => m.cls === 'rt-m-bus' && (m.text === '정류장' || m.text === '버스')
    const stops = overlay.markers.filter(isStop)
    const proj = map.getProjection()
    const groups = clusterByScreen(stops.map((m) => proj.containerPointFromCoords(new k.maps.LatLng(m.lat, m.lng))))
    const draw = (m: RouteMarker, text: string, title: string) => {
      const el = document.createElement('div')
      el.className = 'rt-m ' + m.cls
      el.textContent = text
      el.title = title
      shapes.push(new k.maps.CustomOverlay({ position: new k.maps.LatLng(m.lat, m.lng), content: el, map, xAnchor: 0.5, yAnchor: 0.5, zIndex: 9 }))
    }
    for (const m of overlay.markers) if (!isStop(m)) draw(m, m.text, m.title)
    for (const g of groups) {
      const first = stops[g[0]]
      if (g.length === 1) draw(first, first.text, first.title)
      else draw(first, `정류장 ${g.length}`, [...new Set(g.map((i) => stops[i].title))].join(', '))
    }
    return () => shapes.forEach((x) => x.setMap(null))
  }, [ready, overlay, mapLevel])

  // 출발·도착 표시와 버스 번호 칩: 화면에서 겹치면 위로 비켜 놓고, 너무 멀리서 볼 때는 칩을 숨긴다(칩은 타는 곳에 노선마다 하나).
  useEffect(() => {
    const k = kRef.current
    const map = mapRef.current
    if (!ready || !k || !map || !overlay) return
    const shapes: { setMap(m: kakao.maps.Map | null): void }[] = []
    const proj = map.getProjection()
    type Lab = { lat: number; lng: number; el: HTMLElement; z: number }
    const labs: Lab[] = []
    const mk = (p: { lat: number; lng: number }, text: string, cls: string, z: number, bg?: string) => {
      const el = document.createElement('div')
      el.className = cls
      el.textContent = text
      if (bg) el.style.background = bg
      labs.push({ lat: p.lat, lng: p.lng, el, z })
    }
    mk(overlay.end, '도착', 'rt-flag rt-flag-e', 14)
    mk(overlay.start, '출발', 'rt-flag rt-flag-s', 13)
    if (mapLevel <= 7) {
      for (const l of overlay.legs ?? []) {
        if (l.kind === 'bus' && l.lineName && l.coords.length > 0) mk({ lat: l.coords[0][0], lng: l.coords[0][1] }, l.lineName, 'rt-busno', 12, busColor(l.route))
      }
    }
    // 고리(경로 위 장애요소)와 타는·내리는 표시 자리를 먼저 차지한 것으로 보고, 글자 표시는 그 위로 비켜 놓는다
    const placed: { x: number; y: number }[] = []
    for (const h of overlay.hits) {
      const q = proj.containerPointFromCoords(new k.maps.LatLng(h.anchor[0], h.anchor[1]))
      placed.push({ x: q.x, y: q.y })
    }
    for (const m of overlay.markers) {
      const q = proj.containerPointFromCoords(new k.maps.LatLng(m.lat, m.lng))
      placed.push({ x: q.x, y: q.y })
    }
    for (const lb of labs) {
      const pt = proj.containerPointFromCoords(new k.maps.LatLng(lb.lat, lb.lng))
      let up = 0
      for (let i = 0; i < 5; i++) {
        const y = pt.y - 18 - up
        if (placed.some((q) => Math.abs(q.x - pt.x) < 62 && Math.abs(q.y - y) < 34)) up += 40
        else break
      }
      placed.push({ x: pt.x, y: pt.y - 18 - up })
      shapes.push(new k.maps.CustomOverlay({ position: new k.maps.LatLng(lb.lat, lb.lng), content: lb.el, map, xAnchor: 0.5, yAnchor: 1 + (6 + up) / 24, zIndex: lb.z }))
    }
    return () => shapes.forEach((x) => x.setMap(null))
  }, [ready, overlay, mapLevel])

  // 진행 방향 화살표: 보이는 경로(선택한 길·버스 경로)를 따라 일정 간격으로 작은 흰 화살표를 놓는다. 줌 단계에 맞춰 간격을 바꾼다.
  useEffect(() => {
    const k = kRef.current
    const map = mapRef.current
    if (!ready || !k || !map || !overlay) return
    const shapes: { setMap(m: kakao.maps.Map | null): void }[] = []
    const step = Math.max(25, Math.min(500, 40 * 2 ** (mapLevel - 3)))
    const paths: [number, number][][] = []
    if (overlay.legs?.length) for (const l of overlay.legs) paths.push(l.coords)
    else {
      const p = overlay.active === 'base' ? overlay.base : overlay.detour
      if (p) paths.push(p)
    }
    let n = 0
    for (const p of paths) {
      for (const sp of arrowSpots(p, step)) {
        if (n++ > 120) break
        const el = document.createElement('div')
        el.className = 'rt-arrow'
        el.setAttribute('aria-hidden', 'true')
        el.innerHTML = `<svg width="12" height="12" viewBox="0 0 12 12" style="transform:rotate(${Math.round(sp.angle)}deg)"><path d="M6 1.5 10 9 6 7 2 9Z" fill="#fff" stroke="rgba(25,31,40,.55)" stroke-width="1" stroke-linejoin="round"/></svg>`
        shapes.push(new k.maps.CustomOverlay({ position: new k.maps.LatLng(sp.at[0], sp.at[1]), content: el, map, xAnchor: 0.5, yAnchor: 0.5, zIndex: 10, clickable: false }))
      }
    }
    return () => shapes.forEach((x) => x.setMap(null))
  }, [ready, overlay, mapLevel])

  // 새 결과가 오면 경로 전체가 보이게, 장애요소를 고르면 그곳으로 이동
  useEffect(() => {
    const k = kRef.current
    const map = mapRef.current
    if (!ready || !k || !map || !overlay) return
    if (overlay.fitKey !== lastFit.current) {
      lastFit.current = overlay.fitKey
      if (overlay.guide) return // 안내 모드에서는 지금 단계로 맞춘다(아래 효과)
      const b = new k.maps.LatLngBounds()
      for (const p of [...(overlay.base ?? []), ...(overlay.detour ?? []), ...(overlay.legs ?? []).flatMap((l) => l.coords)]) b.extend(new k.maps.LatLng(p[0], p[1]))
      setTimeout(() => {
        map.relayout()
        fitWithSheet(map, b, 70) // 위 검색줄·헤더와 아래 시트가 가린 만큼 여백을 둔다
      }, 100)
    } else if (overlay.focus) {
      const h = overlay.hits.find((x) => x.o.id === overlay.focus)
      if (h) map.panTo(new k.maps.LatLng(h.anchor[0], h.anchor[1]))
    }
  }, [ready, overlay])

  // 안내 모드: 지금 단계의 경로선을 굵게 강조하고 꺾는 곳에 표시를 놓고, 이 단계와 다음 단계가 보이게 맞춘다
  const guideN = overlay?.guide?.n ?? -1
  useEffect(() => {
    const k = kRef.current
    const map = mapRef.current
    const gd = overlay?.guide
    if (!ready || !k || !map || !gd) return
    const shapes: { setMap(m: kakao.maps.Map | null): void }[] = []
    const lls = gd.coords.map((p) => new k.maps.LatLng(p[0], p[1]))
    if (lls.length >= 2)
      shapes.push(
        new k.maps.Polyline({ map, path: lls, strokeWeight: 15, strokeColor: '#ffffff', strokeOpacity: 1, strokeStyle: 'solid', zIndex: NAV_Z.route }),
        new k.maps.Polyline({ map, path: lls, strokeWeight: 10, strokeColor: '#ff8a00', strokeOpacity: 1, strokeStyle: 'solid', zIndex: NAV_Z.route + 1 }),
      )
    const el = document.createElement('div')
    el.className = 'rt-gstep'
    el.textContent = gd.turn
    shapes.push(new k.maps.CustomOverlay({ position: new k.maps.LatLng(gd.at[0], gd.at[1]), content: el, map, xAnchor: 0.5, yAnchor: 0.5, zIndex: NAV_Z.step }))
    gstepElRef.current = el
    const b = new k.maps.LatLngBounds()
    for (const p of [...gd.coords, ...gd.next]) b.extend(new k.maps.LatLng(p[0], p[1]))
    const t = setTimeout(() => {
      map.relayout()
      if (wantLocRef.current && followRef.current) return // 따라가는 중에는 내 위치가 가운데에 오도록 위치가 들어올 때 맞춘다
      const el = container.current
      const proj = map.getProjection()
      const pts = [...gd.coords, ...gd.next]
      const inView =
        !!el &&
        pts.every((p) => {
          const q = proj.containerPointFromCoords(new k.maps.LatLng(p[0], p[1]))
          return q.x > 30 && q.x < el.clientWidth - 30 && q.y > topCoverOf(el) + 20 && q.y < el.clientHeight - coverOf(el) - 20
        })
      if (inView && pts.length > 0) {
        // 이미 화면 안에 있으면 확대·축소 없이 부드럽게 옮기기만 한다
        const c = pts.reduce((m, p) => [m[0] + p[0] / pts.length, m[1] + p[1] / pts.length], [0, 0])
        centerOnMe(new k.maps.LatLng(c[0], c[1]))
      } else {
        fitWithSheet(map, b, 70)
        if (map.getLevel() < 2) map.setLevel(2)
      }
    }, 80)
    return () => {
      clearTimeout(t)
      gstepElRef.current = null
      shapes.forEach((x) => x.setMap(null))
    }
    // 단계 번호가 바뀔 때만 다시 그린다(overlay 객체는 매번 새로 만들어진다)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, guideN, overlay?.guide?.at[0], overlay?.guide?.at[1]])

  // 내 위치가 지금 단계 지점과 가까우면 단계 원을 작고 흐리게 해서 내 위치 점이 묻히지 않게 한다
  const gAt = overlay?.guide?.at
  useEffect(() => {
    gstepElRef.current?.classList.toggle('rt-gstep-near', isStepNear(myPos ? [myPos.lat, myPos.lng] : null, gAt ?? null, NAV_STEP_NEAR_M))
  }, [myPos, gAt, guideN, ready])

  // 제보 작성 중 위치 마커(끌어서 옮길 수 있음)
  useEffect(() => {
    const k = kRef.current
    const map = mapRef.current
    if (!ready || !k || !map || !flowOpen || !draftPos) return
    if (picking) return // 위치를 고르는 동안은 지도 한가운데 핀이 위치를 나타낸다
    const marker = new k.maps.Marker({ position: new k.maps.LatLng(draftPos.lat, draftPos.lng), map, draggable: true, title: '제보 위치' })
    k.maps.event.addListener(marker, 'dragend', () => {
      const p = marker.getPosition()
      setDraftPos({ lat: p.getLat(), lng: p.getLng() })
    })
    return () => marker.setMap(null)
  }, [ready, flowOpen, draftPos, picking])

  // 위치 고르기: 지도를 끌면 중앙 핀이 떠오르고, 놓으면 내려앉으며 그 자리가 제보 위치가 된다(지도 끌기·확대는 막지 않고 이벤트만 듣는다).
  useEffect(() => {
    const k = kRef.current
    const map = mapRef.current
    if (!ready || !k || !map || !picking) return
    const c0 = map.getCenter()
    if (draftPos) map.setCenter(new k.maps.LatLng(draftPos.lat, draftPos.lng))
    else setDraftPos({ lat: c0.getLat(), lng: c0.getLng() })
    const onStart = () => setPinLifted(true)
    const onEnd = () => {
      setPinLifted(false)
      const c = map.getCenter()
      const next = { lat: c.getLat(), lng: c.getLng() }
      if (pinMoved(draftRef.current, next)) {
        setDraftPos(next)
        setPinLanded((n) => n + 1)
        haptic('tick')
      }
    }
    k.maps.event.addListener(map, 'dragstart', onStart)
    k.maps.event.addListener(map, 'dragend', onEnd)
    return () => {
      k.maps.event.removeListener(map, 'dragstart', onStart)
      k.maps.event.removeListener(map, 'dragend', onEnd)
      setPinLifted(false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, picking])

  // 위치가 바뀌면(현재 위치 등) 지도를 그쪽으로 옮긴다.
  useEffect(() => {
    const k = kRef.current
    const map = mapRef.current
    if (ready && k && map && draftPos && flowOpen) map.setCenter(new k.maps.LatLng(draftPos.lat, draftPos.lng))
  }, [ready, flowOpen, draftPos])

  // 선택한 항목으로 이동
  useEffect(() => {
    const k = kRef.current
    const map = mapRef.current
    const b = selectedId ? BY_ID.get(selectedId) : null
    if (!ready || !k || !map || !(b?.geometry || b?.provisional)) return
    const a: LatLng = b.geometry ? anchorOf(b.geometry) : [b.provisional!.lat, b.provisional!.lng]
    map.panTo(new k.maps.LatLng(a[0], a[1]))
  }, [selectedId, ready])

  // 핀을 고르면 상세 시트가 올라온다: 올라온 뒤에 핀이 시트에 가렸으면 보이는 곳으로 옮긴다
  const revealRef = useRef(revealSelected)
  useEffect(() => {
    revealRef.current = revealSelected
  })
  useEffect(() => {
    if (!ready || (!selectedId && !selectedReportId)) return
    // 상세 시트가 올라오는 시간은 기기마다 달라 몇 번 살핀다(가려진 때만 움직이므로 여러 번 불러도 안전하다)
    const ts = [500, 1200, 2200, 3500].map((ms) => setTimeout(() => revealRef.current(), ms))
    return () => ts.forEach(clearTimeout)
  }, [selectedId, selectedReportId, ready])

  // 탭을 바꿔 숨겨졌다가 다시 보일 때: 크기를 다시 재고 보던 자리로 돌아간다
  useEffect(() => {
    const k = kRef.current
    const map = mapRef.current
    if (!active || !ready || !k || !map) return
    const t = setTimeout(() => {
      map.relayout()
      const c = keepRef.current
      if (c) {
        map.setLevel(c.level)
        map.setCenter(new k.maps.LatLng(c.lat, c.lng))
      }
    }, 30)
    return () => clearTimeout(t)
  }, [active, ready])

  useEffect(() => {
    const onView = () => setTimeout(() => mapRef.current?.relayout(), 60)
    window.addEventListener('wheelmap:viewchange', onView)
    return () => window.removeEventListener('wheelmap:viewchange', onView)
  }, [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setSelectedId(null)
        setSelectedReportId(null)
        setPubSel(null)
        setLayerOpen(false)
        setSnapState((s) => (s === 2 ? 1 : s))
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const leaveProgress = () => {
    setProgressMode(false)
    setProgressOpen(false)
  }
  const closeSearch = () => {
    setSearchOpen(false)
    setSearchQ('')
    searchInput.current?.blur()
  }
  const openSearch = () => {
    if (searchOpen) return
    leaveProgress()
    setSearchOpen(true)
    if (routeOpen) {
      setRouteOpen(false)
      setRoutePick(null)
      setOverlay(null)
      setRouteLaunch(null)
    }
    setPanelOpen(false)
    setRewardsOpen(false)
  }
  const launchRoute = (l: { to?: Place; pair?: DemoPair }) => {
    closeSearch()
    setRoutePick(null)
    setRouteLaunch({ ...l, n: ++launchN.current })
    setRouteOpen(true)
  }
  const openReport = (id: string) => {
    setProgressOpen(false)
    setSelectedReportId(id)
    setSelectedId(null)
    setPanelOpen(false)
    setRewardsOpen(false)
    setFlowOpen(false)
    setPicking(false)
    setDraftPos(null)
    const r = useReports.getState().reports.find((x) => x.id === id)
    const k = kRef.current
    const map = mapRef.current
    if (r && k && map) map.setCenter(new k.maps.LatLng(r.lat, r.lng)) // 먼 곳은 panTo가 움직이지 않는 경우가 있어 setCenter를 쓴다
  }
  const openSeed = (id: string) => {
    setProgressOpen(false)
    setSelectedId(id)
    setSelectedReportId(null)
    setPanelOpen(false)
    setRewardsOpen(false)
  }
  const closeFlow = () => {
    setFlowOpen(false)
    setPicking(false)
    setDraftPos(null)
  }
  const onReset = async () => {
    if (!(await confirmSheet({ title: '시연 데이터를 모두 지울까요?', body: '시연 중에 만든 제보와 사진을 모두 지워요. 팀 조사 데이터는 그대로예요.', confirmLabel: '모두 지우기', danger: true }))) return
    closeFlow()
    setSelectedReportId(null)
    setPanelOpen(false)
    setRewardsOpen(false)
    const err = await resetAll()
    if (err) toast(err)
    else toast('시연 데이터를 모두 지웠어요.')
  }

  const pubStatus: Partial<Record<PubLayerId, 'loading' | 'error'>> = {}
  for (const l of PUB_LAYERS) if (layers[l.id] && !pubData[l.id]) pubStatus[l.id] = pubError[l.id] ? 'error' : 'loading'
  const pubNotes: string[] = []
  for (const l of PUB_LAYERS) {
    if (!layers[l.id]) continue
    if (pubStatus[l.id] === 'loading') pubNotes.push(`${l.label} 데이터를 불러오고 있어요…`)
    else if (pubStatus[l.id] === 'error') pubNotes.push(`${l.label} 데이터를 불러오지 못했어요.`)
    else {
      const g = pubVisible.find((x) => x.layer === l.id)
      if (g && view && view.level > PUB_MAX_LEVEL) pubNotes.push(`${l.label}: 지도를 확대하면 보여요`)
      else if (g && g.inView > PUB_MAX_DRAW) pubNotes.push(`${l.label}: 화면 안 ${g.inView}건 중 ${PUB_MAX_DRAW}건만 보여요. 더 확대해 주세요.`)
    }
  }

  const selected = selectedId ? (BY_ID.get(selectedId) ?? null) : null

  // 지금 지도에 보이는 곳의 장애요소 요약(아래 시트)
  const here = useMemo(() => {
    const rows: HomeRow[] = []
    const mockIds = new Set(reports.filter(isMockReport).map((r) => r.id))
    if (!view || !layers.team) return rows
    const [s, w, n, e] = view.b
    const inView = (lat: number, lng: number) => lat >= s && lat <= n && lng >= w && lng <= e
    for (const b of BARRIERS) {
      if (b.parentId || !b.geometry) continue
      const a = anchorOf(b.geometry)
      if (!inView(a[0], a[1])) continue
      rows.push({ key: b.id, kind: 'seed', id: b.id, title: shortName(b.id, b.name), sub: `${impactLine(impactOf(b), ratingKeyOf(b, seedOverride))} · ${b.type}`, rating: ratingKeyOf(b, seedOverride), impact: impactOf(b), cat: categoryOf(impactOf(b), ratingKeyOf(b, seedOverride)) })
    }
    for (const r of reports) {
      if (!SHOWN_ON_MAP.includes(r.status) || r.seedId || !inView(r.lat, r.lng)) continue
      rows.push({ key: r.id, kind: 'report', id: r.id, pos: { lat: r.lat, lng: r.lng, type: r.type, at: r.history[0]?.at ?? '' }, title: `시민 제보 · ${r.type}`, sub: r.verification.rating ? STATUS_LABEL[r.status] : '판정을 기다리고 있어요', rating: r.verification.rating ?? 'none', impact: impactOfReport(r.type, r.locationKind), cat: categoryOf(impactOfReport(r.type, r.locationKind), r.verification.rating ?? 'none') })
    }
    const order: Record<string, number> = { X: 0, TRIANGLE: 1, none: 2, O: 3 }
    return realFirst(rows.sort((a, b) => order[a.rating] - order[b.rating]), (row) => row.kind === 'report' && mockIds.has(row.id)) // 실제 제보가 모의·체험 제보보다 먼저
  }, [view, layers.team, reports, seedOverride])
  const hereCount = (c: Category) => here.filter((r) => r.cat === c).length
  // 핵심 3칸(어려운 곳·버스 불편·주의=지날 때 주의+주의 구역)에 이미 나온 분류는 펼침 목록에서 뺀다: 같은 숫자가 두 번 나오지 않게
  const restCats = CATEGORY_ORDER.filter((c) => c !== 'hard' && c !== 'boarding' && c !== 'caution' && c !== 'zone' && hereCount(c) > 0)
  // 상황 칩: 지금 켜진 레이어가 어떤 칩의 묶음과 같으면 그 칩이 골라진 것으로 보인다. 날씨가 비·눈이면 「비 오는 날」이 맨 앞.
  const weather = useWeather()
  const chip = chipOf(layers)
  const chips = useMemo(() => chipOrder(weather), [weather])
  const pickChip = (id: ChipId) => {
    setPubSel(null)
    setLayers((prev) => {
      const n = applyChip(id, prev)
      saveLayers(n)
      return n
    })
  }
  // 요약 한 줄의 숫자: 지도 가운데 기준으로 센다(화장실 거리는 내 위치를 알 때만)
  const chipSum = useMemo(() => {
    if (!chip || !view || !chips.includes(chip)) return null
    const c = { lat: (view.b[0] + view.b[2]) / 2, lng: (view.b[1] + view.b[3]) / 2 }
    const toilets = pubData.toilet?.items.filter(toiletAccessible)
    const counts: SummaryCounts = {
      bus: pubData.bus && countNear(pubData.bus.items, c, BUS_NEAR_M),
      toilet: toilets && countNear(toilets, c, NEAR_M),
      toiletM: toilets && myPos ? nearestM(toilets, myPos) : null,
      flood: pubData.flood && countNear(pubData.flood.items, c, NEAR_M),
      schoolZone: pubData.schoolZone && countNear(pubData.schoolZone.items, c, NEAR_M),
      shade: pubData.shade && countNear(pubData.shade.items, c, NEAR_M),
    }
    return chipSummary(chip, counts)
  }, [chip, chips, view, pubData, myPos])

  const overlayOpen = flowOpen || panelOpen || routeOpen || picking || !!routePick || progressMode
  const behind = !!(selectedId || selectedReportId || pubSel)
  const legendCount = (progressMode ? PROGRESS_ORDER.length : 9) + PUB_LAYERS.filter((l) => layers[l.id]).length

  // 내 위치: 버튼을 누르면 위치 추적(watchPosition)을 켜서 파란 점·정확도 원이 따라 움직인다. 위치는 저장하거나 보내지 않고 화면에만 쓴다.
  //  따라가기가 켜져 있으면 지도 중심이 내 위치를 따라가고, 사용자가 지도를 끌면 꺼진다. 탭을 떠나거나 화면이 숨겨지면 추적을 멈추고, 돌아오면 이어 간다.
  const clearMe = () => {
    cancelAnimationFrame(moveRaf.current)
    meRef.current?.setMap(null)
    meRef.current = null
    meElRef.current = null
    accRef.current?.setMap(null)
    accRef.current = null
    setMyPos(null)
  }
  // 나침반: 사용자가 버튼을 누른 같은 동작 안에서 시작한다(iOS는 DeviceOrientationEvent.requestPermission()을 사용자 동작 안에서 불러야 한다).
  // 거부하거나 지원하지 않으면 조용히 방향 표시 없이 동작한다. 방향은 화면에만 쓰고 저장하지 않는다.
  const applyHeading = () => {
    const el = meElRef.current
    const h = headingRef.current
    if (!el || h === null) return
    el.style.setProperty('--hd', `${h.toFixed(1)}deg`)
    el.classList.add('hm-me-dir')
  }
  const startCompass = () => {
    if (compassRef.current || typeof DeviceOrientationEvent === 'undefined') return
    let last = 0
    const listen = (name: 'deviceorientation' | 'deviceorientationabsolute') => {
      const on = (e: Event) => {
        const now = performance.now()
        if (now - last < 80) return
        last = now
        const ev = e as DeviceOrientationEvent & { webkitCompassHeading?: number }
        if (name === 'deviceorientation' && typeof ev.webkitCompassHeading !== 'number') return // 상대 방향은 쓰지 않는다
        const h = compassHeading({ alpha: ev.alpha, beta: ev.beta, gamma: ev.gamma, webkitCompassHeading: ev.webkitCompassHeading })
        if (h === null) return
        headingRef.current = smoothHeading(headingRef.current, h)
        applyHeading()
      }
      window.addEventListener(name, on, true)
      compassRef.current = () => window.removeEventListener(name, on, true)
    }
    const req = (DeviceOrientationEvent as unknown as { requestPermission?: (absolute?: boolean) => Promise<'granted' | 'denied'> }).requestPermission
    // Chrome 계열은 deviceorientationabsolute(북 기준 절대 방향), iOS Safari는 deviceorientation + webkitCompassHeading를 쓴다.
    // 상대 방향(alpha가 임의 기준)만 오는 환경은 방향을 틀리게 보일 수 있어 쓰지 않는다.
    const name = 'ondeviceorientationabsolute' in window ? 'deviceorientationabsolute' : 'deviceorientation'
    if (typeof req === 'function') {
      req
        .call(DeviceOrientationEvent, name === 'deviceorientationabsolute')
        .then((v) => v === 'granted' && listen(name))
        .catch(() => {})
    } else listen(name)
  }
  const stopCompass = () => {
    compassRef.current?.()
    compassRef.current = null
    headingRef.current = null
  }
  // 내 위치 점을 이전 위치에서 부드럽게 옮긴다(움직임 줄이기면 바로 옮김)
  const moveMe = (to: kakao.maps.LatLng, acc: number) => {
    const k = kRef.current
    if (!k || !meRef.current) return
    const from = meRef.current.getPosition()
    const a: [number, number] = [from.getLat(), from.getLng()]
    const b: [number, number] = [to.getLat(), to.getLng()]
    cancelAnimationFrame(moveRaf.current)
    const set = (p: [number, number]) => {
      const ll = new k.maps.LatLng(p[0], p[1])
      meRef.current?.setPosition(ll)
      accRef.current?.setPosition(ll)
    }
    accRef.current?.setRadius(acc)
    const dist = Math.hypot((b[0] - a[0]) * 111320, (b[1] - a[1]) * 91000)
    if (prefersCalm() || dist < 0.5 || dist > 200) return set(b)
    const t0 = performance.now()
    const tick = (now: number) => {
      const t = Math.min(1, (now - t0) / 700)
      set(lerpLatLng(a, b, easeOut(t)))
      if (t < 1) moveRaf.current = requestAnimationFrame(tick)
    }
    moveRaf.current = requestAnimationFrame(tick)
  }
  // 내 위치를 보이는 영역(아래 시트·안내 카드와 위 검색줄을 뺀 부분)의 가운데로 부드럽게 보낸다
  const centerOnMe = (at: kakao.maps.LatLng) => {
    const map = mapRef.current
    const el = container.current
    if (!map || !el) return
    const pt = map.getProjection().containerPointFromCoords(at)
    const d = centerDelta(pt, { w: el.clientWidth, h: el.clientHeight, top: topCoverOf(el), bottom: coverOf(el) })
    if (Math.abs(d.dx) < CENTER_DEADBAND_PX && Math.abs(d.dy) < CENTER_DEADBAND_PX) return
    map.panBy(d.dx, d.dy)
  }
  const haltWatch = () => {
    if (watchRef.current !== null) {
      navigator.geolocation.clearWatch(watchRef.current)
      watchRef.current = null
    }
    clearMe()
  }
  const setFollow = (on: boolean) => {
    followRef.current = on
    setLocMode(wantLocRef.current ? (on ? 'follow' : 'free') : 'off')
  }
  const beginWatch = () => {
    if (watchRef.current !== null || !('geolocation' in navigator)) return
    watchRef.current = navigator.geolocation.watchPosition(
      (pos) => {
        const k = kRef.current
        const map = mapRef.current
        if (!k || !map) return
        const at = new k.maps.LatLng(pos.coords.latitude, pos.coords.longitude)
        lastPosRef.current = at
        const acc = Math.max(5, Math.min(pos.coords.accuracy || 0, 1000))
        if (!meRef.current) {
          const el = document.createElement('div')
          el.className = 'hm-me'
          meRef.current = new k.maps.CustomOverlay({ position: at, content: el, map, xAnchor: 0.5, yAnchor: 0.5, zIndex: NAV_Z.me })
          const cone = document.createElement('i')
          cone.className = 'hm-me-cone'
          el.appendChild(cone)
          meElRef.current = el
          applyHeading()
        }
        if (!accRef.current) {
          accRef.current = new k.maps.Circle({ map, center: at, radius: acc, strokeWeight: 1, strokeColor: '#2272eb', strokeOpacity: 0.35, fillColor: '#2272eb', fillOpacity: 0.12, zIndex: 1 })
        } else moveMe(at, acc)
        setMyPos({ lat: pos.coords.latitude, lng: pos.coords.longitude })
        if (followRef.current) {
          if (firstFixRef.current) {
            map.setLevel(3)
            map.setCenter(at)
          }
          centerOnMe(at)
        }
        firstFixRef.current = false
        setLocMsg(followRef.current ? `내 위치를 따라가고 있어요 (오차 약 ${Math.round(acc / 10) * 10}m)` : `내 위치예요 (오차 약 ${Math.round(acc / 10) * 10}m)`)
      },
      (err) => {
        if (err.code === 1) {
          wantLocRef.current = false
          haltWatch()
          setFollow(false)
          setLocMsg('위치를 가져오지 못했어요. 브라우저에서 위치를 허용해 주세요.')
        } else setLocMsg('내 위치를 찾고 있어요…')
      },
      { enableHighAccuracy: true, maximumAge: 3000, timeout: 20000 },
    )
  }
  const stopLocate = () => {
    wantLocRef.current = false
    haltWatch()
    stopCompass()
    setFollow(false)
    setLocMsg('')
  }
  const locateMe = () => {
    const map = mapRef.current
    if (!kRef.current || !map) return
    if (!('geolocation' in navigator)) {
      setLocMsg('이 기기에서는 현재 위치를 쓸 수 없어요.')
      return
    }
    startCompass() // 누른 동작 안에서 시작(iOS 권한 요청 조건)
    if (wantLocRef.current && followRef.current) {
      // 따라가는 중에 다시 누르면 끈다
      stopLocate()
      return
    }
    if (wantLocRef.current) {
      // 따라가기가 꺼져 있었다면 내 위치로 돌아와 다시 따라간다
      setFollow(true)
      if (lastPosRef.current) centerOnMe(lastPosRef.current)
      return
    }
    wantLocRef.current = true
    firstFixRef.current = true
    setFollow(true)
    setLocMsg('내 위치를 찾고 있어요…')
    beginWatch()
  }
  followOffRef.current = () => {
    if (!wantLocRef.current || !followRef.current) return
    setFollow(false)
    setLocMsg('지도를 움직여서 따라가기를 껐어요.')
  }
  // 동행지도 탭을 떠나거나 화면이 숨겨지면 추적을 멈추고, 다시 보이면 이어 간다
  useEffect(() => {
    if (!ready) return
    const sync = () => {
      if (document.hidden || !active) haltWatch()
      else if (wantLocRef.current) beginWatch()
    }
    document.addEventListener('visibilitychange', sync)
    sync()
    return () => {
      document.removeEventListener('visibilitychange', sync)
      haltWatch()
      stopCompass()
    }
    // haltWatch·beginWatch는 ref만 쓰므로 탭·준비 상태가 바뀔 때만 다시 건다
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, ready])

  // 아래 시트 단계별로 보이는 높이를 내용의 실제 높이에 맞춘다(글자가 커지거나 줄이 바뀌어도 버튼이 잘리지 않게)
  useEffect(() => {
    const sheet = sheetRef.current
    const cta = sheet?.querySelector<HTMLElement>('.hm-grip')
    const mid = sheet?.querySelector<HTMLElement>('.hm-s-mid')
    if (!sheet || !cta || !mid) return
    const apply = () => {
      const pb = parseFloat(getComputedStyle(sheet).paddingBottom) || 0
      sheet.style.setProperty('--vis-min', `${Math.ceil(cta.offsetTop + cta.offsetHeight + pb)}px`)
      sheet.style.setProperty('--vis-mid', `${Math.ceil(mid.offsetTop + mid.offsetHeight + pb)}px`)
    }
    apply()
    const ro = new ResizeObserver(apply)
    ro.observe(sheet)
    ro.observe(cta)
    ro.observe(mid)
    return () => ro.disconnect()
  }, [overlayOpen])
  const { gripProps } = useSheetSnap(sheetRef, snap, setSnap, overlayOpen, revealSelected)
  // 보이지 않는 단계의 버튼은 키보드로 닿지 않게 한다
  useEffect(() => {
    const sheet = sheetRef.current
    if (!sheet) return
    const apply = () => {
      const sheetLike = getComputedStyle(sheet).transform !== 'none' // 큰 화면의 왼쪽 패널은 모두 보인다
      sheet.querySelector('.hm-s-mid')?.toggleAttribute('inert', sheetLike && snap === 0)
      sheet.querySelector('.hm-more')?.toggleAttribute('inert', sheetLike && snap !== 2)
    }
    apply()
    window.addEventListener('resize', apply)
    window.addEventListener('wheelmap:viewchange', apply)
    return () => {
      window.removeEventListener('resize', apply)
      window.removeEventListener('wheelmap:viewchange', apply)
    }
  }, [snap, overlayOpen])

  useEffect(() => {
    openReportRef.current = openReport
    openSeedRef.current = openSeed
  })
  const pickProgress = (it: ProgressItem) => {
    if (it.kind === 'report') openReport(it.id)
    else openSeed(it.id)
    const k = kRef.current
    const map = mapRef.current
    if (k && map) map.setCenter(new k.maps.LatLng(it.lat, it.lng))
  }
  const pickRow = (r: HomeRow) => (r.kind === 'seed' ? openSeed(r.id) : openReport(r.id))

  return (
    <div className="bm">
      <div className={'bm-main' + (glOn ? ' bm-gl' : '')}>
        <div ref={container} className="map" role="application" aria-label="이의있음!" />
        {glOn && overlay?.guide && (
          <Suspense fallback={null}>
            <GuideGlMap
              path={glPath}
              guide={overlay.guide}
              me={myPos}
              headingRef={headingRef}
              getInsets={() => ({ top: topCoverOf(container.current), bottom: coverOf(container.current), left: isDesktopLayout() ? 460 : 0 })}
              onFail={() => setGlFailed(true)}
            />
          </Suspense>
        )}
        {state.status === 'loading' && <p className="map-notice">지도를 불러오고 있어요…</p>}
        {state.status === 'error' && (
          <p className="map-notice map-notice-error" role="alert">
            {state.message}
          </p>
        )}

        <div className="hm-panel">
        <header className={'hm-top' + (routeOpen || behind ? ' hm-top--route' : '') + (searchOpen ? ' hm-top--search' : '') + (progressMode ? '' : ' hm-top--chips')}>
          <div className="hm-card">
            <div className="hm-bar hm-bar--desk">
              <h1 className="hm-brand">
                <button type="button" className="hm-brand-btn" aria-label="이의있음 홈으로" onClick={() => { location.hash = '#/' }}>
                  <Wordmark decorative />
                </button>
              </h1>
            </div>
            <div className="hm-searchrow">
              <div className={'hm-search' + (searchOpen ? ' on' : '')}>
                <input
                  ref={searchInput}
                  type="search"
                  className="hm-search-input"
                  value={searchQ}
                  placeholder="어디로 가세요?"
                  aria-label="장소 검색"
                  aria-controls="map-search-results"
                  aria-expanded={searchOpen}
                  enterKeyHint="search"
                  autoComplete="off"
                  autoCorrect="off"
                  onFocus={openSearch}
                  onChange={(e) => setSearchQ(e.target.value)}
                  onKeyDown={(e) => e.key === 'Escape' && closeSearch()}
                />
                {searchOpen && (
                  <button type="button" className="hm-search-x" aria-label="검색 닫기" onClick={closeSearch}>
                    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
                      <path d="m4 4 10 10M14 4 4 14" />
                    </svg>
                  </button>
                )}
              </div>
              <button type="button" className="hm-iconbtn" onClick={() => setLayerOpen((v) => !v)} aria-expanded={layerOpen} aria-label="지도에 보여 줄 것 직접 고르기" title="직접 고르기">
                <svg width="22" height="22" viewBox="0 0 22 22" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M11 3 2.5 7.5 11 12l8.5-4.5L11 3Z" />
                  <path d="m2.5 11.5 8.5 4.5 8.5-4.5M2.5 15.5 11 20l8.5-4.5" />
                </svg>
              </button>
            </div>
          </div>
          {searchOpen && <PlaceSearchPanel k={kObj} query={searchQ} onPlace={(p) => launchRoute({ to: p })} onPair={(p) => launchRoute({ pair: p })} />}
          {!progressMode && <SituationChips order={chips} selected={chip} onPick={pickChip} summary={chipSum} />}
          <div className="hm-chips">
            <MockStrip onMap />
          </div>
          <button type="button" className="hm-legend-toggle" aria-expanded={legendOpen} aria-label={legendOpen ? '범례 접기' : '범례 보기'} title="범례" onClick={() => setLegendOpen((v) => !v)}>
            <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <circle cx="10" cy="10" r="7.5" />
              <path d="M10 9v4.5M10 6.4v.1" />
            </svg>
          </button>
          <ul className={'hm-legend' + (legendOpen ? '' : ' hm-legend--shut')} style={colsStyle(legendCount, 3, 2)} aria-label={progressMode ? '범례: 색과 글자는 개선 진행 단계' : '범례: 색과 ○△X는 정도, 길·승·입·◆는 영향 종류'}>
            {progressMode &&
              PROGRESS_ORDER.map((s) => (
                <li key={s}>
                  <i className={'hm-leg-pg pg-' + s}>{PROGRESS_INFO[s].glyph}</i>
                  {PROGRESS_INFO[s].label}
                </li>
              ))}
            {!progressMode && (['O', 'TRIANGLE', 'X', 'none'] as const).map((r) => (
              <li key={r}>
                <i style={{ background: RATING_STYLE[r].color, color: RATING_STYLE[r].ink }}>{RATING_STYLE[r].glyph}</i>
                {r === 'none' ? RATING_STYLE[r].label : RATING_STYLE[r].label.slice(2)}
              </li>
            ))}
            {!progressMode && (['passage', 'boarding', 'entry', 'zone'] as const).map((k) => (
              <li key={k}>
                <i className="hm-leg-kind">{IMPACT_INFO[k].glyph}</i>
                {IMPACT_INFO[k].label}
              </li>
            ))}
            {PUB_LAYERS.filter((l) => layers[l.id]).map((l) => (
              <li key={l.id}>
                <i className="hm-leg-pub" style={{ background: l.color }}>
                  <Icon name={l.icon} size={14} />
                </i>
                {l.label} (참고)
              </li>
            ))}
          </ul>
          {progressMode && !progressOpen && (
            <div className="hm-focus" role="status">
              <span>개선 현황을 보고 있어요.</span>
              <button type="button" className="hm-focus-btn" onClick={() => setProgressOpen(true)}>
                목록
              </button>
              <button type="button" className="hm-focus-btn" onClick={leaveProgress}>
                끝내기
              </button>
            </div>
          )}
          {focusIds.length > 0 && (
            <div className="hm-focus" role="status">
              <span>경로 지점 {focusIds.length}곳을 노란 테두리로 보여 드려요.</span>
              <button type="button" className="hm-focus-btn" onClick={() => setFocusIds([])}>
                끄기
              </button>
            </div>
          )}
        </header>
        {!overlayOpen && (
          <section ref={sheetRef} className={'hm-sheet' + (behind ? ' is-behind' : '')} data-sheet data-snap={snap} aria-label="이 지역 요약">
            <div className="hm-grip" {...gripProps}>
              <button type="button" className="hm-grip-btn" data-grip aria-expanded={snap > 0} aria-label={SNAP_BTN[snap].label} title={SNAP_BTN[snap].label}>
                <span className="hm-grip-bar" aria-hidden="true" />
              </button>
              <div className="hm-s-head">
                <h2 className="hm-title">
                  {!view ? '지도를 불러오고 있어요' : here.length > 0 ? `장애요소 ${here.length}곳` : '여기에는 등록된 장애요소가 없어요'}
                </h2>
              </div>
            </div>
            <button
              type="button"
              className={'hm-locate' + (locMode === 'follow' ? ' on' : locMode === 'free' ? ' free' : '')}
              onClick={locateMe}
              aria-pressed={locMode !== 'off'}
              aria-label={locMode === 'follow' ? '내 위치 따라가기 끄기' : locMode === 'free' ? '내 위치로 돌아가 따라가기' : '내 위치로 이동'}
            >
              내 위치
            </button>
            <div className="hm-s-mid">
              {locMsg && (
                <Sentences as="p" className="hm-eyebrow" role="status">
                  {locMsg}
                </Sentences>
              )}
            </div>
            <div className="hm-more">
              {here.length > 0 && restCats.length > 0 && (
                <>
                  <ul className="hm-counts" aria-label="종류별 개수">
                    {restCats.map((c) => (
                      <li key={c} className="hm-count">
                        <i className={'hm-cat hm-cat-' + c}>{CATEGORY_INFO[c].glyph}</i>
                        {CATEGORY_INFO[c].label} {hereCount(c)}
                      </li>
                    ))}
                  </ul>
                </>
              )}
              {pubNotes.map((t) => (
                <p key={t} className="hm-note" role="status">
                  {t}
                </p>
              ))}
              <h3>이 지역 장애요소</h3>
              {here.length === 0 ? (
                <p className="lr-empty">지도를 움직이거나 확대해 보세요.</p>
              ) : (
                <ul className="lr-list">
                  {here.slice(0, 40).map((r) => (
                    <HomeListRow key={r.key} r={r} onPick={pickRow} />
                  ))}
                </ul>
              )}
              {PROVISIONAL.length > 0 && (
                <>
                  <h3 style={{ marginTop: 20 }}>위치 확인 중인 곳 {PROVISIONAL.length}곳</h3>
                  <ul className="lr-list">
                    {PROVISIONAL.map((b) => (
                      <li key={b.id}>
                        <button type="button" className="lr" onClick={() => openSeed(b.id)}>
                          <i className="lr-glyph" style={{ background: ratingOf(b, seedOverride).color, color: ratingOf(b, seedOverride).ink }}>
                            {ratingOf(b, seedOverride).glyph}
                          </i>
                          <span className="lr-main">
                            <span className="lr-title">{listTitle(shortName(b.id, b.name))}</span>
                          </span>
                          <span className="lr-chev" aria-hidden="true" />
                        </button>
                      </li>
                    ))}
                  </ul>
                </>
              )}
              {UNPLACED.length > 0 && (
                <>
                  <h3 style={{ marginTop: 20 }}>지도에 아직 없는 곳 {UNPLACED.length}곳</h3>
                  <ul className="lr-list">
                    {UNPLACED.map((b) => (
                      <li key={b.id}>
                        <button type="button" className="lr" onClick={() => openSeed(b.id)}>
                          <i className="lr-glyph" style={{ background: ratingOf(b, seedOverride).color, color: ratingOf(b, seedOverride).ink }}>
                            {ratingOf(b, seedOverride).glyph}
                          </i>
                          <span className="lr-main">
                            <span className="lr-title">
                              {listTitle(shortName(b.id, b.name))}
                            </span>
                          </span>
                          <span className="lr-chev" aria-hidden="true" />
                        </button>
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </div>
          </section>
        )}
        </div>

        {layerOpen && (
          <LayerPanel
            layers={layers}
            loading={pubStatus}
            onChange={(patch) => {
              // 연속으로 눌러도 이전 선택이 덮어써지지 않게 직전 상태 기준으로 합친다
              setLayers((prev) => {
                const n = { ...prev, ...patch }
                saveLayers(n)
                return n
              })
            }}
            onClose={() => setLayerOpen(false)}
            filter={filter}
            onFilter={setFilter}
            extra={
              <>
                <h3>화면·발표 도구</h3>
                <div className="hm-tools">
                  <ViewSettings />
                  <DemoTools page="map" onReset={onReset} barriers={BARRIERS} />
                </div>
              </>
            }
          />
        )}
        {pubSel && pubData[pubSel.layer] && (
          <PubCard layer={pubSel.layer} item={pubSel.item} dataset={pubData[pubSel.layer] as PubDataset} onClose={() => setPubSel(null)} />
        )}


        {picking && <CenterPin lifted={pinLifted} landed={pinLanded} />}
        {picking && (
          <div className="rf-pick" role="status">
            <Sentences as="span">지도를 끌어 핀을 맞추거나, 눌러서 정해 주세요.</Sentences>
            <button
              type="button"
              onClick={() => {
                setDraftPos(pickBackup.current)
                setPicking(false)
              }}
            >
              취소
            </button>
            <button type="button" className="rf-primary" disabled={!draftPos} onClick={() => setPicking(false)}>
              이 위치로 정하기
            </button>
          </div>
        )}

        {flowOpen && (
          <ReportFlow
            location={draftPos}
            onLocation={setDraftPos}
            onPickStart={() => {
              pickBackup.current = draftPos
              setPicking(true)
            }}
            hidden={picking}
            seeds={BARRIERS}
            onClose={closeFlow}
            onOpenReport={openReport}
            initialType={start.type}
            skipType={start.skipType}
          />
        )}

        {/* 새 지도(MapLibre)는 왼쪽 아래에 자체 출처(OpenStreetMap 포함)를 표시하므로 겹치지 않게 숨긴다 */}
        {routeOpen && overlay?.osm && !glOn && (
          <a className="rt-osm-corner" href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">
            길 자료 © OpenStreetMap contributors
          </a>
        )}

        {routeOpen && (
          <RoutePanel
            key={routeLaunch?.n ?? 0}
            startTo={routeLaunch?.to ?? null}
            startPair={routeLaunch?.pair ?? null}
            onLocate={locateMe}
            onStopLocate={stopLocate}
            myPos={myPos}
            locMode={locMode}
            initialMode={start.mode}
            presetFrom={start.from}
            presetTo={start.to}
            k={kObj}
            barriers={BARRIERS}
            seedRatings={seedOverride}
            reports={reports}
            picked={routePicked}
            picking={routePick}
            onPickRequest={setRoutePick}
            onOverlay={setOverlay}
            onOpenSeed={openSeed}
            onOpenReport={openReport}
            onClose={() => {
              setRouteOpen(false)
              setRoutePick(null)
              setOverlay(null)
              setRouteLaunch(null)
            }}
          />
        )}

        {routePick && (
          <div className="rf-pick" role="status">
            <Sentences as="span">{`${routePick === 'from' ? '출발' : '도착'} 위치를 지도에서 눌러 주세요. 핀을 눌러도 돼요.`}</Sentences>
            <button type="button" onClick={() => setRoutePick(null)}>
              닫기
            </button>
          </div>
        )}

        {progressOpen && (
          <ProgressPanel
            items={progress.items}
            summary={progress.summary}
            period={period}
            onPeriod={setPeriod}
            stages={pgStages}
            onToggleStage={(st) => setPgStages((cur) => (cur.includes(st) ? cur.filter((x) => x !== st) : [...cur, st]))}
            onPick={pickProgress}
            onShowMap={() => setProgressOpen(false)}
            onExit={leaveProgress}
          />
        )}
        {panelOpen && <ReportsPanel onOpen={openReport} onClose={() => setPanelOpen(false)} />}
        {rewardsOpen && (
          <MyRewards
            barriers={BARRIERS}
            onOpenReports={() => {
              setRewardsOpen(false)
              setPanelOpen(true)
            }}
            onOpenReport={openReport}
            onClose={() => setRewardsOpen(false)}
          />
        )}

        {selectedReportId && (
          <ReportDetail
            key={selectedReportId}
            reportId={selectedReportId}
            seeds={BARRIERS}
            seedName={(id) => BY_ID.get(id)?.name ?? null}
            onClose={() => setSelectedReportId(null)}
            onOpenReport={openReport}
            onOpenSeed={openSeed}
          />
        )}

        {selected && (
          <BarrierDetail
            key={selected.id}
            barrier={selected}
            parent={selected.parentId ? (BY_ID.get(selected.parentId) ?? null) : null}
            subItems={BARRIERS.filter((c) => c.parentId === selected.id)}
            onSelect={setSelectedId}
            onClose={() => setSelectedId(null)}
            mergedReports={reports.filter((r) => r.status === 'merged' && r.barrierId === selected.id)}
            onOpenReport={openReport}
            flowReport={reports.find((r) => r.seedId === selected.id)}
            overrideRating={seedOverride.has(selected.id) ? (seedOverride.get(selected.id) ?? null) : undefined}
            onStartFlow={(type, kind) => {
              const rating = selected.rating ?? (selected.parentId ? BY_ID.get(selected.parentId)?.rating : undefined)
              const nr = startSeedFlow(selected, type, kind, rating)
              openReport(nr.id)
            }}
          />
        )}
      </div>
    </div>
  )
}
