import { useEffect, useMemo, useRef, useState } from 'react'
import { CENTER_ADDRESS_CANDIDATES, geocode, loadKakao } from '../lib/kakao'
import { loadBarriers } from '../lib/seed'
import { confirmSheet, toast } from '../lib/uiStore'
import type { Barrier, Geometry, LatLng, Rating } from '../types'
import { RATING_STYLE } from '../lib/rating'
import { CATEGORY_INFO, CATEGORY_ORDER, IMPACT_INFO, categoryOf, styleOf, impactLine, impactOf, obstacleName, shortName, type Category, type ImpactKey } from '../lib/display'
import { impactOfReport } from '../lib/routing/impact.ts'
import BarrierDetail from './BarrierDetail'
import ReportDetail from '../components/ReportDetail'
import ViewSettings from '../components/ViewSettings'
import { isDesktopLayout } from '../lib/viewPrefs'
import DemoTools, { MockStrip } from '../components/DemoTools'
import { useSheetSnap, type Snap } from '../components/useSheetSnap'
import { DEFAULT_FILTER, showCitizen, type MapFilter } from '../lib/mapFilter'
import ReportFlow, { type Loc } from '../components/ReportFlow'
import ReportsPanel from '../components/ReportsPanel'
import MyRewards from '../components/MyRewards'
import LayerPanel from '../components/LayerPanel'
import PubCard from '../components/PubCard'
import RoutePanel from '../components/RoutePanel'
import { ROLE_STYLE } from '../lib/routing/roleStyle.ts'
import type { RouteOverlay } from '../lib/routing/overlay.ts'
import type { Place } from '../lib/routing/provider.ts'
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
  toiletAccessible,
  type LayerState,
  type PubDataset,
  type PubItem,
  type PubLayerId,
} from '../lib/publicLayers'

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
type HomeRow = { key: string; kind: 'seed' | 'report'; id: string; title: string; sub: string; rating: Rating | 'none'; cat: Category; impact: ImpactKey }

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
const DOT_PX = 30
const PIN_H = 30

const SHOWN_ON_MAP: ReportStatus[] = ['verified', 'filed', 'assigned', 'in_progress', 'resolved', 'rechecked']

// 아래 시트 단계(0 최소 · 1 기본 · 2 펼침). 처음엔 지도가 가장 잘 보이는 최소로 시작하고, 사용자가 고른 단계(최소·기본)는 기억한다.
const SNAP_KEY = 'wheelmap.sheetSnap'
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
const SNAP_BTN: Record<Snap, { label: string; next: Snap; up: boolean }> = {
  0: { label: '요약 보기', next: 1, up: true },
  1: { label: '제보 목록 보기', next: 2, up: true },
  2: { label: '지도 넓게 보기', next: 0, up: false },
}

export default function BarrierMap({ intent = '', active = true }: { intent?: string; active?: boolean }) {
  const [start] = useState(() => {
    const q = new URLSearchParams(intent)
    const rid = q.get('report')
    return { go: q.get('go'), mode: q.get('mode') === 'bus' ? ('bus' as const) : ('walk' as const), report: rid ? (useReports.getState().reports.find((r) => r.id === rid) ?? null) : null }
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
  const [panelOpen, setPanelOpen] = useState(start.go === 'reports')
  const [rewardsOpen, setRewardsOpen] = useState(start.go === 'rewards')
  const [progressOpen, setProgressOpen] = useState(start.go === 'progress') // 개선 현황 목록 패널
  const [progressMode, setProgressMode] = useState(start.go === 'progress') // 개선 현황 보기(마커·범례가 바뀜)
  const [period, setPeriod] = useState<PeriodId>('90')
  const [pgStages, setPgStages] = useState<ProgressStage[]>(PROGRESS_ORDER)
  const [focusIds, setFocusIds] = useState<string[]>([])
  const [layers, setLayers] = useState<LayerState>(loadLayers)
  const [layerOpen, setLayerOpen] = useState(false)
  const [pubData, setPubData] = useState<Partial<Record<PubLayerId, PubDataset>>>({})
  const [pubError, setPubError] = useState<Partial<Record<PubLayerId, boolean>>>({})
  const requested = useRef(new Set<PubLayerId>())
  const [view, setView] = useState<{ level: number; b: [number, number, number, number] } | null>(null)
  const [pubSel, setPubSel] = useState<{ layer: PubLayerId; item: PubItem } | null>(null)
  const [kObj, setKObj] = useState<typeof kakao | null>(null)
  const [routeOpen, setRouteOpen] = useState(start.go === 'route')
  const [locMsg, setLocMsg] = useState('')
  const meRef = useRef<kakao.maps.CustomOverlay | null>(null)
  const sheetRef = useRef<HTMLElement>(null)
  const [routePick, setRoutePick] = useState<'from' | 'to' | null>(null)
  const [routePicked, setRoutePicked] = useState<{ which: 'from' | 'to'; place: Place; n: number } | null>(null)
  const [overlay, setOverlay] = useState<RouteOverlay | null>(null)
  const routePickRef = useRef<'from' | 'to' | null>(null)
  const pickN = useRef(0)
  const lastFit = useRef(0)
  const pickingRef = useRef(false)
  const keepRef = useRef<{ lat: number; lng: number; level: number } | null>(null)
  useEffect(() => {
    pickingRef.current = picking
  }, [picking])
  useEffect(() => {
    routePickRef.current = routePick
  }, [routePick])
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
        if (cancelled || !container.current) return
        if (!center) throw new Error('지도 중심 주소를 찾지 못했어요. 카카오 앱의 지도·로컬 사용 설정을 확인해 주세요.')
        const map = new k.maps.Map(container.current, { center, level: 4 })
        if (located.length > 0 && !start.report) {
          const bounds = new k.maps.LatLngBounds()
          for (const b of located) {
            const g = b.geometry as Geometry
            const pts = g.kind === 'point' ? [g.at] : g.path
            pts.forEach((p) => bounds.extend(new k.maps.LatLng(p[0], p[1])))
          }
          setTimeout(() => {
            map.relayout()
            const d = isDesktopLayout()
            map.setBounds(bounds, d ? 60 : 80, d ? 60 : 40, d ? 60 : 40, d ? 460 : 40)
          }, 150)
        }
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
          setView({ level: map.getLevel(), b: [sw.getLat(), sw.getLng(), ne.getLat(), ne.getLng()] })
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
            const d = isDesktopLayout()
            map.setBounds(fb, d ? 60 : 90, d ? 60 : 40, d ? 60 : 40, d ? 460 : 40)
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
  const mapLevel = view?.level ?? 4

  // 점·선·영역을 ○△X 색으로 그린다. 글자(○△X)도 같이 표시해 색만으로 구분하지 않게 한다.
  // 핀은 줌 단계에 따라 점 → 점+종류 → 이름까지 보여 주고, 화면에서 겹치는 핀은 숫자 묶음으로 합친다.
  useEffect(() => {
    const k = kRef.current
    const map = mapRef.current
    if (!ready || !k || !map) return
    const shapes: { setMap(m: kakao.maps.Map | null): void }[] = []
    const items: PinItem[] = []
    const dimOf = (id: string) => !!routeIds && !routeIds.has(id)
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
          title: `${shortName(b.id, b.name)} · 위치 임시`,
          small: false,
          sel: b.id === selectedId,
          dim: !!routeIds,
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
        dim: !!routeIds,
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

    const level = map.getLevel()
    const proj = (map as unknown as { getProjection(): { containerPointFromCoords(c: kakao.maps.LatLng): { x: number; y: number } } }).getProjection()
    const px = items.map((it) => proj.containerPointFromCoords(new k.maps.LatLng(it.lat, it.lng)))
    const prio = (it: PinItem) => (it.sel ? 100 : 0) + (it.small ? 0 : 5) + (it.pg ? ({ overdue: 3, agency: 2, intake: 2, done: 1, rechecked: 1, plan: 1 } as Record<string, number>)[it.pg.stage] : ({ X: 3, TRIANGLE: 2, none: 1, O: 0 } as Record<string, number>)[it.rating])

    // 1) 점끼리 가까우면 묶음으로(선택한 핀은 묶지 않는다). 멀리서 볼수록 더 크게 묶고, 시민 제보는 팀 조사 지점과 따로 더 크게 묶는다.
    //    묶음 원은 건수에 따라 크기가 달라지고, 서로 겹치면 하나로 합쳐 숫자 원끼리 겹치지 않게 한다.
    const baseR = level >= 6 ? 64 : level === 5 ? 54 : level === 4 ? 44 : level === 3 ? 34 : 26
    const cnt = (m: number[]) => m.reduce((s, i) => s + (items[i].count ?? 1), 0)
    const diaOf = (n: number) => Math.min(52, Math.round(28 + 7 * Math.log2(n)))
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
    const clusters = [...teamG.cls.map((c) => ({ m: c.m, x: c.x, y: c.y, cit: false })), ...citG.cls.map((c) => ({ m: c.m, x: c.x, y: c.y, cit: true }))]
    // 팀 조사 지점 위에 겹치는 시민 제보 점·묶음은 그리지 않는다(팀 조사 지점이 항상 먼저 보이게)
    const teamBoxes = [
      ...teamG.cls.map((c) => ({ x: c.x, y: c.y, r: diaOf(cnt(c.m)) / 2 })),
      ...teamG.singles.map((i) => ({ x: px[i].x, y: px[i].y, r: 15 })),
    ]
    const underTeam = (x: number, y: number, r: number) => teamBoxes.some((b) => Math.hypot(b.x - x, b.y - y) < b.r + r + 1)
    for (let n = clusters.length - 1; n >= 0; n--) if (clusters[n].cit && underTeam(clusters[n].x, clusters[n].y, diaOf(cnt(clusters[n].m)) / 2)) clusters.splice(n, 1)
    const singles = [...teamG.singles, ...citG.singles.filter((i) => items[i].sel || !underTeam(px[i].x, px[i].y, 7))]

    // 2) 남은 핀은 줌 단계가 허용하는 가장 풍부한 모양으로, 다른 글자와 겹치면 한 단계씩 줄인다. 시민 제보는 멀리서는 작은 색 점으로만 그린다.
    const allowed: PinMode[] = level >= 5 ? ['dot'] : level === 4 ? ['chip', 'dot'] : ['full', 'chip', 'dot']
    const placed: { x: number; y: number; w: number }[] = []
    const hit = (x: number, y: number, w: number) => placed.some((p) => Math.abs(p.x - x) < (p.w + w) / 2 + 3 && Math.abs(p.y - y) < PIN_H + 3)
    const widthOf = (it: PinItem, m: PinMode) => (m === 'lite' ? 14 : m === 'dot' ? DOT_PX : it.pg ? 38 + it.pg.label.length * 12.5 : m === 'chip' ? 58 : 30 + 29 + it.name.length * 13.5 + 12)
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
        pe.className = `bm-pin bm-pin--${mode} bm-pin-pg pg-${it.pg.stage}` + (it.sel ? ' bm-pin-sel' : '')
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
      el.className = `bm-pin bm-pin--${mode}` + (it.small ? ' bm-pin-small' : '') + (it.sel ? ' bm-pin-sel' : '') + (it.route ? ' bm-pin-route' : '') + (it.citizen ? ' bm-pin-citizen' : '') + (it.expired ? ' bm-pin-expired' : '') + (it.prov ? ' bm-pin-prov' : '') + (it.dim ? ' bm-pin-dim' : '')
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
      if (it.prov) {
        const t = document.createElement('span')
        t.className = 'bm-pin-t'
        t.textContent = '임시'
        el.appendChild(t)
      }
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
      el.className = 'bm-cluster' + (cl.cit ? ' bm-cluster--cit' : '') + (ms.every((m) => m.dim) ? ' bm-pin-dim' : '')
      const d = diaOf(total)
      el.style.width = el.style.height = `${d}px`
      el.style.fontSize = total >= 100 ? '0.8125rem' : '0.875rem'
      el.textContent = String(total)
      el.title = `${total}건이 모여 있어요. 누르면 확대해요.`
      el.setAttribute('role', 'button')
      el.tabIndex = 0
      el.setAttribute('aria-label', `${total}건이 모여 있어요. 누르면 확대해요.`)
      const zoomIn = () => {
        const b = new k.maps.LatLngBounds()
        ms.forEach((m) => b.extend(new k.maps.LatLng(m.lat, m.lng)))
        map.setBounds(b, 80, 60, 80, 60)
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
  }, [ready, selectedId, layers.team, seedOverride, focusIds, reports, selectedReportId, routeIds, mapLevel, progressMode, pgShown, filter, offsetDays])

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
  const pubVisible = useMemo(() => {
    const out: { layer: PubLayerId; items: PubItem[]; total: number; inView: number }[] = []
    for (const l of PUB_LAYERS) {
      const d = pubData[l.id]
      if (!layers[l.id] || !d) continue
      const pool = d.items.filter((i) => i.lat != null && i.lng != null && (l.id !== 'toilet' || !layers.toiletAccessibleOnly || toiletAccessible(i)))
      if (!view) {
        out.push({ layer: l.id, items: [], total: pool.length, inView: 0 })
        continue
      }
      const [s, w, n, e] = view.b
      const inView = pool.filter((i) => (i.lat as number) >= s && (i.lat as number) <= n && (i.lng as number) >= w && (i.lng as number) <= e)
      out.push({ layer: l.id, items: view.level > PUB_MAX_LEVEL ? [] : inView.slice(0, PUB_MAX_DRAW), total: pool.length, inView: inView.length })
    }
    return out
  }, [pubData, layers, view])

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
        const isSel = pubSel?.item.id === it.id && pubSel.layer === g.layer
        const el = document.createElement('div')
        const dot = mapLevel > 3 && !isSel
        el.className = 'bm-pub' + (warn ? ' bm-pub-warn' : '') + (isSel ? ' bm-pub-sel' : '') + (dot ? ' bm-pub--dot' : '')
        el.style.background = info.color
        el.textContent = dot ? '' : warn ? `${info.glyph}!` : info.glyph
        el.title = warn ? `${it.name} (보도턱 낮춤 없음)` : it.name
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
    // 경로선: 흰 외곽선(아래) + 색 선(위). 가장 짧은 길=회색 점선, 돌아가는 길=토스 블루 실선.
    const draw = (path: [number, number][] | null, kind: 'base' | 'detour') => {
      if (!path) return
      const on = overlay.active === kind
      const w = kind === 'base' ? (on ? 7 : 5) : on ? 9 : 6
      const lls = path.map(ll)
      shapes.push(
        new k.maps.Polyline({ map, path: lls, strokeWeight: w + 5, strokeColor: '#ffffff', strokeOpacity: on ? 1 : 0.7, strokeStyle: 'solid', zIndex: on ? 8 : 6 }),
        new k.maps.Polyline({
          map,
          path: lls,
          strokeWeight: w,
          strokeColor: kind === 'base' ? '#6b7684' : '#1b64da',
          strokeOpacity: on ? 1 : 0.55,
          strokeStyle: kind === 'base' ? 'shortdash' : 'solid',
          zIndex: on ? 9 : 7,
        }),
      )
    }
    draw(overlay.base, 'base')
    draw(overlay.detour, 'detour')
    for (const l of overlay.legs ?? []) {
      const lls = l.coords.map(ll)
      const bus = l.kind === 'bus'
      shapes.push(
        new k.maps.Polyline({ map, path: lls, strokeWeight: (bus ? 9 : 7) + 5, strokeColor: '#ffffff', strokeOpacity: 1, strokeStyle: 'solid', zIndex: 8 }),
        new k.maps.Polyline({ map, path: lls, strokeWeight: bus ? 9 : 7, strokeColor: bus ? '#1b64da' : '#6b7684', strokeOpacity: 1, strokeStyle: bus ? 'solid' : 'shortdash', zIndex: 9 }),
      )
    }
    const flag = (p: Place, text: string, cls: string) => {
      const el = document.createElement('div')
      el.className = 'rt-flag ' + cls
      el.textContent = text
      shapes.push(new k.maps.CustomOverlay({ position: new k.maps.LatLng(p.lat, p.lng), content: el, map, yAnchor: 1.2, zIndex: 12 }))
    }
    flag(overlay.start, '출발', 'rt-flag-s')
    flag(overlay.end, '도착', 'rt-flag-e')
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
    for (const m of overlay.markers) {
      const el = document.createElement('div')
      el.className = 'rt-m ' + m.cls
      el.textContent = m.text
      el.title = m.title
      shapes.push(new k.maps.CustomOverlay({ position: new k.maps.LatLng(m.lat, m.lng), content: el, map, xAnchor: 0.5, yAnchor: 0.5, zIndex: 9 }))
    }
    return () => shapes.forEach((x) => x.setMap(null))
  }, [ready, overlay])

  // 새 결과가 오면 경로 전체가 보이게, 장애요소를 고르면 그곳으로 이동
  useEffect(() => {
    const k = kRef.current
    const map = mapRef.current
    if (!ready || !k || !map || !overlay) return
    if (overlay.fitKey !== lastFit.current) {
      lastFit.current = overlay.fitKey
      const b = new k.maps.LatLngBounds()
      for (const p of [...(overlay.base ?? []), ...(overlay.detour ?? []), ...(overlay.legs ?? []).flatMap((l) => l.coords)]) b.extend(new k.maps.LatLng(p[0], p[1]))
      setTimeout(() => {
        map.relayout()
        map.setBounds(b, isDesktopLayout() ? 60 : 70, 40, isDesktopLayout() ? 80 : Math.round(window.innerHeight * 0.66), isDesktopLayout() ? 480 : 40)
      }, 100)
    } else if (overlay.focus) {
      const h = overlay.hits.find((x) => x.o.id === overlay.focus)
      if (h) map.panTo(new k.maps.LatLng(h.anchor[0], h.anchor[1]))
    }
  }, [ready, overlay])

  // 제보 작성 중 위치 마커(끌어서 옮길 수 있음)
  useEffect(() => {
    const k = kRef.current
    const map = mapRef.current
    if (!ready || !k || !map || !flowOpen || !draftPos) return
    const marker = new k.maps.Marker({ position: new k.maps.LatLng(draftPos.lat, draftPos.lng), map, draggable: true, title: '제보 위치' })
    k.maps.event.addListener(marker, 'dragend', () => {
      const p = marker.getPosition()
      setDraftPos({ lat: p.getLat(), lng: p.getLng() })
    })
    return () => marker.setMap(null)
  }, [ready, flowOpen, draftPos])

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
  const startReport = () => {
    leaveProgress()
    setFlowOpen(true)
    setPanelOpen(false)
    setRewardsOpen(false)
    setSelectedId(null)
    setSelectedReportId(null)
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
      if (g && view && view.level > PUB_MAX_LEVEL) pubNotes.push(`${l.label}: 지도를 확대하면 보여요 (전체 ${g.total}건)`)
      else if (g && g.inView > PUB_MAX_DRAW) pubNotes.push(`${l.label}: 화면 안 ${g.inView}건 중 ${PUB_MAX_DRAW}건만 보여요. 더 확대해 주세요.`)
    }
  }

  const selected = selectedId ? (BY_ID.get(selectedId) ?? null) : null

  // 지금 지도에 보이는 곳의 장애요소 요약(아래 시트)
  const here = useMemo(() => {
    const rows: HomeRow[] = []
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
      rows.push({ key: r.id, kind: 'report', id: r.id, title: `시민 제보 · ${r.type}`, sub: r.verification.rating ? STATUS_LABEL[r.status] : '판정을 기다리고 있어요', rating: r.verification.rating ?? 'none', impact: impactOfReport(r.type, r.locationKind), cat: categoryOf(impactOfReport(r.type, r.locationKind), r.verification.rating ?? 'none') })
    }
    const order: Record<string, number> = { X: 0, TRIANGLE: 1, none: 2, O: 3 }
    return rows.sort((a, b) => order[a.rating] - order[b.rating])
  }, [view, layers.team, reports, seedOverride])
  // 위치 임시 지점은 기존 장애요소 숫자에 섞지 않고 따로 센다
  const hereProv = useMemo(() => {
    if (!view || !layers.team) return 0
    const [s, w, n, e] = view.b
    return PROVISIONAL.filter((b) => b.provisional!.lat >= s && b.provisional!.lat <= n && b.provisional!.lng >= w && b.provisional!.lng <= e).length
  }, [view, layers.team])
  const hereCount = (c: Category) => here.filter((r) => r.cat === c).length
  // 레이어 메뉴에 알려 줄 시민 제보 핀 표시 건수(표시 규칙에 맞는 건 / 지도에 나올 수 있는 전체)
  const citizenStats = useMemo(() => {
    void offsetDays // 시연 시각이 바뀌면 다시 센다
    const now = nowMs()
    let total = 0
    let shown = 0
    for (const r of reports) {
      if (!SHOWN_ON_MAP.includes(r.status) || r.seedId) continue
      total++
      if (showCitizen(r, impactOfReport(r.type, r.locationKind), filter, now)) shown++
    }
    return { shown, total }
  }, [reports, filter, offsetDays])

  const overlayOpen = flowOpen || panelOpen || routeOpen || picking || !!routePick || progressMode
  const behind = !!(selectedId || selectedReportId || pubSel)

  const locateMe = () => {
    const k = kRef.current
    const map = mapRef.current
    if (!k || !map) return
    if (!('geolocation' in navigator)) {
      setLocMsg('이 기기에서는 현재 위치를 쓸 수 없어요.')
      return
    }
    setLocMsg('내 위치를 찾고 있어요…')
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const at = new k.maps.LatLng(pos.coords.latitude, pos.coords.longitude)
        map.setCenter(at)
        map.setLevel(3)
        meRef.current?.setMap(null)
        const el = document.createElement('div')
        el.className = 'hm-me'
        meRef.current = new k.maps.CustomOverlay({ position: at, content: el, map, xAnchor: 0.5, yAnchor: 0.5, zIndex: 3 })
        setLocMsg(`내 위치 주변이에요 (오차 약 ${Math.round(pos.coords.accuracy)}m)`)
      },
      () => setLocMsg('위치를 가져오지 못했어요. 브라우저에서 위치를 허용해 주세요.'),
      { enableHighAccuracy: true, timeout: 8000 },
    )
  }

  // 아래 시트 단계별로 보이는 높이를 내용의 실제 높이에 맞춘다(글자가 커지거나 줄이 바뀌어도 버튼이 잘리지 않게)
  useEffect(() => {
    const sheet = sheetRef.current
    const cta = sheet?.querySelector<HTMLElement>('.hm-s-cta')
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
  const { gripProps } = useSheetSnap(sheetRef, snap, setSnap, overlayOpen)
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
  const openProgress = () => {
    setProgressMode(true)
    setProgressOpen(true)
    setPanelOpen(false)
    setRewardsOpen(false)
    setRouteOpen(false)
    setRoutePick(null)
    setOverlay(null)
    closeFlow()
    setSelectedId(null)
    setSelectedReportId(null)
  }
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
      <div className="bm-main">
        <div ref={container} className="map" role="application" aria-label="북구동행지도" />
        {state.status === 'loading' && <p className="map-notice">지도를 불러오고 있어요…</p>}
        {state.status === 'error' && (
          <p className="map-notice map-notice-error" role="alert">
            {state.message}
          </p>
        )}

        <div className="hm-panel">
        <header className={'hm-top' + (routeOpen || behind ? ' hm-top--route' : '')}>
          <MockStrip />
          <div className="hm-card">
            <div className="hm-bar hm-bar--desk">
              <h1 className="hm-brand">
                <button type="button" className="hm-brand-btn" aria-label="북구동행지도 홈으로" onClick={() => { location.hash = '#/' }}>
                  북구동행지도
                </button>
              </h1>
            </div>
            <div className="hm-searchrow">
              <button
                type="button"
                className="hm-search"
                aria-expanded={routeOpen}
                onClick={() => {
                  leaveProgress()
                  setRouteOpen(true)
                  setRoutePick(null)
                  setPanelOpen(false)
                  setRewardsOpen(false)
                }}
              >
                어디로 가세요? 길찾기
              </button>
              <button type="button" className="hm-iconbtn" onClick={() => setLayerOpen((v) => !v)} aria-expanded={layerOpen} aria-label="지도 레이어와 화면 설정" title="레이어·설정">
                <svg width="22" height="22" viewBox="0 0 22 22" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M11 3 2.5 7.5 11 12l8.5-4.5L11 3Z" />
                  <path d="m2.5 11.5 8.5 4.5 8.5-4.5M2.5 15.5 11 20l8.5-4.5" />
                </svg>
              </button>
            </div>
          </div>
          <button type="button" className="hm-legend-toggle" aria-expanded={legendOpen} onClick={() => setLegendOpen((v) => !v)}>
            범례<span aria-hidden="true"> {legendOpen ? '▴' : '▾'}</span>
          </button>
          <ul className={'hm-legend' + (legendOpen ? '' : ' hm-legend--shut')} aria-label={progressMode ? '범례: 색과 글자는 개선 진행 단계' : '범례: 색과 ○△X는 정도, 길·승·입·◆는 영향 종류'}>
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
            {!progressMode && (
              <li>
                <i className="hm-leg-prov">임</i>위치 임시
              </li>
            )}
            {PUB_LAYERS.filter((l) => layers[l.id]).map((l) => (
              <li key={l.id}>
                <i className="hm-leg-pub" style={{ background: l.color }}>
                  {l.glyph}
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
              <span className="hm-grip-bar" aria-hidden="true" />
              <div className="hm-s-head">
                <h2 className="hm-title">
                  {!view ? '지도를 불러오고 있어요' : here.length > 0 ? `장애요소 ${here.length}곳${hereCount('hard') > 0 ? ` · 어려운 곳 ${hereCount('hard')}` : ''}` : '여기에는 등록된 장애요소가 없어요'}
                </h2>
                <button type="button" className="hm-snapbtn" aria-expanded={snap > 0} onClick={() => setSnap(SNAP_BTN[snap].next)}>
                  {SNAP_BTN[snap].label}
                  <span aria-hidden="true"> {SNAP_BTN[snap].up ? '▲' : '▼'}</span>
                </button>
              </div>
            </div>
            <button type="button" className="hm-locate" onClick={locateMe} aria-label="내 위치로 이동">
              내 위치
            </button>
            <div className="hm-s-cta">
              <button type="button" className="rf-primary hm-cta-main" onClick={startReport}>
                문제 제보하기
              </button>
              <button type="button" className="hm-cta-sub" onClick={() => { leaveProgress(); setRewardsOpen(false); setPanelOpen(true) }}>
                제보 현황
              </button>
              <button type="button" className="hm-cta-sub" onClick={() => { leaveProgress(); setPanelOpen(false); setRewardsOpen(true) }}>
                내 기여
              </button>
            </div>
            <div className="hm-s-mid">
              <p className="hm-eyebrow">{locMsg || '지금 지도에 보이는 곳'}</p>
              {here.length > 0 && (
                <ul className="hm-stats" aria-label="핵심 분류별 개수">
                  <li className="hm-stat">
                    <span className="hm-stat-n">
                      <i className="hm-cat hm-cat-hard">{CATEGORY_INFO.hard.glyph}</i>
                      {hereCount('hard')}
                    </span>
                    <span className="hm-stat-l">어려운 곳</span>
                  </li>
                  <li className="hm-stat">
                    <span className="hm-stat-n">
                      <i className="hm-cat hm-cat-boarding">{CATEGORY_INFO.boarding.glyph}</i>
                      {hereCount('boarding')}
                    </span>
                    <span className="hm-stat-l">버스 불편</span>
                  </li>
                  <li className="hm-stat">
                    <span className="hm-stat-n">
                      <i className="hm-cat hm-cat-caution">{CATEGORY_INFO.caution.glyph}</i>
                      {hereCount('caution') + hereCount('zone')}
                    </span>
                    <span className="hm-stat-l">주의</span>
                  </li>
                  <li className="hm-stat-more">
                    <button type="button" onClick={() => setSnap(2)}>
                      더 보기
                    </button>
                  </li>
                </ul>
              )}
              {hereProv > 0 && <p className="hm-prov-note">위치 임시 {hereProv}곳 (확인 전, 위 숫자에는 넣지 않았어요)</p>}
              <button type="button" className="hm-cta-sub hm-cta-progress" onClick={openProgress}>
                개선 현황 보기
              </button>
            </div>
            <div className="hm-more">
              {here.length > 0 && (
                <ul className="hm-counts" aria-label="영향 종류별 개수">
                  {CATEGORY_ORDER.map((c) =>
                    hereCount(c) > 0 ? (
                      <li key={c} className="hm-count">
                        <i className={'hm-cat hm-cat-' + c}>{CATEGORY_INFO[c].glyph}</i>
                        {CATEGORY_INFO[c].label} {hereCount(c)}
                      </li>
                    ) : null,
                  )}
                </ul>
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
                    <li key={r.key}>
                      <button type="button" className="lr" onClick={() => pickRow(r)}>
                        <i className="lr-glyph" style={{ background: styleOf(r.impact, r.rating).color, color: styleOf(r.impact, r.rating).ink }}>
                          {styleOf(r.impact, r.rating).glyph}
                        </i>
                        {r.impact !== 'zone' && <i className="lr-kind" aria-hidden="true">{IMPACT_INFO[r.impact].glyph}</i>}
                        <span className="lr-main">
                          <span className="lr-title">{r.title}</span>
                          <span className="lr-sub">{r.sub}</span>
                        </span>
                        <span className="lr-chev" aria-hidden="true" />
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              {PROVISIONAL.length > 0 && (
                <>
                  <h3 style={{ marginTop: 20 }}>위치 임시 {PROVISIONAL.length}곳</h3>
                  <ul className="lr-list">
                    {PROVISIONAL.map((b) => (
                      <li key={b.id}>
                        <button type="button" className="lr" onClick={() => openSeed(b.id)}>
                          <i className="lr-glyph" style={{ background: ratingOf(b, seedOverride).color, color: ratingOf(b, seedOverride).ink }}>
                            {ratingOf(b, seedOverride).glyph}
                          </i>
                          <span className="lr-main">
                            <span className="lr-title">{shortName(b.id, b.name)}</span>
                            <span className="lr-sub">위치 임시 · 아직 확인 전이에요</span>
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
                              {shortName(b.id, b.name)}
                            </span>
                            <span className="lr-sub">위치를 아직 정하지 못했어요</span>
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
            data={pubData}
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
            citizen={citizenStats}
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


        {picking && (
          <div className="rf-pick" role="status">
            <span>지도를 눌러 위치를 정해 주세요. 마커를 끌어 옮길 수도 있어요.</span>
            <button type="button" className="rf-primary" disabled={!draftPos} onClick={() => setPicking(false)}>
              이 위치로 정하기
            </button>
          </div>
        )}

        {flowOpen && (
          <ReportFlow
            location={draftPos}
            onLocation={setDraftPos}
            onPickStart={() => setPicking(true)}
            hidden={picking}
            seeds={BARRIERS}
            onClose={closeFlow}
            onOpenReport={openReport}
          />
        )}

        {routeOpen && (
          <RoutePanel
            initialMode={start.mode}
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
            }}
          />
        )}

        {routePick && (
          <div className="rf-pick" role="status">
            <span>{routePick === 'from' ? '출발' : '도착'} 위치를 지도에서 눌러 주세요. 핀을 눌러도 돼요.</span>
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
