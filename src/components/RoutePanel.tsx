import { obstacleName, stripId } from '../lib/display'
import { useEffect, useMemo, useRef, useState } from 'react'
import { ROUTE_CFG, ROUTE_CROSSWALK_RADIUS_M, ROUTE_DEST_RADIUS_M, ROUTE_OFF_ROUTE_M, ROUTE_STOP_RADIUS_M, WALK_CFG } from '../lib/config'
import { keywordSearch } from '../lib/kakao'
import { ROLE_STYLE } from '../lib/routing/roleStyle.ts'
import { isExpired } from '../lib/reportStore'
import { alongM, distToRoute, searchRoute, type Hit, type Obstacle, type Pt, type RouteData, type SearchResult } from '../lib/routing/engine.ts'
import { buildSteps, stepText, type Step, type Turn } from '../lib/routing/guide.ts'
import { autoStep } from '../lib/routing/followNav.ts'
import { searchOwn, type OwnSearch } from '../lib/routing/ownSearch.ts'
import { searchDelay, showRecommended } from '../lib/routing/searchUi.ts'
import { busCardState, cardOrder, initialCard, settledCard, stepCard, type CardId } from '../lib/routing/cards.ts'
import { hasStoredTransit, storedTransitSummary, TRANSIT_FREE_SEARCH } from '../lib/transit/provider.ts'
import { getWalkGraph } from '../lib/routing/walkData.ts'
import { nearWalkNet, type OwnRoute } from '../lib/routing/walkRoute.ts'
import { demoStartOf, pickStart, resolveStart, startPlan, START_HINT } from '../lib/routing/startPlace.ts'
import { hasGeo, locateOnce, readGeoPermission } from '../lib/routing/locateOnce.ts'
import { crosswalksOnRoute, loadExtras, type Extras } from '../lib/routing/extras.ts'
import { recordNoAlt } from '../lib/routing/noAlt.ts'
import { buildObstacles } from '../lib/routing/obstacles.ts'
import type { RouteMarker, RouteOverlay } from '../lib/routing/overlay.ts'
import { DEMO_PAIRS, DEV_TOOLS, makeFetcher, newStats, type DemoPair, type NetStats, type Place } from '../lib/routing/provider.ts'
import type { Barrier, Rating, Report, ReportStatus } from '../types'
import { boardingNear } from '../lib/bus/boarding.ts'
import BusArrivals from './BusArrivals'
import SheetHandle from './SheetHandle'
import TransitView from './TransitView'
import { Sentences } from './Sentences'
import { Badge, RouteCard, Tl, TlHit, TlStep, VerdictBadge } from './RouteUi'
import { fmtDist, fmtMin, WALK_COLOR } from './routeFmt'
import { prefersCalm } from '../lib/viewPrefs'

const SHOWN_ON_MAP: ReportStatus[] = ['verified', 'filed', 'assigned', 'in_progress', 'resolved', 'rechecked']

type Props = {
  k: typeof kakao | null
  barriers: Barrier[]
  seedRatings: Map<string, Rating | undefined>
  reports: Report[]
  picked: { which: 'from' | 'to'; place: Place; n: number } | null
  picking: 'from' | 'to' | null
  onPickRequest: (which: 'from' | 'to' | null) => void
  onOverlay: (o: RouteOverlay | null) => void
  onOpenSeed: (id: string) => void
  onOpenReport: (id: string) => void
  onClose: () => void
  initialMode?: 'walk' | 'bus'
  presetFrom?: string | null
  presetTo?: string | null
  /** 위쪽 검색바에서 고른 도착지: 출발지는 '내 위치'로 정해 바로 경로를 구한다 */
  startTo?: Place | null
  /** 위쪽 검색바에서 고른 추천 경로(시연 경로) */
  startPair?: DemoPair | null
  /** 내 위치 버튼(시트 위로 올려 둔다) */
  onLocate?: () => void
  locMode?: 'off' | 'follow' | 'free'
  /** 내 위치 따라가기를 완전히 끈다(길 안내를 끝낼 때) */
  onStopLocate?: () => void
  /** 지도가 추적 중인 내 위치(화면 계산에만 쓴다) */
  myPos?: { lat: number; lng: number } | null
}

type Card = { id: 'base' | 'detour'; title: string; route: RouteData; hits: Hit[] }
type Guide = { idx: number; manual: boolean } // manual: 이전·다음을 눌러 직접 넘기는 중(내 위치로 자동 넘김 잠시 멈춤)

const TURN_GLYPH: Record<Turn, string> = { straight: '↑', 'slight-left': '↖', left: '←', 'sharp-left': '↙', 'slight-right': '↗', right: '→', 'sharp-right': '↘', uturn: '↩' }
const stepGlyph = (st: Step) => (st.kind === 'crossing' ? '↔' : st.kind === 'stairs' ? '▤' : st.kind === 'arrive' ? '●' : TURN_GLYPH[st.turn])
type Result = {
  res: SearchResult
  pair: string
  extras: Extras | null
  extrasError: boolean
  stats: NetStats
  own: OwnSearch | null // 자체 보행망으로 찾았으면 그 결과(턴바이턴·피해 간 곳). TMAP으로 찾았으면 null
  fallback: boolean // 자체 보행망으로 못 찾아 TMAP으로 넘어왔는가
  start: Place
  end: Place
  fitKey: number
}

const fmtWalk = (m: number) => (m >= 1000 ? `${(m / 1000).toFixed(2)}km` : `${Math.round(m)}m`)

function PlacePicker(props: {
  label: string
  value: Place | null
  k: typeof kakao | null
  allowCurrent: boolean
  active: boolean
  onChange: (p: Place) => void
  onPickMap: () => void
  /** 홈 AI 검색에서 가져온 말: 입력칸에 채우고 검색 결과 목록까지만 띄운다(장소는 사용자가 고른다) */
  preset?: string
  /** 입력칸 구분(화면 밖에서 도착 입력칸을 찾아 커서를 둘 때 쓴다) */
  which: 'from' | 'to'
  /** 입력한 말이 바뀔 때 알린다(비어 있는지에 따라 추천 경로를 보이거나 숨긴다) */
  onQuery?: (q: string) => void
  /** 값이 비어 있을 때 대신 보이는 이름(내 위치를 기다리는 중)과 곁글 */
  pendingName?: string
  pendingNote?: string
  /** 값이 비어 있을 때 '아직 정하지 않았어요.' 대신 보이는 한 줄 */
  emptyText?: string
}) {
  const { label, value, k, allowCurrent, active, onChange, onPickMap, preset, which, onQuery, pendingName, pendingNote, emptyText } = props
  const [q, setQ] = useState(preset ?? '')
  const first = useRef(!!preset) // 홈 검색에서 가져온 말만 기다리지 않고 바로 찾는다
  const reqId = useRef(0)
  const [items, setItems] = useState<kakao.maps.services.PlaceResult[]>([])
  const [msg, setMsg] = useState('')
  const [outside, setOutside] = useState(false)
  const search = async (text = q) => {
    if (!k || !text.trim()) return
    const my = ++reqId.current
    setMsg('찾고 있어요…')
    const r = await keywordSearch(k, text.trim(), 5)
    if (my !== reqId.current) return // 그 사이에 더 새로 입력했으면 옛 결과는 버린다
    if (r.status === 'ok') {
      setItems(r.items)
      setOutside(r.outsideBukgu)
      setMsg('')
    } else {
      setItems([])
      setOutside(false)
      setMsg(r.status === 'empty' ? '검색 결과가 없어요.' : '검색하지 못했어요. 잠시 뒤에 다시 해 주세요.')
    }
  }
  // 입력하면 바로 찾는다(타이핑 사이에는 잠시 기다림). 홈 검색에서 가져온 말도 같은 길로 지도가 준비되면 목록을 띄운다.
  useEffect(() => {
    onQuery?.(q)
    const delay = searchDelay(q, first.current)
    if (delay === null) {
      reqId.current++
      setItems([])
      setOutside(false)
      setMsg('')
      return
    }
    if (!k) return
    first.current = false
    const t = setTimeout(() => void search(q), delay)
    return () => clearTimeout(t)
    // search는 q·k만 읽는다
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, k])
  const current = () => {
    if (!navigator.geolocation) return setMsg('이 브라우저에서는 현재 위치를 쓸 수 없어요.')
    setMsg('현재 위치를 찾고 있어요…')
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setMsg('')
        onChange({ name: '현재 위치', lat: pos.coords.latitude, lng: pos.coords.longitude })
      },
      () => setMsg('현재 위치를 가져오지 못했어요. 위치 권한을 확인하거나 다른 방법으로 정해 주세요.'),
      { enableHighAccuracy: true, timeout: 8000 },
    )
  }
  return (
    <fieldset className="rt-place">
      <legend>{label}</legend>
      <p className="rt-val">{value ? <strong>{value.name}</strong> : pendingName ? <><strong>{pendingName}</strong>{pendingNote && <span className="bm-meta"> {pendingNote}</span>}</> : <span className="bm-meta">{emptyText ?? '아직 정하지 않았어요.'}</span>}</p>
      <div className="rt-row">
        <input
          type="search"
          data-place={which}
          value={q}
          placeholder="장소 이름 검색"
          aria-label={`${label} 장소 검색어`}
          enterKeyHint="search"
          autoComplete="off"
          autoCorrect="off"
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && search()}
        />
      </div>
      {msg && <Sentences as="p" className="bm-meta">{msg}</Sentences>}
      {preset && !value && items.length > 0 && <Sentences as="p" className="bm-meta">검색에서 가져온 말이에요. 아래에서 장소를 골라 주세요.</Sentences>}
      {items.length > 0 && outside && <p className="bm-meta">광주 북구 밖의 결과예요.</p>}
      {items.length > 0 && (
        <ul className="rt-results">
          {items.map((p) => (
            <li key={p.id}>
              <button
                type="button"
                onClick={() => {
                  onChange({ name: p.place_name, lat: Number(p.y), lng: Number(p.x), address: p.road_address_name || p.address_name })
                  setItems([])
                  setQ('')
                }}
              >
                <strong>{p.place_name}</strong>
                <span className="bm-meta">{p.road_address_name || p.address_name}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="rt-row">
        <button type="button" onClick={onPickMap} aria-pressed={active} className={active ? 'on' : ''}>
          {active ? '지도를 눌러 주세요…' : '지도에서 선택'}
        </button>
        {allowCurrent && (
          <button type="button" onClick={current}>
            현재 위치
          </button>
        )}
      </div>
    </fieldset>
  )
}

export default function RoutePanel(props: Props) {
  const { k, barriers, seedRatings, reports, picked, picking, onPickRequest, onOverlay, onOpenSeed, onOpenReport, onClose } = props
  const [from, setFrom] = useState<Place | null>(null)
  const [to, setTo] = useState<Place | null>(props.startTo ?? null)
  const [pairId, setPairId] = useState<string | null>(null)
  // 출발지 '내 위치' 자동 채우기: pending=도착지를 고르는 순간에 위치를 묻는다 / asking=위치 확인 중 / failed=못 채움(비움)
  const [autoFrom, setAutoFrom] = useState<'idle' | 'pending' | 'asking' | 'failed'>('idle')
  const autoId = useRef(0)
  const [status, setStatus] = useState<'idle' | 'loading' | 'done' | 'error'>('idle')
  const [error, setError] = useState('')
  const [result, setResult] = useState<Result | null>(null)
  const [active, setActive] = useState<'base' | 'detour'>('base')
  const [focus, setFocus] = useState<string | null>(null)
  const [fitN, setFitN] = useState(0)
  const [pairsOpen, setPairsOpen] = useState(false)
  // 결과가 나오면 입력 칸은 한 줄 요약으로 접는다(칸은 지우지 않고 숨기기만 해서 입력한 값은 그대로다)
  const [formOpen, setFormOpen] = useState(!props.startTo)
  const [boot, setBoot] = useState(!!props.startTo) // 검색에서 고른 도착지: 출발지(내 위치)를 정하는 동안
  useEffect(() => {
    if (result) setFormOpen(false)
  }, [result])
  const formHidden = !boot && !formOpen && !pairsOpen && !!from && !!to
  const [destQ, setDestQ] = useState(props.presetTo ?? '') // 도착 입력칸에 쓴 말(비어 있을 때만 추천 경로를 보인다)
  const typingOff = useRef<ReturnType<typeof setTimeout>>(undefined)
  const [typing, setTyping] = useState(false) // 입력칸에 커서가 있는 동안: 휴대폰에서는 시트를 키워 키보드에 가려지지 않게 한다
  const topRef = useRef<HTMLDivElement>(null)
  const [collapsed, setCollapsed] = useState(false)
  const [mode, setMode] = useState<'walk' | 'bus'>('walk') // 고른 카드가 버스 타고이면 'bus'
  const [transitOv, setTransitOv] = useState<RouteOverlay | null>(null)
  const [openStop, setOpenStop] = useState<string | null>(null)
  const runId = useRef(0)
  const [engineMode, setEngineMode] = useState<'own' | 'tmap'>('own') // 개발 모드에서만 바꿀 수 있다(비교용)
  const [guide, setGuide] = useState<Guide | null>(null)
  const [guideMsg, setGuideMsg] = useState('')
  const [offRoute, setOffRoute] = useState<Pt | null>(null)
  // 버스 타고 가는 길·정류장 경고에 쓰는 장애요소(걷는 경로와 같은 규칙)
  const obstaclesNow = useMemo(
    () => buildObstacles(barriers, seedRatings, reports.filter((r) => !r.seedId && SHOWN_ON_MAP.includes(r.status) && !isExpired(r))),
    [barriers, seedRatings, reports],
  )

  const autoFromRef = useRef(autoFrom)
  autoFromRef.current = autoFrom
  const myPosRef = useRef(props.myPos)
  myPosRef.current = props.myPos
  // 이용자가 출발지를 직접 만지면 자동 채우기를 멈춘다(직접 고른 값을 존중)
  const cancelAuto = () => {
    autoId.current++
    if (autoFromRef.current !== 'idle') setAutoFrom('idle')
  }
  // 내 위치를 받아 시범 지역(보행망 150m) 안이면 출발지로 넣고, 아니면 비운 채 한 줄만 알린다
  const fillFromHere = async () => {
    const my = ++autoId.current
    setAutoFrom('asking')
    const pos = myPosRef.current ?? (await locateOnce(5000))
    const wg = pos ? await getWalkGraph() : null
    if (my !== autoId.current) return null
    const r = resolveStart(pos, !!pos && !!wg && nearWalkNet(wg, [pos.lat, pos.lng], WALK_CFG.snapMaxM))
    if (r.ok) {
      setFrom((prev) => prev ?? r.place)
      setAutoFrom('idle')
      return r.place
    }
    setAutoFrom('failed')
    return null
  }
  // 처음 열 때: 이미 허용돼 있으면 조용히 채우고(권한 창이 도착 칸 커서·키보드를 빼앗지 않는다), 아직 안 물었으면 '내 위치'만 보여 두었다가 도착지를 고를 때 묻는다
  useEffect(() => {
    if (props.startTo || props.startPair) return // 검색에서 온 경우는 아래 효과가 맡는다
    let dead = false
    void (async () => {
      const perm = await readGeoPermission()
      if (dead) return
      const plan = startPlan(perm, { hasPreset: !!props.presetFrom, hasFrom: false, hasGeo: hasGeo() })
      if (plan === 'silent') void fillFromHere()
      else if (plan === 'onPick') setAutoFrom('pending')
      else if (perm === 'denied' && !props.presetFrom) setAutoFrom('failed')
    })()
    return () => {
      dead = true
      autoId.current++
    }
    // 처음 한 번만
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // 위쪽 검색바에서 도착지를 골라 왔을 때: 출발지를 '내 위치'로 정해 바로 경로를 구한다.
  // 허용돼 있으면 조용히, 아직 안 물었으면 지금(고른 순간) 묻고, 거부·시범 지역 밖·시간 초과면 출발지를 고르게 한다.
  useEffect(() => {
    const t = props.startTo
    if (!t) return
    let dead = false
    void (async () => {
      const perm = await readGeoPermission()
      if (dead) return
      const plan = startPlan(perm, { hasPreset: false, hasFrom: false, hasGeo: hasGeo() })
      let f = plan === 'none' ? null : await fillFromHere()
      if (dead) return
      // 위치를 못 쓰거나 시범 지역 밖이면 패널을 띄우지 않고 시연 출발점에서 바로 구한다
      if (!f) {
        const d = pickStart(null, false, demoStartOf(DEMO_PAIRS))
        if (d) {
          f = d.place
          setFrom(d.place)
          setAutoFrom('idle')
        }
      }
      setBoot(false)
      if (f) void run(f, t, null, `${f.name} → ${t.name}`)
      else {
        setAutoFrom('failed')
        setFormOpen(true)
      }
    })()
    return () => {
      dead = true
      autoId.current++
    }
    // 처음 한 번만
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // 지도에서 고른 위치 반영
  const lastPicked = useRef(0)
  useEffect(() => {
    if (!picked || picked.n === lastPicked.current) return
    lastPicked.current = picked.n
    setPairId(null)
    if (picked.which === 'from') {
      cancelAuto()
      setFrom(picked.place)
    } else {
      setTo(picked.place)
      if (autoFromRef.current === 'pending') void fillFromHere()
    }
    setCollapsed(false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [picked])

  const run = async (f: Place, t: Place, pid: string | null, pairLabel: string) => {
    const my = ++runId.current
    setStatus('loading')
    setError('')
    setResult(null)
    setFocus(null)
    setGuide(null)
    setOffRoute(null)
    const stats = newStats()
    try {
      const citizen = reports.filter((r) => !r.seedId && SHOWN_ON_MAP.includes(r.status) && !isExpired(r))
      const obstacles = buildObstacles(barriers, seedRatings, citizen)
      // 1순위: 자체 보행망(키·서버 없이 브라우저 안에서 계산). 못 찾으면(보행망 밖·연결 끊김) TMAP 방식으로 넘어간다.
      let own: OwnSearch | null = null
      let why: 'load' | 'outside' | 'no-path' = 'load'
      if (engineMode === 'own') {
        const wg = await getWalkGraph()
        if (wg) {
          const o = searchOwn(wg, [f.lat, f.lng], [t.lat, t.lng], obstacles, ROUTE_CFG, WALK_CFG)
          if (o.base) own = o
          else why = o.error === 'no-path' ? 'no-path' : 'outside'
        }
        // 배포판에는 TMAP 키가 없다: 자체 경로를 못 찾으면 짧은 안내만 보인다(개발 모드만 TMAP으로 넘어간다)
        if (!own && !DEV_TOOLS) {
          if (my !== runId.current) return
          setStatus('error')
          setError(why === 'load' ? '길 자료를 불러오지 못했어요. 잠시 뒤에 다시 해 주세요.' : why === 'no-path' ? '두 곳을 잇는 길을 찾지 못했어요.' : '시범 지역 안에서만 길을 찾을 수 있어요.')
          return
        }
      }
      const res = own ? own.res : await searchRoute({ obstacles, cfg: ROUTE_CFG, fetchRoute: makeFetcher(pid, f, t, stats) })
      if (my !== runId.current) return
      if (!res.base) {
        setStatus('error')
        setError(stats.error || res.error || '경로를 받지 못했어요.')
        return
      }
      recordNoAlt(res.unresolved, pairLabel)
      let extras: Extras | null = null
      let extrasError = false
      try {
        extras = await loadExtras(f, t)
      } catch {
        extrasError = true
      }
      if (my !== runId.current) return
      setResult({ res, pair: pairLabel, extras, extrasError, stats, own, fallback: !own && engineMode === 'own', start: f, end: t, fitKey: my })
      const pick = initialCard(!!res.detour, props.initialMode === 'bus', busCardState(hasStoredTransit(pid), TRANSIT_FREE_SEARCH))
      setMode(pick === 'bus' ? 'bus' : 'walk')
      setActive(pick === 'bus' ? (res.detour ? 'detour' : 'base') : pick)
      setFitN((n) => n + 1)
      setStatus('done')
    } catch {
      if (my === runId.current) {
        setStatus('error')
        setError('경로를 찾는 중에 문제가 생겼어요.')
      }
    }
  }

  // 접거나 다시 열면 남은 지도 영역에 맞춰 경로를 다시 맞춘다
  useEffect(() => {
    setFitN((n) => n + 1)
  }, [collapsed])

  // 카드를 고르면 그 경로가 지도에 그려지고 아래에 단계별 안내가 나온다
  const railRef = useRef<HTMLUListElement>(null)
  const progUntil = useRef(0)
  const settleTimer = useRef<number | undefined>(undefined)
  const onSettleRef = useRef<() => void>(() => {})
  // 손으로 넘기다 멈추면 가운데에 온 카드를 고른다(scrollend가 없으면 scroll 멈춤 120ms 뒤)
  onSettleRef.current = () => {
    const rail = railRef.current
    if (!rail || Date.now() < progUntil.current) return
    const rr = rail.getBoundingClientRect()
    const spots = Array.from(rail.querySelectorAll<HTMLElement>('[data-card]')).map((el) => {
      const r = el.getBoundingClientRect()
      return { id: el.dataset.card as CardId, center: r.left + r.width / 2, disabled: el.dataset.card === 'bus' && busState === 'none' }
    })
    const id = settledCard(rr.left + rr.width / 2, spots)
    if (id && id !== sel) pickCard(id)
  }
  useEffect(() => {
    const rail = railRef.current
    if (!rail) return
    const hasEnd = 'onscrollend' in window
    const fire = () => onSettleRef.current()
    const onScroll = () => {
      window.clearTimeout(settleTimer.current)
      settleTimer.current = window.setTimeout(fire, 120)
    }
    if (hasEnd) rail.addEventListener('scrollend', fire)
    else rail.addEventListener('scroll', onScroll, { passive: true })
    return () => {
      window.clearTimeout(settleTimer.current)
      rail.removeEventListener('scrollend', fire)
      rail.removeEventListener('scroll', onScroll)
    }
  }, [status, result, active, mode])
  const pickCard = (id: CardId, focus = false) => {
    if (id === 'bus') setMode('bus')
    else {
      setMode('walk')
      setActive(id)
    }
    setFitN((n) => n + 1)
    const el = railRef.current?.querySelector<HTMLElement>(`[data-card="${id}"]`)
    progUntil.current = Date.now() + 700 // 이 사이에 생기는 스크롤 이벤트는 우리가 움직인 것이라 무시
    el?.scrollIntoView({ block: 'nearest', inline: 'center', behavior: prefersCalm() ? 'auto' : 'smooth' })
    if (focus) el?.querySelector<HTMLElement>('button')?.focus({ preventScroll: true })
  }

  const choosePair = (p: DemoPair) => {
    cancelAuto() // 추천 경로는 출발·도착을 둘 다 채운다(내 위치가 덮어쓰지 않는다)
    setPairsOpen(false)
    const f: Place = { id: p.from.stopId, name: p.fromName, lat: p.from.lat, lng: p.from.lng }
    const t: Place = { id: p.to.stopId, name: p.toName, lat: p.to.lat, lng: p.to.lng }
    setFrom(f)
    setTo(t)
    setPairId(p.id)
    void run(f, t, p.id, `${p.fromName} → ${p.toName}`)
  }

  // 위쪽 검색바의 추천 경로로 열렸으면 그 경로를 바로 구한다
  useEffect(() => {
    if (props.startPair) choosePair(props.startPair)
    // 처음 한 번만
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const cards: Card[] = useMemo(() => {
    if (!result?.res.base) return []
    const r = result.res
    const out: Card[] = []
    if (r.detour) out.push({ id: 'detour', title: result.own ? (r.unresolved.length > 0 ? '일부만 피해 가는 길' : '피해 가는 길') : r.unresolved.length + r.untested.length > 0 ? '일부만 돌아가는 길' : '돌아가는 길', route: r.detour, hits: r.detourHits })
    out.push({ id: 'base', title: '가장 짧은 길', route: r.base as RouteData, hits: r.baseHits })
    return out
  }, [result])

  const activeCard = cards.find((c) => c.id === active) ?? cards[0]
  const unresolvedIds = useMemo(() => new Set(result?.res.unresolved.map((h) => h.o.id) ?? []), [result])
  const endpointIds = useMemo(() => result?.res.endpoint.map((h) => h.o.id) ?? [], [result])

  // 자체 보행망 경로의 단계(턴바이턴). 피해 간 곳은 피해 가는 길에만 붙는다.
  const steps: Step[] = useMemo(() => {
    if (!result?.own || !activeCard) return []
    const rt = activeCard.route as OwnRoute
    return buildSteps(rt.coords, rt.seg, activeCard.hits, activeCard.id === 'detour' ? result.own.avoided : [])
  }, [result, activeCard])
  const avoidedNames = useMemo(() => (result?.own?.detour ? result.own.avoided.map((h) => obstacleName(h.o)) : []), [result])
  const extraM = result?.own?.detour && result.own.base ? result.own.detour.distance - result.own.base.distance : 0

  // 안내 모드: 내 위치(지도가 추적)가 들어올 때마다 경로에서 벗어났는지 보고, 다음 단계 지점에 가까워지면 단계를 자동으로 넘긴다.
  // 위치는 화면 계산에만 쓰고 저장하거나 보내지 않는다.
  const gOn = !!guide
  const gManual = !!guide?.manual
  useEffect(() => {
    if (!gOn || !props.myPos || !activeCard || steps.length === 0) return
    const coords = activeCard.route.coords
    const p: Pt = [props.myPos.lat, props.myPos.lng]
    if (distToRoute(coords, p) > ROUTE_OFF_ROUTE_M) {
      setOffRoute(p)
      return
    }
    setOffRoute(null)
    if (gManual) return
    const along = alongM(coords, p)
    setGuide((g) => {
      if (!g) return g
      const idx = autoStep(steps, along, g.idx)
      return idx === g.idx ? g : { ...g, idx }
    })
  }, [props.myPos, gOn, gManual, activeCard, steps])

  const startedLoc = useRef(false)
  const startGuide = () => {
    setGuide({ idx: 0, manual: false })
    setGuideMsg('')
    setOffRoute(null)
    setCollapsed(true)
    // 길 안내를 시작하면 내 위치를 가운데에 두고 따라간다(누른 동작 안에서 위치·나침반 권한을 요청한다)
    if (props.locMode !== 'follow') {
      startedLoc.current = props.locMode === 'off' || props.locMode === undefined
      props.onLocate?.()
    }
  }
  const endGuide = () => {
    setGuide(null)
    setOffRoute(null)
    setGuideMsg('')
    setCollapsed(false)
    if (startedLoc.current) props.onStopLocate?.()
    startedLoc.current = false
  }
  const recenter = () => {
    setGuide((g) => g && { ...g, manual: false })
    if (props.locMode === 'free' || props.locMode === 'off' || props.locMode === undefined) props.onLocate?.()
  }
  const reroute = () => {
    if (!offRoute || !result) return
    const f: Place = { name: '현재 위치', lat: offRoute[0], lng: offRoute[1] }
    cancelAuto()
    setFrom(f)
    setPairId(null)
    setCollapsed(false)
    void run(f, result.end, null, `${f.name} → ${result.end.name}`)
  }
  const openObstacle = (o: Obstacle) => {
    setFocus(o.id)
    setCollapsed(true)
    if (o.origin === 'report') onOpenReport(o.id)
    else onOpenSeed(o.id)
  }

  const perRoute = useMemo(() => {
    const m = new Map<string, ReturnType<typeof crosswalksOnRoute>>()
    if (result?.extras) for (const c of cards) m.set(c.id, crosswalksOnRoute(c.route.coords, result.extras.crosswalkAll))
    return m
  }, [result, cards])

  // 지도에 보낼 정보
  useEffect(() => {
    if (mode === 'bus') {
      onOverlay(transitOv)
      return
    }
    if (!result || !activeCard) {
      onOverlay(null)
      return
    }
    const markers: RouteMarker[] = []
    const cw = perRoute.get(activeCard.id)
    for (const c of cw?.noCurb ?? []) {
      if (c.item.lat != null && c.item.lng != null)
        markers.push({ lat: c.item.lat, lng: c.item.lng, text: '횡!', title: `${c.item.name} (보도턱 낮춤 없음)`, cls: 'rt-m-cw' })
    }
    if (result.extras) {
      for (const s of [...result.extras.stops.start, ...result.extras.stops.end]) {
        if (s.item.lat != null && s.item.lng != null) markers.push({ lat: s.item.lat, lng: s.item.lng, text: '버스', title: s.item.name, cls: 'rt-m-bus' })
      }
    }
    onOverlay({
      start: result.start,
      end: result.end,
      base: active !== 'base' ? null : (result.res.base?.coords ?? null),
      detour: active !== 'detour' ? null : (result.res.detour?.coords ?? null),
      active: activeCard.id,
      hits: activeCard.hits,
      unresolvedIds: [...unresolvedIds],
      markers,
      focus,
      fitKey: result.fitKey * 1000 + fitN,
      ...(result.own ? { osm: true } : {}),
      ...(guide && steps[guide.idx]
        ? { guide: { coords: steps[guide.idx].coords, next: steps[guide.idx + 1]?.coords ?? [], at: steps[guide.idx].at, turn: stepGlyph(steps[guide.idx]), n: guide.idx } }
        : {}),
    })
    // onOverlay는 부모의 setState라 의존성에서 뺀다
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [result, activeCard, perRoute, focus, unresolvedIds, mode, transitOv, active, fitN, guide, steps])

  useEffect(() => () => onOverlay(null), []) // eslint-disable-line react-hooks/exhaustive-deps

  const openHit = (h: Hit) => {
    setFocus(h.o.id)
    setCollapsed(true)
    if (h.o.origin === 'report') onOpenReport(h.o.id)
    else onOpenSeed(h.o.id)
  }

  const passHits = activeCard ? activeCard.hits.filter((h) => h.role !== 'B' && h.role !== 'E') : []
  const canRun = !!from && !!to && status !== 'loading'

  const inkOf = (st: { color: string }) => (st as { ink?: string }).ink ?? '#fff'
  const WHERE: Record<'route' | 'start' | 'end', string> = { route: '경로 위', start: '출발 근처', end: '도착 근처' }

  const railIds = cardOrder(!!result?.res.detour)
  const sel: CardId = mode === 'bus' ? 'bus' : active
  const busState = busCardState(hasStoredTransit(pairId), TRANSIT_FREE_SEARCH)
  const finalId: 'base' | 'detour' = result?.res.detour ? 'detour' : 'base'
  const finalSummary = result?.res.summary[finalId] ?? null

  const stopsBlock = result?.extras && (
    <section className="rf-card rt-sec">
      <h3>출발·도착 근처 버스정류장 ({ROUTE_STOP_RADIUS_M}m 안)</h3>
      <Sentences as="p" className="bm-meta">정류장을 누르면 다음 저상버스를 볼 수 있어요. 정류장에 버스 타기 불편한 곳이 있으면 같이 알려 드려요.</Sentences>
      {(
        [
          ['출발', result.extras.stops.start],
          ['도착', result.extras.stops.end],
        ] as const
      ).map(([lab, list]) => (
        <div key={lab}>
          <p>
            <b>{lab} 근처</b> {list.length === 0 && <span className="bm-meta">정류장 자료가 없어요.</span>}
          </p>
          {list.length > 0 && (
            <ul className="rt-plain">
              {list.slice(0, 5).map((s) => {
                const key = lab + s.item.id
                const open = openStop === key
                return (
                  <li key={key}>
                    <button type="button" className="bus-dir" aria-expanded={open} onClick={() => setOpenStop(open ? null : key)}>
                      {s.item.name} · {s.distM}m{s.item.fields['NEXT_BUSSTOP'] ? ` · ${String(s.item.fields['NEXT_BUSSTOP'])} 방면` : ''}
                    </button>
                    {open && (
                      <BusArrivals
                        key={s.item.id}
                        choices={[{ stationId: s.item.id, name: s.item.name, next: s.item.fields['NEXT_BUSSTOP'] as string | undefined }]}
                        warns={boardingNear(obstaclesNow, [s.item.lat as number, s.item.lng as number])}
                      />
                    )}
                  </li>
                )
              })}
              {list.length > 5 && <li className="bm-meta">외 {list.length - 5}곳</li>}
            </ul>
          )}
        </div>
      ))}
    </section>
  )

  const extrasBlock = result && (
    <>
      {result.extrasError && <p className="rf-warn">공공데이터(횡단보도·정류장·편의시설)를 불러오지 못했어요.</p>}
      {result.extras && activeCard && (
        <details className="rf-card rt-more">
          <summary>근처 공공데이터 보기 (참고)</summary>
          <section className="rt-sec">
            <h3>경로 근처 횡단보도</h3>
            {(() => {
              const cw = perRoute.get(activeCard.id)
              if (!cw) return null
              return (
                <>
                  <p>
                    경로 {ROUTE_CROSSWALK_RADIUS_M}m 안에 횡단보도가 <b>{cw.all.length}곳</b> 있고, 이 중 보도턱을 낮추지 않은 곳이 <b>{cw.noCurb.length}곳</b>이에요.
                  </p>
                  {cw.noCurb.length > 0 && (
                    <ul className="rt-plain">
                      {cw.noCurb.map((c) => (
                        <li key={c.item.id}>
                          <b>횡! 주의</b> {c.item.name} · 경로에서 {c.distM}m, 보도턱 낮춤이 없어요
                        </li>
                      ))}
                    </ul>
                  )}
                  <Sentences as="p" className="bm-meta">보도턱 낮춤은 있고 없고만 알 수 있어요. ○△X 판정은 아니에요.</Sentences>
                </>
              )
            })()}
          </section>

          <section className="rt-sec">
            <h3>목적지 정보 · {result.end.name}</h3>
            <p>
              <b>장애인편의시설</b> ({ROUTE_DEST_RADIUS_M}m 안, 이름과 주소가 맞는 시설을 먼저 보여 줘요)
            </p>
            {result.extras.dest.facilities.length === 0 ? (
              <Sentences as="p" className="bm-meta">이 범위에 등록된 장애인편의시설 자료가 없어요. 자료에 없다는 뜻이고, 시설이 없다고 확인한 건 아니에요.</Sentences>
            ) : (
              <ul className="rt-plain">
                {result.extras.dest.facilities.slice(0, 6).map((f) => (
                  <li key={f.item.id}>
                    {f.matched && <b>이름·주소 일치 </b>}
                    {f.item.name} · {f.distM}m · {String(f.item.fields['faclTyCd'] ?? '')}
                    <br />
                    <span className="bm-meta">{f.item.fields['evalInfo'] ? `편의시설: ${String(f.item.fields['evalInfo'])}` : '편의시설 항목은 아직 모으지 못했어요.'}</span>
                  </li>
                ))}
              </ul>
            )}
            <p>
              <b>장애인화장실</b> ({ROUTE_DEST_RADIUS_M}m 안): 공중화장실 {result.extras.dest.toilets.length}곳 중 장애인용 시설이 있는 곳은 {result.extras.dest.accessibleToilets}곳이에요.
            </p>
            {result.extras.dest.toilets.length > 0 && (
              <ul className="rt-plain">
                {result.extras.dest.toilets.slice(0, 4).map((t) => (
                  <li key={t.item.id}>
                    {t.item.name} · {t.distM}m · 장애인용 위생시설 {String(t.item.fields['장애인용위생시설합계'] ?? 0)}개
                  </li>
                ))}
              </ul>
            )}
            <Sentences as="p" className="bm-meta">공공데이터라서 판정은 아니에요.</Sentences>
          </section>
        </details>
      )}
    </>
  )

  const locBtn = props.onLocate && (
    <button
      type="button"
      className={'hm-locate rt-locate' + (collapsed ? ' rt-locate-mini' : '') + (props.locMode === 'follow' ? ' on' : props.locMode === 'free' ? ' free' : '')}
      onClick={props.onLocate}
      aria-pressed={props.locMode !== undefined && props.locMode !== 'off'}
      aria-label={props.locMode === 'follow' ? '내 위치 따라가기 끄기' : props.locMode === 'free' ? '내 위치로 돌아가 따라가기' : '내 위치로 이동'}
      hidden={!!picking || !!guide}
    >
      내 위치
    </button>
  )

  // 접어도 시트는 숨겨서 남겨 둔다(지도의 경로 선은 시트가 정한다). 끝내기를 눌러야 지워진다.
  const gStep = guide ? steps[guide.idx] : undefined
  const gText = gStep ? stepText(gStep) : null
  const gLeft = gStep && activeCard ? Math.max(0, Math.round(activeCard.route.distance - gStep.startM)) : 0
  const guidePanel = guide && gStep && gText && (
    <div className="rt-guide" role="region" aria-label="길 안내" aria-live="polite" data-sheet>
      <div className="rt-g-main" key={guide.idx}>
        <span className="rt-g-ico" aria-hidden="true">
          {stepGlyph(gStep)}
        </span>
        <div className="rt-g-text">
          <p className="rt-g-title">{gText.title}</p>
          <p className="rt-g-sub">{gText.sub}</p>
        </div>
        <span className="rt-g-count">
          {guide.idx + 1}/{steps.length}
        </span>
      </div>
      {gStep.notes.map((n, i) =>
        n.kind === 'avoid' ? (
          <p key={i} className="rt-g-note">
            {obstacleName(n.o)} 때문에 돌아가요
          </p>
        ) : (
          <p key={i} className="rt-g-note rt-g-warn">
            이 근처에 {obstacleName(n.o)}
          </p>
        ),
      )}
      {offRoute && (
        <p className="rt-g-note rt-g-warn" role="alert">
          길에서 벗어났어요.{' '}
          <button type="button" className="rt-g-link" onClick={reroute}>
            여기서 다시 찾기
          </button>
        </p>
      )}
      {guideMsg && <p className="rt-g-note">{guideMsg}</p>}
      <p className="rt-g-meta">남은 거리 {fmtDist(gLeft)}</p>
      <div className="rt-g-btns">
        <button type="button" onClick={() => setGuide({ idx: Math.max(0, guide.idx - 1), manual: true })} disabled={guide.idx === 0}>
          이전
        </button>
        <button type="button" className="rf-primary" onClick={() => setGuide({ idx: Math.min(steps.length - 1, guide.idx + 1), manual: true })} disabled={guide.idx >= steps.length - 1}>
          다음
        </button>
      </div>
      <div className="rt-g-btns">
        {props.locMode === 'follow' && !guide.manual ? (
          <button type="button" aria-pressed="true" className="on" onClick={() => props.onStopLocate?.()}>
            내 위치 따라가기 끄기
          </button>
        ) : (
          <button type="button" className="rf-recenter" onClick={recenter}>
            {props.locMode === 'off' || props.locMode === undefined ? '내 위치 따라가기' : '다시 가운데로'}
          </button>
        )}
        <button type="button" onClick={endGuide}>
          안내 끝내기
        </button>
      </div>
    </div>
  )

  const mini = collapsed && !guide && (
        <div className="rt-mini" role="status" data-sheet>
        <span>길찾기 {result ? `· ${result.start.name} → ${result.end.name}` : ''}</span>
        <button type="button" className="rf-primary" onClick={() => setCollapsed(false)}>
          다시 열기
        </button>
        <button type="button" onClick={onClose}>
          끝내기
        </button>
          </div>
  )

  return (
    <>
    {locBtn}
    {mini}
    {guidePanel}
    <div
      className={'rp rt' + (picking ? ' rt-hidden' : '') + (typing ? ' rt-typing' : '')}
      data-sheet
      role="dialog"
      aria-label="길찾기"
      hidden={!!picking || collapsed || !!guide}
      onFocus={(e) => {
        if (!(e.target instanceof HTMLInputElement)) return
        clearTimeout(typingOff.current)
        setTyping(true)
      }}
      onBlur={(e) => {
        if (!(e.target instanceof HTMLInputElement)) return
        // 결과를 누르는 순간 시트가 줄어 눌린 자리가 어긋나지 않도록 잠시 뒤에 줄인다
        typingOff.current = setTimeout(() => setTyping(false), 250)
      }}
    >
      <SheetHandle exit={!result} onDown={() => (result ? setCollapsed(true) : onClose())} />
      <div className="rf-head">
        <h2>길찾기</h2>
        <span className="rt-head-btns">
          <button type="button" onClick={() => setCollapsed(true)} disabled={!result}>
            지도 보기
          </button>
          <button type="button" className="bm-close" onClick={onClose}>
            닫기
          </button>
        </span>
      </div>

      {boot && <p className="rf-notice" role="status">내 위치를 찾고 있어요…</p>}
      {formHidden && !pairId && from && to && (
        <div className="rt-pair-sum">
          <span className="rt-pair-name">
            {from.name} → {to.name}
          </span>
          <button type="button" onClick={() => setFormOpen(true)}>
            바꾸기
          </button>
        </div>
      )}
      <section className="rf-card rt-sec rt-search" hidden={formHidden || boot}>
        {DEV_TOOLS && <div className="tr-tabs" role="group" aria-label="경로 방식">
          {(
            [
              ['own', '자체 보행망'],
              ['tmap', 'TMAP 비교'],
            ] as const
          ).map(([id, label]) => (
            <button key={id} type="button" aria-pressed={engineMode === id} className={'tr-tab' + (engineMode === id ? ' on' : '')} onClick={() => setEngineMode(id)}>
              {label}
            </button>
          ))}
        </div>}
        <PlacePicker which="to" label="도착" value={to} k={k} allowCurrent={false} active={picking === 'to'} onChange={(p) => (setPairId(null), setTo(p), autoFromRef.current === 'pending' && void fillFromHere())} onPickMap={() => onPickRequest(picking === 'to' ? null : 'to')} preset={props.presetTo ?? undefined} onQuery={setDestQ} />
        <PlacePicker which="from" label="출발" value={from} k={k} allowCurrent active={picking === 'from'} onChange={(p) => (setPairId(null), cancelAuto(), setFrom(p))} onPickMap={() => (cancelAuto(), onPickRequest(picking === 'from' ? null : 'from'))} preset={props.presetFrom ?? undefined} pendingName={autoFrom === 'pending' || autoFrom === 'asking' ? '내 위치' : undefined} pendingNote={autoFrom === 'asking' ? '찾는 중…' : undefined} emptyText={autoFrom === 'failed' ? START_HINT : undefined} />
        <button type="button" className="rf-primary" disabled={!canRun} onClick={() => from && to && run(from, to, pairId, `${from.name} → ${to.name}`)}>
          {status === 'loading' ? '찾고 있어요…' : '길찾기'}
        </button>
      </section>

      {pairId && !pairsOpen && from && to ? (
        <div className="rt-pair-sum">
          <span className="rt-pair-name">
            {from.name} → {to.name}
          </span>
          <button type="button" onClick={() => (setPairsOpen(true), setFormOpen(true))}>
            경로 바꾸기
          </button>
        </div>
      ) : (
        showRecommended(destQ) && !boot && (formOpen || (!result && status !== 'loading')) && (
          <section className="rt-sec rt-recommend">
            <h3>추천 경로</h3>
            <ul className="rt-pairs">
              {DEMO_PAIRS.map((p) => (
                <li key={p.id}>
                  <button type="button" className={'lr rt-pair' + (pairId === p.id ? ' on' : '')} aria-pressed={pairId === p.id} onClick={() => choosePair(p)} disabled={status === 'loading'}>
                    <span className="lr-main">
                      <span className="lr-title rt-wrap">{stripId(p.fromName)} → {stripId(p.toName)}</span>
                    </span>
                    <span className="lr-chev" aria-hidden="true" />
                  </button>
                </li>
              ))}
            </ul>
          </section>
        )
      )}

      {status === 'loading' && (
        <p className="rf-notice" role="status">
          경로를 찾고 장애요소를 살펴보고 있어요…
        </p>
      )}
      {status === 'error' && (
        <Sentences as="p" className="rf-warn" role="alert">
          {error}
        </Sentences>
      )}

      {status === 'done' && result && activeCard && (
        <div ref={topRef} className="rt-top" aria-live="polite">
          <div className="rc-rail" role="group" aria-label="경로 고르기. 옆으로 넘기거나 좌우 화살표 키를 눌러요">
            <ul
              ref={railRef}
              className="rc-list rc-snap"
              onKeyDown={(e) => {
                const nx = stepCard(railIds, sel, e.key)
                if (!nx) return
                e.preventDefault()
                if (nx !== sel) pickCard(nx, true)
              }}
            >
              {railIds.map((id) => {
                if (id === 'bus') {
                  const sm = storedTransitSummary(pairId)
                  const ok = busState !== 'none'
                  return (
                    <RouteCard
                      key="bus"
                      id="bus"
                      on={sel === 'bus'}
                      disabled={!ok}
                      onPick={() => pickCard('bus')}
                      time={sm ? fmtMin(sm.time) : '버스 타고'}
                      sub={sm ? '버스 타고' : ok ? '버스 경로 찾기' : '이 경로는 버스 길을 볼 수 없어요'}
                    />
                  )
                }
                const c = cards.find((x) => x.id === id)
                if (!c) return null
                const sm = result.res.summary[c.id]
                return (
                  <RouteCard
                    key={c.id}
                    id={c.id}
                    on={sel === c.id}
                    onPick={() => pickCard(c.id)}
                    time={fmtMin(c.route.time)}
                    sub={`${fmtWalk(c.route.distance)} · ${c.title}`}
                    badges={
                      <>
                        {c.id === 'detour' && <Badge tone="blue">추천</Badge>}
                        <VerdictBadge v={sm?.verdict ?? 'pass'} />
                      </>
                    }
                  />
                )
              })}
            </ul>
            <p className="rc-hint" aria-hidden="true">
              옆으로 넘겨 보세요 · {railIds.indexOf(sel) + 1}/{railIds.length}
            </p>
          </div>

          {mode === 'bus' && <TransitView fitSeed={fitN} from={from} to={to} pairId={pairId} obstacles={obstaclesNow} onOverlay={setTransitOv} onOpenHit={openHit} />}
    
          {mode === 'walk' && <>
          {result.fallback && <Sentences as="p" className="rf-warn">이 구간은 길 자료가 부족해서 다른 방식으로 찾았어요. 장애요소를 다 피하지 못할 수 있어요.</Sentences>}
          {avoidedNames.length > 0 && (
            <p className="rt-avoid" role="status">
              <b>{avoidedNames.join(', ')}</b> 때문에 돌아가요
              <br />
              <span className="bm-meta">가장 짧은 길보다 {fmtDist(extraM)} 더 걸어요.</span>
            </p>
          )}
          {result.res.unresolved.length > 0 && (
            <p className="rt-alert" role="alert">
              <b>돌아갈 길이 없어요</b>
              <br />
              {result.res.unresolved.map((h) => obstacleName(h.o)).join(', ')}
              <br />
              이곳을 피하는 길을 찾지 못했어요.
            </p>
          )}
          {result.res.endpoint.length > 0 && (
            <p className="rt-warn" role="status">
              <b>출발·도착 지점 자체가 X예요</b>
              <br />
              {result.res.endpoint.map((h) => obstacleName(h.o)).join(', ')}. 길로 피할 수 없어서 돌아가지 않았어요.
            </p>
          )}
          {result.res.untested.length > 0 && <p className="rf-warn">돌아갈 수 있는지 확인하지 못한 곳: {result.res.untested.map((h) => obstacleName(h.o)).join(', ')}</p>}

          {(
            <>
              {result.own && steps.length > 0 ? (
                <>
                  <button type="button" className="rf-primary rt-g-start" onClick={startGuide}>
                    길 안내 시작
                  </button>
                  <p className="bm-meta">걷기 약 {fmtMin(activeCard.route.time)} · {fmtWalk(activeCard.route.distance)}</p>
                  <Tl>
                    {steps.map((st, i) => {
                      const tx = stepText(st)
                      return (
                        <TlStep key={i} color={st.kind === 'crossing' || st.kind === 'stairs' ? 'var(--text-sub)' : WALK_COLOR} title={<><span className="rt-s-glyph" aria-hidden="true">{stepGlyph(st)}</span> {tx.title}</>} sub={tx.sub} last={i === steps.length - 1} end={st.kind === 'arrive'}>
                          {st.notes.map((n, j) =>
                            n.kind === 'avoid' ? (
                              <p key={j} className="tl-note rt-s-avoid">
                                {obstacleName(n.o)} 때문에 돌아가요
                              </p>
                            ) : (
                              <button key={j} type="button" className="tl-hit tl-hit-end" onClick={() => openObstacle(n.o)}>
                                <span className="tl-hit-name">{obstacleName(n.o)}</span>
                                <span className="tl-hit-sub">{n.role === 'X' ? '지나가기 어려워요' : '지날 때 주의해요'}</span>
                              </button>
                            ),
                          )}
                          {st.kind === 'arrive' && finalSummary && finalSummary.entryDest.map((h) => (
                            <button key={h.o.id} type="button" className="tl-hit tl-hit-end" onClick={() => openHit(h)}>
                              <span className="tl-hit-name">{obstacleName(h.o)}</span>
                              <span className="tl-hit-sub">{h.o.rating === 'X' ? '들어가기 어려워요' : '들어갈 때 주의해요'}</span>
                            </button>
                          ))}
                        </TlStep>
                      )
                    })}
                  </Tl>
                </>
              ) : (
              <Tl>
                <TlStep color={WALK_COLOR} title={<>걷기 약 {fmtMin(activeCard.route.time)} · {fmtWalk(activeCard.route.distance)}</>} sub={result.start.name === result.end.name ? `${result.start.name} 근처` : `${result.start.name}에서 ${result.end.name}까지`} />
                {[...passHits]
                  .sort((x, y) => x.atM - y.atM)
                  .map((h) => (
                    <TlHit
                      key={h.o.id}
                      color={WALK_COLOR}
                      h={h}
                      onOpen={openHit}
                      where={h.atM < 30 ? '출발 지점' : `출발 후 ${fmtDist(h.atM)}`}
                      note={
                        <>
                          {unresolvedIds.has(h.o.id) && <b className="rt-noalt"> · 돌아갈 길이 없어요</b>}
                          {endpointIds.includes(h.o.id) && <b className="rt-noalt"> · 출발·도착 지점이라 피할 수 없어요</b>}
                        </>
                      }
                    />
                  ))}
                <TlStep color="var(--text-sub)" last end title="도착" sub={result.end.name}>
                  {finalSummary &&
                    finalSummary.entryDest.map((h) => (
                      <button key={h.o.id} type="button" className="tl-hit tl-hit-end" onClick={() => openHit(h)}>
                        <span className="tl-hit-name">{obstacleName(h.o)}</span>
                        <span className="tl-hit-sub">{h.o.rating === 'X' ? '들어가기 어려워요' : '들어갈 때 주의해요'}</span>
                      </button>
                    ))}
                </TlStep>
              </Tl>
              )}

              <details className="rt-more">
                <summary>자세히 보기</summary>
                <div className="rt-more-in">
                  {finalSummary && finalSummary.entryMid.length > 0 && (
                    <Sentences as="p" className="bm-meta">{`길 중간에 들어가기 불편한 건물 ${finalSummary.entryMid.length}곳이 있어요. 지나가는 데는 영향이 없어요.`}</Sentences>
                  )}
                  {finalSummary && finalSummary.stops.length > 0 && (
                    <section className="rt-sec">
                      <h3>버스 타기 불편한 정류장 {finalSummary.boardingCount}곳</h3>
                      <Sentences as="p" className="bm-meta">걸어서 지나가는 건 막히지 않아요. 이 정류장에서 버스를 타고 내리기가 불편하다는 뜻이에요.</Sentences>
                      <ul className="rt-hits">
                        {finalSummary.stops.map((s) => (
                          <li key={s.o.id}>
                            <button
                              type="button"
                              className="lr"
                              onClick={() => {
                                setCollapsed(true)
                                if (s.o.origin === 'report') onOpenReport(s.o.id)
                                else onOpenSeed(s.o.id)
                              }}
                            >
                              <i className="lr-glyph" style={{ background: ROLE_STYLE.B.color, color: inkOf(ROLE_STYLE.B) }}>
                                {ROLE_STYLE.B.glyph}
                              </i>
                              <span className="lr-main">
                                <span className="lr-title">{obstacleName(s.o)}</span>
                                <span className="lr-sub">
                                  {WHERE[s.where]} · {s.distM}m
                                </span>
                              </span>
                              <span className="lr-chev" aria-hidden="true" />
                            </button>
                          </li>
                        ))}
                      </ul>
                    </section>
                  )}
                  {stopsBlock}
                  {extrasBlock}
                </div>
              </details>
            </>
          )}
          </>}
        </div>
      )}
    </div>
    </>
  )
}

export type { Pt }
