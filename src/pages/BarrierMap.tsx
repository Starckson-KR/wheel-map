import { useEffect, useMemo, useRef, useState } from 'react'
import { CENTER_ADDRESS_CANDIDATES, geocode, loadKakao } from '../lib/kakao'
import { loadBarriers } from '../lib/seed'
import type { Barrier, Geometry, LatLng, Rating } from '../types'
import { RATING_STYLE } from '../lib/rating'
import { CATEGORY_INFO, CATEGORY_ORDER, IMPACT_INFO, categoryOf, styleOf, impactLine, impactOf, obstacleName, shortName, type Category, type ImpactKey } from '../lib/display'
import { impactOfReport } from '../lib/routing/impact.ts'
import BarrierDetail from './BarrierDetail'
import ReportDetail from '../components/ReportDetail'
import ViewSettings from '../components/ViewSettings'
import { isDesktopLayout } from '../lib/viewPrefs'
import DemoTools, { MockStrip } from '../components/DemoTools'
import SheetHandle from '../components/SheetHandle'
import ReportFlow, { type Loc } from '../components/ReportFlow'
import ReportsPanel from '../components/ReportsPanel'
import MyRewards from '../components/MyRewards'
import LayerPanel from '../components/LayerPanel'
import PubCard from '../components/PubCard'
import RoutePanel from '../components/RoutePanel'
import { ROLE_STYLE } from '../lib/routing/roleStyle.ts'
import type { RouteOverlay } from '../lib/routing/overlay.ts'
import type { Place } from '../lib/routing/provider.ts'
import { STATUS_LABEL, isExpired, useReports } from '../lib/reportStore'
import type { ReportStatus } from '../types'
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
const UNPLACED = BARRIERS.filter((b) => b.locationStatus)

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
type PinMode = 'dot' | 'chip' | 'full'
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
  onClick: () => void
}
const DOT_PX = 30
const PIN_H = 30

const SHOWN_ON_MAP: ReportStatus[] = ['verified', 'filed', 'assigned', 'in_progress', 'resolved', 'rechecked']

export default function BarrierMap() {
  const container = useRef<HTMLDivElement>(null)
  const kRef = useRef<typeof kakao | null>(null)
  const mapRef = useRef<kakao.maps.Map | null>(null)
  const [state, setState] = useState<{ status: 'loading' | 'ready' } | { status: 'error'; message: string }>({ status: 'loading' })
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [listOpen, setListOpen] = useState(false)
  const [selectedReportId, setSelectedReportId] = useState<string | null>(null)
  const [flowOpen, setFlowOpen] = useState(false)
  const [picking, setPicking] = useState(false)
  const [draftPos, setDraftPos] = useState<Loc | null>(null)
  const [panelOpen, setPanelOpen] = useState(false)
  const [rewardsOpen, setRewardsOpen] = useState(false)
  const [focusIds, setFocusIds] = useState<string[]>([])
  const [layers, setLayers] = useState<LayerState>(loadLayers)
  const [layerOpen, setLayerOpen] = useState(false)
  const [pubData, setPubData] = useState<Partial<Record<PubLayerId, PubDataset>>>({})
  const [pubError, setPubError] = useState<Partial<Record<PubLayerId, boolean>>>({})
  const requested = useRef(new Set<PubLayerId>())
  const [view, setView] = useState<{ level: number; b: [number, number, number, number] } | null>(null)
  const [pubSel, setPubSel] = useState<{ layer: PubLayerId; item: PubItem } | null>(null)
  const [kObj, setKObj] = useState<typeof kakao | null>(null)
  const [routeOpen, setRouteOpen] = useState(false)
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
  useEffect(() => {
    pickingRef.current = picking
  }, [picking])
  useEffect(() => {
    routePickRef.current = routePick
  }, [routePick])
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
    for (const r of reports) if (r.seedId) m.set(r.seedId, r.verification.rating)
    return m
  }, [reports])
  const resetAll = useReports((s) => s.resetAll)
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
        if (cancelled || !container.current) return
        if (!center) throw new Error('지도 중심 주소를 찾지 못했어요. 카카오 앱의 지도·로컬 사용 설정을 확인해 주세요.')
        const map = new k.maps.Map(container.current, { center, level: 4 })
        if (located.length > 0) {
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
  }, [])

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
    for (const b of layers.team ? BARRIERS : []) {
      const g = b.geometry
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
        setListOpen(false)
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
    for (const r of reports) {
      if (!SHOWN_ON_MAP.includes(r.status) || r.seedId || !layers.team) continue
      items.push({
        key: r.id,
        lat: r.lat,
        lng: r.lng,
        rating: r.verification.rating ?? 'none',
        impact: impactOfReport(r.type, r.locationKind),
        name: '시민 제보',
        title: `시민 제보 · ${r.type}${r.verification.rating ? '' : ' · 판정 대기'}${r.status === 'verified' ? '' : ` · ${STATUS_LABEL[r.status]}`}${isExpired(r) ? ' · 만료' : ''}`,
        small: false,
        sel: r.id === selectedReportId,
        dim: !!routeIds,
        route: false,
        citizen: true,
        expired: isExpired(r),
        onClick: () => {
          if (pickingRef.current) {
            setDraftPos({ lat: r.lat, lng: r.lng })
            return
          }
          setSelectedReportId(r.id)
          setSelectedId(null)
          setListOpen(false)
        },
      })
    }

    const level = map.getLevel()
    const proj = (map as unknown as { getProjection(): { containerPointFromCoords(c: kakao.maps.LatLng): { x: number; y: number } } }).getProjection()
    const px = items.map((it) => proj.containerPointFromCoords(new k.maps.LatLng(it.lat, it.lng)))
    const prio = (it: PinItem) => (it.sel ? 100 : 0) + (it.small ? 0 : 5) + ({ X: 3, TRIANGLE: 2, none: 1, O: 0 } as Record<string, number>)[it.rating]
    const order = items.map((_, i) => i).sort((i, j) => prio(items[j]) - prio(items[i]))

    // 1) 점끼리 겹치면 묶음으로(선택한 핀은 묶지 않는다)
    const used = new Set<number>()
    const clusters: number[][] = []
    const singles: number[] = []
    for (const i of order) {
      if (used.has(i)) continue
      used.add(i)
      const members = [i]
      if (!items[i].sel) {
        for (const j of order) {
          if (used.has(j) || items[j].sel) continue
          if (Math.hypot(px[i].x - px[j].x, px[i].y - px[j].y) < DOT_PX) {
            used.add(j)
            members.push(j)
          }
        }
      }
      if (members.length > 1) clusters.push(members)
      else singles.push(i)
    }

    // 2) 남은 핀은 줌 단계가 허용하는 가장 풍부한 모양으로, 다른 글자와 겹치면 한 단계씩 줄인다.
    const allowed: PinMode[] = level >= 5 ? ['dot'] : level === 4 ? ['chip', 'dot'] : ['full', 'chip', 'dot']
    const placed: { x: number; y: number; w: number }[] = []
    const hit = (x: number, y: number, w: number) => placed.some((p) => Math.abs(p.x - x) < (p.w + w) / 2 + 3 && Math.abs(p.y - y) < PIN_H + 3)
    const widthOf = (it: PinItem, m: PinMode) => (m === 'dot' ? DOT_PX : m === 'chip' ? 58 : 30 + 29 + it.name.length * 13.5 + 12)
    const modeOf = new Map<number, PinMode>()
    for (const i of singles) {
      const it = items[i]
      const tryModes: PinMode[] = it.sel ? ['full'] : it.small ? ['dot'] : allowed
      const m = it.sel ? 'full' : (tryModes.find((mm) => !hit(px[i].x, px[i].y, widthOf(it, mm))) ?? 'dot')
      modeOf.set(i, m)
      placed.push({ x: px[i].x, y: px[i].y, w: widthOf(it, m) })
    }

    for (const i of singles) {
      const it = items[i]
      const mode = modeOf.get(i) ?? 'dot'
      const st = styleOf(it.impact ?? 'passage', it.rating)
      const el = document.createElement('div')
      el.className = `bm-pin bm-pin--${mode}` + (it.small ? ' bm-pin-small' : '') + (it.sel ? ' bm-pin-sel' : '') + (it.route ? ' bm-pin-route' : '') + (it.citizen ? ' bm-pin-citizen' : '') + (it.expired ? ' bm-pin-expired' : '') + (it.dim ? ' bm-pin-dim' : '')
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
      if (mode !== 'dot' && it.impact) {
        const kk = document.createElement('span')
        kk.className = 'bm-pin-k'
        kk.textContent = IMPACT_INFO[it.impact].glyph
        kk.setAttribute('aria-hidden', 'true')
        el.appendChild(kk)
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

    for (const members of clusters) {
      const ms = members.map((i) => items[i])
      const lat = ms.reduce((s, m) => s + m.lat, 0) / ms.length
      const lng = ms.reduce((s, m) => s + m.lng, 0) / ms.length
      const el = document.createElement('div')
      el.className = 'bm-cluster' + (ms.every((m) => m.dim) ? ' bm-pin-dim' : '')
      el.textContent = String(ms.length)
      el.title = `${ms.length}곳이 겹쳐 있어요. 누르면 확대해요.`
      el.setAttribute('role', 'button')
      el.tabIndex = 0
      el.setAttribute('aria-label', `${ms.length}곳이 겹쳐 있어요. 누르면 확대해요.`)
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
      shapes.push(new k.maps.CustomOverlay({ position: new k.maps.LatLng(lat, lng), content: el, map, xAnchor: 0.5, yAnchor: 0.5, zIndex: 5 }))
    }
    return () => shapes.forEach((s) => s.setMap(null))
  }, [ready, selectedId, layers.team, seedOverride, focusIds, reports, selectedReportId, routeIds, mapLevel])

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
    if (!ready || !k || !map || !b?.geometry) return
    const a = anchorOf(b.geometry)
    map.panTo(new k.maps.LatLng(a[0], a[1]))
  }, [selectedId, ready])

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
        setListOpen(false)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const openReport = (id: string) => {
    setSelectedReportId(id)
    setSelectedId(null)
    setListOpen(false)
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
    setSelectedId(id)
    setSelectedReportId(null)
    setPanelOpen(false)
    setRewardsOpen(false)
  }
  const startReport = () => {
    setFlowOpen(true)
    setPanelOpen(false)
    setRewardsOpen(false)
    setSelectedId(null)
    setSelectedReportId(null)
    setListOpen(false)
  }
  const closeFlow = () => {
    setFlowOpen(false)
    setPicking(false)
    setDraftPos(null)
  }
  const onReset = async () => {
    if (!window.confirm('시연 중에 만든 제보와 사진을 모두 지워요. 팀 조사 데이터는 그대로예요. 계속할까요?')) return
    closeFlow()
    setSelectedReportId(null)
    setPanelOpen(false)
    setRewardsOpen(false)
    const err = await resetAll()
    if (err) window.alert(err)
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
  const hereCount = (c: Category) => here.filter((r) => r.cat === c).length

  const overlayOpen = flowOpen || panelOpen || routeOpen || picking || !!routePick
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

  // 아래 시트가 접혀 있을 때 보이는 높이를 요약 부분의 실제 높이에 맞춘다(칩이 두 줄이 돼도 버튼이 잘리지 않게)
  useEffect(() => {
    const sheet = sheetRef.current
    const peek = sheet?.querySelector('.hm-peek')
    if (!sheet || !peek) return
    const apply = () => sheet.style.setProperty('--peek', `calc(${Math.ceil(peek.getBoundingClientRect().height) + 28}px + 16px + var(--safe-bottom))`)
    apply()
    const ro = new ResizeObserver(apply)
    ro.observe(peek)
    return () => ro.disconnect()
  }, [overlayOpen])

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
            <div className="hm-bar">
              <h1 className="hm-brand">북구동행지도</h1>
              <div className="hm-tools">
                <button type="button" className="hm-tool" onClick={() => setLayerOpen((v) => !v)} aria-expanded={layerOpen}>
                  레이어
                </button>
                <ViewSettings />
                <DemoTools page="map" onReset={onReset} barriers={BARRIERS} />
              </div>
            </div>
            <button
              type="button"
              className="hm-search"
              aria-expanded={routeOpen}
              onClick={() => {
                setRouteOpen(true)
                setRoutePick(null)
                setPanelOpen(false)
                setRewardsOpen(false)
              }}
            >
              어디로 가세요? 길찾기
            </button>
          </div>
          <ul className="hm-legend" aria-label="범례: 색과 ○△X는 정도, 길·승·입·◆는 영향 종류">
            {(['O', 'TRIANGLE', 'X', 'none'] as const).map((r) => (
              <li key={r}>
                <i style={{ background: RATING_STYLE[r].color, color: RATING_STYLE[r].ink }}>{RATING_STYLE[r].glyph}</i>
                {r === 'none' ? RATING_STYLE[r].label : RATING_STYLE[r].label.slice(2)}
              </li>
            ))}
            {(['passage', 'boarding', 'entry', 'zone'] as const).map((k) => (
              <li key={k}>
                <i className="hm-leg-kind">{IMPACT_INFO[k].glyph}</i>
                {IMPACT_INFO[k].label}
              </li>
            ))}
            {PUB_LAYERS.filter((l) => layers[l.id]).map((l) => (
              <li key={l.id}>
                <i className="hm-leg-pub" style={{ background: l.color }}>
                  {l.glyph}
                </i>
                {l.label} (참고)
              </li>
            ))}
          </ul>
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
          <section ref={sheetRef} className={'hm-sheet' + (listOpen ? ' is-open' : '') + (behind ? ' is-behind' : '')} data-sheet aria-label="이 지역 요약">
            <SheetHandle onUp={() => setListOpen(true)} onDown={() => setListOpen(false)} />
            <button type="button" className="hm-locate" onClick={locateMe} aria-label="내 위치로 이동">
              내 위치
            </button>
            <div className="hm-peek">
              <p className="hm-eyebrow">{locMsg || '지금 지도에 보이는 곳'}</p>
              <h2 className="hm-title">
                {!view ? '지도를 불러오고 있어요' : here.length > 0 ? `장애요소 ${here.length}곳이 있어요` : '여기에는 등록된 장애요소가 없어요'}
              </h2>
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
              <div className="hm-cta">
                <button type="button" className="rf-primary hm-cta-main" onClick={startReport}>
                  문제 제보하기
                </button>
                <button type="button" className="hm-cta-sub" onClick={() => { setRewardsOpen(false); setPanelOpen(true) }}>
                  제보 현황
                </button>
                <button type="button" className="hm-cta-sub" onClick={() => { setPanelOpen(false); setRewardsOpen(true) }}>
                  내 기여
                </button>
              </div>
            </div>
            <div className="hm-more">
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
