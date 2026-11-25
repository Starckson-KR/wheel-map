import { obstacleName, stripId } from '../lib/display'
import { bareName, detourLine, summarizeAvoid, summarizeNear } from '../lib/routing/guideNotes'
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { ROUTE_CFG, ROUTE_OFF_ROUTE_M, WALK_CFG } from '../lib/config'
import { keywordSearch } from '../lib/kakao'
import { ROLE_STYLE } from '../lib/routing/roleStyle.ts'
import { isExpired } from '../lib/reportStore'
import { alongM, distToRoute, searchRoute, type Hit, type Obstacle, type Pt, type RouteData, type SearchResult } from '../lib/routing/engine.ts'
import { buildSteps, stepText, type Step, type Turn } from '../lib/routing/guide.ts'
import { autoStep } from '../lib/routing/followNav.ts'
import { searchOwn, type OwnSearch } from '../lib/routing/ownSearch.ts'
import { searchDelay, showRecommended } from '../lib/routing/searchUi.ts'
import { busCardState, cardOrder, initialCard, stepCard, type CardId } from '../lib/routing/cards.ts'
import { hasStoredNoRoute, hasStoredTransit, storedTransitSummary, TRANSIT_FREE_SEARCH } from '../lib/transit/provider.ts'
import { getWalkGraph } from '../lib/routing/walkData.ts'
import { nearWalkNet, type OwnRoute } from '../lib/routing/walkRoute.ts'
import { demoStartOf, pickStart, resolveStart, startPlan, START_HINT } from '../lib/routing/startPlace.ts'
import { hasGeo, locateOnce, readGeoPermission } from '../lib/routing/locateOnce.ts'
import { crosswalksOnRoute, loadExtras, type Extras } from '../lib/routing/extras.ts'
import { toiletAccessible } from '../lib/publicLayers'
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
import { WeatherBand } from './WeatherBits'
import { Badge, Tl, TlHit, TlStep, VerdictBadge } from './RouteUi'
import { fmtDist, fmtMin, WALK_COLOR } from './routeFmt'
import { isDesktopLayout } from '../lib/viewPrefs'
import { useWeather } from '../lib/weather/store'
import { isWet } from '../lib/weather/model'
import { isHot } from '../lib/layerPresets'
import { loadLayerPool } from '../lib/routing/layerData.ts'
import { alongRows, cardNotes, routeFacts, type LayerPool, type RouteFacts } from '../lib/routing/layerRoute.ts'
import Icon from './Icon'

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

type Card = { id: 'base' | 'detour'; route: RouteData; hits: Hit[] }
/** 결과 시트의 한 줄 알림(돌아가는 까닭·돌아갈 길 없음 등). 누르면 이름 목록이 열린다 */
type Why = { key: string; tone: 'alert' | 'avoid' | 'warn'; text: string; names: string[] }
type Guide = { idx: number; manual: boolean } // manual: 이전·다음을 눌러 직접 넘기는 중(내 위치로 자동 넘김 잠시 멈춤)

const TURN_GLYPH: Record<Turn, string> = { straight: '↑', 'slight-left': '↖', left: '←', 'sharp-left': '↙', 'slight-right': '↗', right: '→', 'sharp-right': '↘', uturn: '↩' }
const stepGlyph = (st: Step) => (st.kind === 'crossing' ? '↔' : st.kind === 'stairs' ? '▤' : st.kind === 'arrive' ? '●' : TURN_GLYPH[st.turn])
type Result = {
  res: SearchResult
  pair: string
  extras: Extras | null
  extrasError: boolean
  stats: NetStats
  own: OwnSearch | null // 자체 보행망으로 찾았으면 그 결과(턴바이턴·피해 간 곳). 저장 경로·개발용 TMAP 비교로 찾았으면 null
  fallback: boolean // 자체 보행망으로 못 찾아 다른 방식(저장 경로·개발용 TMAP)으로 넘어왔는가
  pool: LayerPool | null // 길찾기가 스스로 쓴 공공데이터(육교·침수·화장실·그늘막·정류장·스쿨존). 못 받았으면 null
  wet: boolean // 이 결과를 구할 때 비·눈이었는가(침수 이력을 경로 계산에 넣었는가)
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
  /** 값이 비어 있을 때 보이는 한 줄(없으면 줄을 두지 않는다) */
  emptyText?: string
  /** 한 줄로 접어 둔다(출발 칸) */
  fold?: boolean
}) {
  const { label, value, k, allowCurrent, active, onChange, onPickMap, preset, which, onQuery, pendingName, pendingNote, emptyText, fold } = props
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
    if (!k) {
      // 지도 SDK가 아직 오는 중이면 찾는 중으로 두고, 10초가 지나도 없을 때만 실패로 알린다
      setItems([])
      setOutside(false)
      setMsg('찾고 있어요…')
      const w = setTimeout(() => setMsg('검색하지 못했어요. 잠시 뒤에 다시 해 주세요.'), 10000)
      return () => clearTimeout(w)
    }
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
  // 접어 두는 칸(출발): 값이 있거나 내 위치를 기다리는 동안은 한 줄로만 보이고, 누르면 바꿀 수 있게 펼친다
  const [unfolded, setUnfolded] = useState(false)
  useEffect(() => {
    if (value) setUnfolded(false)
  }, [value])
  if (fold && !unfolded && (value || (pendingName && !preset))) {
    return (
      <button type="button" className="rt-fold" aria-expanded={false} aria-label={`${label} ${value?.name ?? pendingName}, 바꾸기`} onClick={() => setUnfolded(true)}>
        <span className="rt-fold-l">{label}</span>
        <strong>{value?.name ?? pendingName}</strong>
        {!value && pendingNote && <span className="bm-meta">{pendingNote}</span>}
        <span className="lr-chev" aria-hidden="true" />
      </button>
    )
  }
  return (
    <fieldset className="rt-place">
      <legend>{label}</legend>
      {(value || pendingName || emptyText) && (
        <p className="rt-val">{value ? <strong>{value.name}</strong> : pendingName ? <><strong>{pendingName}</strong>{pendingNote && <span className="bm-meta"> {pendingNote}</span>}</> : <span className="bm-meta">{emptyText}</span>}</p>
      )}
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
        <button type="button" onClick={onPickMap} aria-pressed={active} className={active ? 'on' : ''}>
          {active ? '지도를 눌러 주세요…' : '지도에서 선택'}
        </button>
        {allowCurrent && (
          <button type="button" onClick={current}>
            현재 위치
          </button>
        )}
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
  const [noLoc, setNoLoc] = useState(false) // 현재 위치를 못 얻어 출발지를 전남대로 둔 경우에만 한 줄 안내
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
  useEffect(() => () => clearTimeout(typingOff.current), [])
  const [typing, setTyping] = useState(false) // 입력칸에 커서가 있는 동안: 휴대폰에서는 시트를 키워 키보드에 가려지지 않게 한다
  const topRef = useRef<HTMLDivElement>(null)
  // 결과 시트: false=낮은 시트(지도가 넓게 보인다), true=펼침
  const [open, setOpen] = useState(false)
  const [whyOpen, setWhyOpen] = useState<string | null>(null)
  const [notesOpen, setNotesOpen] = useState<number | null>(null) // 주의 목록을 펼친 단계
  const [gMore, setGMore] = useState(false) // 길 안내 카드의 접어 둔 버튼
  const sheetRef = useRef<HTMLDivElement>(null)
  const pickRef = useRef<HTMLDivElement>(null)
  const grabY = useRef(0)
  const [lowH, setLowH] = useState(0)
  const [mode, setMode] = useState<'walk' | 'bus'>('walk') // 고른 카드가 버스 타고이면 'bus'
  const [transitOv, setTransitOv] = useState<RouteOverlay | null>(null)
  const [openStop, setOpenStop] = useState<string | null>(null)
  const runId = useRef(0)
  const weather = useWeather()
  const wet = weather ? isWet(weather) : false
  const hot = isHot(weather)
  const [engineMode, setEngineMode] = useState<'own' | 'tmap'>('own') // 개발 모드에서만 바꿀 수 있다(비교용)
  const [guide, setGuide] = useState<Guide | null>(null)
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
    setNoLoc(false)
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
      // 위치를 못 쓰거나 시범 지역 밖이면 패널을 띄우지 않고 전남대에서 바로 구하고, 그 사실을 한 줄로 알린다
      if (!f) {
        const d = pickStart(null, false, demoStartOf(DEMO_PAIRS))
        if (d) {
          f = d.place
          setFrom(d.place)
          setNoLoc(true)
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [picked])

  // keep: 같은 출발·도착을 날씨 때문에 다시 구할 때 — 화면은 그대로 두고 새 결과가 오면 바꿔 끼운다(깜빡임·카드 선택 초기화 방지)
  const run = async (f: Place, t: Place, pid: string | null, pairLabel: string, keep = false) => {
    const my = ++runId.current
    if (!keep) {
      setStatus('loading')
      setError('')
      setResult(null)
      setFocus(null)
      setGuide(null)
      setOffRoute(null)
      setOpen(false)
      setWhyOpen(null)
      setNotesOpen(null)
    }
    const stats = newStats()
    try {
      const citizen = reports.filter((r) => !r.seedId && SHOWN_ON_MAP.includes(r.status) && !isExpired(r))
      const obstacles = buildObstacles(barriers, seedRatings, citizen)
      // 1순위: 자체 보행망(키·서버 없이 브라우저 안에서 계산). 못 찾으면(보행망 밖·연결 끊김) 저장 경로 방식(개발 모드는 TMAP 중계)으로 넘어간다.
      let own: OwnSearch | null = null
      let pool: LayerPool | null = null
      let why: 'load' | 'outside' | 'no-path' = 'load'
      if (engineMode === 'own') {
        const [wg, lp] = await Promise.all([getWalkGraph(), loadLayerPool(wet).catch(() => null)])
        pool = lp
        if (wg) {
          const o = searchOwn(wg, [f.lat, f.lng], [t.lat, t.lng], obstacles, ROUTE_CFG, WALK_CFG, lp ? [...lp.overpass, ...lp.flood] : [])
          if (o.base) own = o
          else why = o.error === 'no-path' ? 'no-path' : 'outside'
        }
        // 배포판에는 TMAP 키가 없다: 자체 경로를 못 찾으면 짧은 안내만 보인다(개발 모드만 TMAP으로 넘어간다)
        if (!own && !DEV_TOOLS) {
          if (my !== runId.current || keep) return
          setStatus('error')
          setError(why === 'load' ? '길 자료를 불러오지 못했어요. 잠시 뒤에 다시 해 주세요.' : why === 'no-path' ? '두 곳을 잇는 길을 찾지 못했어요.' : '시범 지역 안에서만 길을 찾을 수 있어요.')
          return
        }
      }
      const res = own ? own.res : await searchRoute({ obstacles, cfg: ROUTE_CFG, fetchRoute: makeFetcher(pid, f, t, stats) })
      if (my !== runId.current) return
      if (!res.base) {
        if (keep) return
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
      setResult((prev) => ({ res, pair: pairLabel, extras, extrasError, stats, own, fallback: !own && engineMode === 'own', pool, wet, start: f, end: t, fitKey: keep && prev ? prev.fitKey : my }))
      if (keep) {
        setActive((a) => (a === 'detour' && !res.detour ? 'base' : a))
        return
      }
      const pick = initialCard(!!res.detour, props.initialMode === 'bus', hasStoredNoRoute(pid) ? 'none' : busCardState(hasStoredTransit(pid), TRANSIT_FREE_SEARCH))
      setMode(pick === 'bus' ? 'bus' : 'walk')
      setActive(pick === 'bus' ? (res.detour ? 'detour' : 'base') : pick)
      setFitN((n) => n + 1)
      setStatus('done')
    } catch {
      if (my === runId.current && !keep) {
        setStatus('error')
        setError('경로를 찾는 중에 문제가 생겼어요.')
      }
    }
  }

  // 펼치거나 낮추면 남은 지도 영역에 맞춰 경로를 다시 맞춘다
  useEffect(() => {
    setFitN((n) => n + 1)
  }, [open])

  // 경로를 고르면 그 길이 지도에 그려지고 펼친 시트에 단계별 안내가 나온다
  const pickCard = (id: CardId, focus = false) => {
    if (id === 'bus' && busState === 'none') return
    if (id === 'bus') setMode('bus')
    else {
      setMode('walk')
      setActive(id)
    }
    setNotesOpen(null)
    setFitN((n) => n + 1)
    if (focus) pickRef.current?.querySelector<HTMLElement>(`[data-card="${id}"]`)?.focus({ preventScroll: true })
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
    if (r.detour) out.push({ id: 'detour', route: r.detour, hits: r.detourHits })
    out.push({ id: 'base', route: r.base as RouteData, hits: r.baseHits })
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
    setGMore(false)
    setOffRoute(null)
    // 길 안내를 시작하면 내 위치를 가운데에 두고 따라간다(누른 동작 안에서 위치·나침반 권한을 요청한다)
    if (props.locMode !== 'follow') {
      startedLoc.current = props.locMode === 'off' || props.locMode === undefined
      props.onLocate?.()
    }
  }
  const endGuide = () => {
    setGuide(null)
    setOffRoute(null)
    setOpen(false)
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
    void run(f, result.end, null, `${f.name} → ${result.end.name}`)
  }
  const openObstacle = (o: Obstacle) => {
    setFocus(o.id)
    setOpen(false) // 낮은 시트는 상세 시트 아래에 남아, 상세를 닫으면 바로 다시 보인다
    if (o.origin === 'report') onOpenReport(o.id)
    else onOpenSeed(o.id)
  }

  const perRoute = useMemo(() => {
    const m = new Map<string, ReturnType<typeof crosswalksOnRoute>>()
    if (result?.extras) for (const c of cards) m.set(c.id, crosswalksOnRoute(c.route.coords, result.extras.crosswalkAll))
    return m
  }, [result, cards])

  // 길찾기가 스스로 쓰는 공공데이터 사실(육교·침수·가는 길의 화장실 등), 카드마다
  const facts = useMemo(() => {
    const m = new Map<string, RouteFacts>()
    if (result?.pool) for (const c of cards) m.set(c.id, routeFacts(c.route.coords, result.pool))
    return m
  }, [result, cards])
  const baseFacts = facts.get('base')
  // 날씨가 바뀌면(시연 도구 포함) 침수 이력을 넣을지가 달라지므로 같은 길을 다시 구한다
  useEffect(() => {
    if (status !== 'done' || !result || result.wet === wet || guide) return
    void run(result.start, result.end, pairId, result.pair, true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wet, status, guide])

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
    // 길찾기가 쓴 지점만 작게 표시(가는 길의 화장실·그늘막·정류장, 지나는 육교·침수 이력)
    const f = facts.get(activeCard.id)
    if (f) {
      const seen = new Set(markers.map((m) => `${m.lat},${m.lng}`))
      const add = (lat: number, lng: number, text: string, title: string, cls: string) => {
        const k = `${lat},${lng}`
        if (seen.has(k)) return
        seen.add(k)
        markers.push({ lat, lng, text, title, cls })
      }
      for (const x of f.toilet.items) add(x.item.lat, x.item.lng, '화장실', x.item.name, 'rt-m-toilet')
      if (hot) for (const x of f.shade.items) add(x.item.lat, x.item.lng, '그늘막', x.item.name, 'rt-m-shade')
      for (const x of f.stop.items) add(x.item.lat, x.item.lng, '정류장', x.item.name, 'rt-m-bus')
      for (const o of f.overpass) add(o.lat, o.lng, '육교', '육교', 'rt-m-overpass')
      for (const o of f.flood) add(o.lat, o.lng, '침수', '침수 이력', 'rt-m-flood')
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
  }, [result, activeCard, perRoute, facts, focus, unresolvedIds, mode, transitOv, active, fitN, guide, steps, hot])

  useEffect(() => () => onOverlay(null), []) // eslint-disable-line react-hooks/exhaustive-deps

  const openHit = (h: Hit) => {
    setFocus(h.o.id)
    setOpen(false)
    if (h.o.origin === 'report') onOpenReport(h.o.id)
    else onOpenSeed(h.o.id)
  }

  const passHits = activeCard ? activeCard.hits.filter((h) => h.role !== 'B' && h.role !== 'E') : []
  const canRun = !!from && !!to && status !== 'loading'

  const inkOf = (st: { color: string }) => (st as { ink?: string }).ink ?? '#fff'
  const WHERE: Record<'route' | 'start' | 'end', string> = { route: '경로 위', start: '출발 근처', end: '도착 근처' }

  const sel: CardId = mode === 'bus' ? 'bus' : active
  const busState = hasStoredNoRoute(pairId) ? 'none' : busCardState(hasStoredTransit(pairId), TRANSIT_FREE_SEARCH)
  // 한 줄 고르기에는 고를 수 있는 것만 둔다(버스 길을 볼 수 없는 경로면 버스는 뺀다)
  const picks = cardOrder(!!result?.res.detour).filter((id) => id !== 'bus' || busState !== 'none')
  const pickLabel = (id: CardId): string => {
    if (id === 'bus') {
      const sm = storedTransitSummary(pairId)
      return sm ? `버스 ${fmtMin(sm.time)}` : '버스'
    }
    const c = cards.find((x) => x.id === id)
    const name = id === 'base' ? '짧은 길' : result?.own ? '피해 가는 길' : '돌아가는 길'
    return c ? `${name} ${fmtMin(c.route.time)}` : name
  }
  // 고른 길의 배지: 「피했어요」(초록)와 지나는 곳 수(주황)
  const chips = (() => {
    const cur = facts.get(active)
    if (mode !== 'walk' || !cur || !baseFacts) return null
    const n = cardNotes(cur, baseFacts, active === 'base')
    if (n.avoided.length === 0 && n.passes.overpass === 0 && n.passes.flood === 0) return null
    return (
      <p className="rc-chips">
        {n.avoided.includes('overpass') && <Badge tone="green">육교 피했어요</Badge>}
        {n.avoided.includes('flood') && <Badge tone="green">침수 이력 피했어요</Badge>}
        {n.passes.overpass > 0 && <Badge tone="orange">육교 {n.passes.overpass}곳</Badge>}
        {n.passes.flood > 0 && <Badge tone="orange">침수 이력 {n.passes.flood}곳</Badge>}
      </p>
    )
  })()
  // 가는 길에 있는 곳: 그늘막은 더운 날에만, 정류장 수는 아래 「가까운 정류장」과 겹쳐 뺀다
  const alongBlock = (() => {
    const f = facts.get(active)
    const rows = (f ? alongRows(f) : []).filter((r) => r.key !== 'stop' && (r.key !== 'shade' || hot))
    if (rows.length === 0) return null
    return (
      <section className="rt-sec rc-near">
        <h3>가는 길에 있어요</h3>
        <ul>
          {rows.map((r) => (
            <li key={r.key}>
              <i className={'rc-near-ic rc-near-' + r.key} aria-hidden="true"><Icon name={r.icon} size={14} /></i>
              <span className="rc-near-t">{r.label}</span>
              {r.sub && <span className="rc-near-s">{r.sub}</span>}
            </li>
          ))}
        </ul>
      </section>
    )
  })()
  const finalId: 'base' | 'detour' = result?.res.detour ? 'detour' : 'base'
  const finalSummary = result?.res.summary[finalId] ?? null

  // 돌아가는 까닭·돌아갈 길 없음은 한 줄씩만. 낮은 시트에는 맨 앞 한 줄만 보인다
  const whys: Why[] = []
  if (result && mode === 'walk') {
    const r = result.res
    const namesOf = (hs: Hit[]) => hs.map((h) => bareName(obstacleName(h.o)))
    if (r.unresolved.length > 0) whys.push({ key: 'none', tone: 'alert', text: `돌아갈 길이 없어요 · ${r.unresolved.length}곳`, names: namesOf(r.unresolved) })
    const dl = active === 'detour' ? detourLine(avoidedNames, extraM > 0 ? fmtDist(extraM) : null) : null
    if (dl) whys.push({ key: 'avoid', tone: 'avoid', text: dl, names: avoidedNames.length > 1 ? avoidedNames.map(bareName) : [] })
    if (r.endpoint.length > 0) whys.push({ key: 'end', tone: 'warn', text: `출발·도착 지점에 지나기 어려운 곳 ${r.endpoint.length}곳`, names: namesOf(r.endpoint) })
    if (r.untested.length > 0) whys.push({ key: 'untested', tone: 'warn', text: `돌아갈 수 있는지 확인 못 한 곳 ${r.untested.length}곳`, names: namesOf(r.untested) })
  }

  const hasResult = status === 'done' && !!result && !!activeCard
  // 낮은 시트: 결과가 나온 직후의 기본. 큰 화면은 왼쪽 패널이라 늘 펼쳐 둔다
  const low = hasResult && !open && formHidden && !isDesktopLayout()
  const expand = () => setOpen(true)
  const lower = () => {
    setOpen(false)
    setFormOpen(false)
    setPairsOpen(false)
  }
  const canGuide = mode === 'walk' && !!result?.own && steps.length > 0

  // 내 위치 버튼을 낮은 시트 바로 위에 두려고 시트 높이를 잰다
  useLayoutEffect(() => {
    setLowH(low && sheetRef.current ? sheetRef.current.offsetHeight : 0)
  }, [low, result, active, mode, picking, guide])

  const stopGroups = result?.extras
    ? (
        [
          ['출발', result.extras.stops.start],
          ['도착', result.extras.stops.end],
        ] as const
      ).filter(([, list]) => list.length > 0)
    : []
  const stopsBlock = stopGroups.length > 0 && (
    <section className="rt-sec">
      <h3>가까운 정류장</h3>
      {stopGroups.map(([lab, list]) => (
        <div key={lab}>
          <p>
            <b>{lab}</b>
          </p>
          <ul className="rt-plain">
            {list.slice(0, 5).map((s) => {
              const key = lab + s.item.id
              const on = openStop === key
              return (
                <li key={key}>
                  <button type="button" className="bus-dir" aria-expanded={on} onClick={() => setOpenStop(on ? null : key)}>
                    {s.item.name} · {s.distM}m{s.item.fields['NEXT_BUSSTOP'] ? ` · ${String(s.item.fields['NEXT_BUSSTOP'])} 방면` : ''}
                  </button>
                  {on && (
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
        </div>
      ))}
    </section>
  )

  // 횡단보도·목적지 자료는 값이 있을 때만 구역을 만든다
  const noCurb = activeCard ? (perRoute.get(activeCard.id)?.noCurb ?? []) : []
  const destToilets = result?.extras ? result.extras.dest.toilets.filter((t) => toiletAccessible(t.item)) : []
  const destFacilities = result?.extras?.dest.facilities ?? []
  const extrasBlock = result && (
    <>
      {result.extrasError && <p className="rf-warn">공공데이터를 불러오지 못했어요.</p>}
      {noCurb.length > 0 && (
        <section className="rt-sec">
          <h3>보도턱 낮춤이 없는 횡단보도 {noCurb.length}곳</h3>
          <ul className="rt-plain">
            {noCurb.map((c, i) => (
              <li key={`${c.item.id}-${i}`}>
                {c.item.name} · {c.distM}m
              </li>
            ))}
          </ul>
        </section>
      )}
      {destToilets.length > 0 && (
        <section className="rt-sec">
          <h3>목적지 장애인화장실 {destToilets.length}곳</h3>
          <ul className="rt-plain">
            {destToilets.slice(0, 4).map((t, i) => (
              <li key={`${t.item.id}-${i}`}>
                {t.item.name} · {t.distM}m
              </li>
            ))}
          </ul>
        </section>
      )}
      {destFacilities.length > 0 && (
        <section className="rt-sec">
          <h3>목적지 장애인편의시설 {destFacilities.length}곳</h3>
          <ul className="rt-plain">
            {destFacilities.slice(0, 6).map((f, i) => (
              <li key={`${f.item.id}-${i}`}>
                {f.item.name} · {f.distM}m
                {f.item.fields['evalInfo'] ? (
                  <>
                    <br />
                    <span className="bm-meta">{String(f.item.fields['evalInfo'])}</span>
                  </>
                ) : null}
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  )

  const locBtn = props.onLocate && (
    <button
      type="button"
      className={'hm-locate rt-locate' + (low ? ' rt-locate-low' : '') + (hasResult ? '' : ' rt-locate-in') + (props.locMode === 'follow' ? ' on' : props.locMode === 'free' ? ' free' : '')}
      style={low && lowH > 0 ? { bottom: lowH + 12 } : undefined}
      onClick={props.onLocate}
      aria-pressed={props.locMode !== undefined && props.locMode !== 'off'}
      aria-label={props.locMode === 'follow' ? '내 위치 따라가기 끄기' : props.locMode === 'free' ? '내 위치로 돌아가 따라가기' : '내 위치로 이동'}
      hidden={!!picking || !!guide}
    >
      내 위치
    </button>
  )

  // 길 안내 중에도 시트는 숨겨서 남겨 둔다(지도의 경로 선은 시트가 정한다)
  const gStep = guide ? steps[guide.idx] : undefined
  const gText = gStep ? stepText(gStep) : null
  // 주의 안내는 종류별 한 줄씩만: 제보가 많은 구간에서 줄이 지도를 덮지 않게 한다
  const gAvoid = gStep ? summarizeAvoid(gStep.notes.filter((n) => n.kind === 'avoid').map((n) => obstacleName(n.o))) : null
  const gNear = gStep ? summarizeNear(gStep.notes.filter((n) => n.kind !== 'avoid').map((n) => obstacleName(n.o))) : null
  const gLeft = gStep && activeCard ? Math.max(0, Math.round(activeCard.route.distance - gStep.startM)) : 0
  const gFollowing = props.locMode === 'follow' && !guide?.manual
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
      {gAvoid && <p className="rt-g-note">{gAvoid}</p>}
      {gNear && <p className="rt-g-note rt-g-warn">{gNear}</p>}
      {offRoute && (
        <p className="rt-g-note rt-g-warn" role="alert">
          길에서 벗어났어요.{' '}
          <button type="button" className="rt-g-link" onClick={reroute}>
            여기서 다시 찾기
          </button>
        </p>
      )}
      <p className="rt-g-meta">
        남은 거리 {fmtDist(gLeft)}
        {/* 지도를 옮겼거나 단계를 손으로 넘겼을 때만: 다시 내 위치를 따라간다 */}
        {!gFollowing && (
          <button type="button" className="rt-g-link" onClick={recenter}>
            {props.locMode === 'off' || props.locMode === undefined ? '내 위치 따라가기' : '다시 가운데로'}
          </button>
        )}
      </p>
      <div className="rt-g-btns">
        <button type="button" className="rf-primary rt-g-next" onClick={() => setGuide({ idx: Math.min(steps.length - 1, guide.idx + 1), manual: true })} disabled={guide.idx >= steps.length - 1}>
          다음
        </button>
        <button type="button" onClick={endGuide}>
          끝내기
        </button>
        <button type="button" className="rt-g-more" aria-expanded={gMore} aria-label="더 보기" onClick={() => setGMore(!gMore)}>
          <span aria-hidden="true">⋯</span>
        </button>
      </div>
      {gMore && (
        <div className="rt-g-btns">
          <button type="button" onClick={() => setGuide({ idx: Math.max(0, guide.idx - 1), manual: true })} disabled={guide.idx === 0}>
            이전
          </button>
          {gFollowing && (
            <button type="button" onClick={() => props.onStopLocate?.()}>
              내 위치 따라가기 끄기
            </button>
          )}
        </div>
      )}
    </div>
  )

  const noteBtn = (n: Extract<Step['notes'][number], { kind: 'hit' }>, key: number) => (
    <button key={key} type="button" className="tl-hit tl-hit-end" onClick={() => openObstacle(n.o)}>
      <span className="tl-hit-name">{bareName(obstacleName(n.o))}</span>
      <span className="tl-hit-sub">{n.role === 'X' ? '지나가기 어려워요' : '지날 때 주의해요'}</span>
    </button>
  )
  const entryBtns =
    finalSummary &&
    finalSummary.entryDest.map((h) => (
      <button key={h.o.id} type="button" className="tl-hit tl-hit-end" onClick={() => openHit(h)}>
        <span className="tl-hit-name">{bareName(obstacleName(h.o))}</span>
        <span className="tl-hit-sub">{h.o.rating === 'X' ? '들어가기 어려워요' : '들어갈 때 주의해요'}</span>
      </button>
    ))

  return (
    <>
    {locBtn}
    {guidePanel}
    <div
      ref={sheetRef}
      className={'rp rt' + (picking ? ' rt-hidden' : '') + (typing ? ' rt-typing' : '') + (low ? ' rt-low' : '') + (hasResult ? '' : ' rt-input')}
      data-sheet
      role="dialog"
      aria-label="길찾기"
      hidden={!!picking || !!guide}
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
      {hasResult ? (
        // 손잡이: 끌어도 되고 눌러도 된다(끈 뒤에 따라오는 클릭은 누르기로 보지 않는다)
        <div
          className="rt-grab"
          onPointerDownCapture={(e) => (grabY.current = e.clientY)}
          onClick={(e) => {
            if ((e.target as Element).closest('button') || Math.abs(e.clientY - grabY.current) > 6) return
            if (low) expand()
            else lower()
          }}
        >
          <SheetHandle exit={false} onUp={low ? expand : undefined} onDown={low ? undefined : lower} expanded={!low} onToggle={low ? expand : lower} />
        </div>
      ) : (
        <SheetHandle onDown={onClose} />
      )}
      {!hasResult && (
        <div className="rf-head">
          <h2>길찾기</h2>
          <button type="button" className="bm-close" onClick={onClose}>
            닫기
          </button>
        </div>
      )}

      {hasResult && result && activeCard && (
        <>
          <div className="rt-sum" aria-live="polite">
            <p className="rt-sum-main">
              {mode === 'bus' ? (
                <strong>{pickLabel('bus')}</strong>
              ) : (
                <>
                  <strong>{fmtMin(activeCard.route.time)}</strong>
                  <span className="rt-sum-dist">· {fmtWalk(activeCard.route.distance)}</span>
                  <VerdictBadge v={result.res.summary[activeCard.id]?.verdict ?? 'pass'} />
                </>
              )}
            </p>
            {canGuide && (
              <button type="button" className="rf-primary rt-g-start" onClick={startGuide}>
                길 안내 시작
              </button>
            )}
            {mode === 'bus' && low && (
              <button type="button" className="rt-g-start" onClick={expand}>
                자세히
              </button>
            )}
            <button type="button" className="bm-close" onClick={onClose}>
              닫기
            </button>
          </div>
          {(whys.length > 0 || picks.length > 1) && (
          <div className="rt-head">
          {(low ? whys.slice(0, 1) : whys).map((w) => {
            const on = !low && whyOpen === w.key
            const cls = 'rt-why rt-why-' + w.tone
            if (!low && w.names.length === 0)
              return (
                <p key={w.key} className={cls} role={w.tone === 'alert' ? 'alert' : undefined}>
                  {w.text}
                </p>
              )
            return (
              <div key={w.key} className="rt-why-box">
                <button
                  type="button"
                  className={cls}
                  aria-expanded={on}
                  onClick={() => {
                    if (low) {
                      expand()
                      setWhyOpen(w.names.length > 0 ? w.key : null)
                    } else setWhyOpen(on ? null : w.key)
                  }}
                >
                  <span>{w.text}</span>
                  <span className={'rt-chev' + (on ? ' on' : '')} aria-hidden="true" />
                </button>
                {on && (
                  <ul className="rt-why-list">
                    {w.names.map((n, i) => (
                      <li key={i}>{n}</li>
                    ))}
                  </ul>
                )}
              </div>
            )
          })}
          {picks.length > 1 && (
            <div
              ref={pickRef}
              className="rt-pick"
              role="group"
              aria-label="경로 고르기"
              onKeyDown={(e) => {
                const nx = stepCard(picks, sel, e.key)
                if (!nx) return
                e.preventDefault()
                if (nx !== sel) pickCard(nx, true)
              }}
            >
              {picks.map((id) => (
                <button key={id} type="button" data-card={id} aria-pressed={sel === id} className={sel === id ? 'on' : ''} onClick={() => pickCard(id)}>
                  {pickLabel(id)}
                </button>
              ))}
            </div>
          )}
          </div>
          )}
        </>
      )}

      {boot && <p className="rf-notice" role="status">내 위치를 찾고 있어요…</p>}
      {formHidden && !pairId && from && to && (
        <div className="rt-pair-sum" hidden={low}>
          <span className="rt-pair-name">
            {from.name} → {to.name}
            {noLoc && <span className="bm-meta rt-noloc" role="status">현재 위치를 못 찾았어요</span>}
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
        <PlacePicker which="from" label="출발" fold value={from} k={k} allowCurrent active={picking === 'from'} onChange={(p) => (setPairId(null), cancelAuto(), setFrom(p))} onPickMap={() => (cancelAuto(), onPickRequest(picking === 'from' ? null : 'from'))} preset={props.presetFrom ?? undefined} pendingName={autoFrom === 'pending' || autoFrom === 'asking' ? '내 위치' : undefined} pendingNote={autoFrom === 'asking' ? '찾는 중…' : undefined} emptyText={autoFrom === 'failed' ? START_HINT : undefined} />
        {noLoc && <p className="bm-meta rt-noloc" role="status">현재 위치를 못 찾았어요</p>}
        <PlacePicker which="to" label="도착" value={to} k={k} allowCurrent={false} active={picking === 'to'} onChange={(p) => (setPairId(null), setTo(p), autoFromRef.current === 'pending' && void fillFromHere())} onPickMap={() => onPickRequest(picking === 'to' ? null : 'to')} preset={props.presetTo ?? undefined} onQuery={setDestQ} />
        <button type="button" className="rf-primary" disabled={!canRun} onClick={() => from && to && run(from, to, pairId, `${from.name} → ${to.name}`)}>
          {status === 'loading' ? '찾고 있어요…' : '길찾기'}
        </button>
      </section>

      {pairId && !pairsOpen && from && to ? (
        <div className="rt-pair-sum" hidden={low}>
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

      {hasResult && result && activeCard && (
        <div ref={topRef} className="rt-top" hidden={low}>
          <WeatherBand floodCount={result.wet && wet ? (baseFacts?.flood.length ?? 0) : 0} />
          {chips}

          {mode === 'bus' && <TransitView fitSeed={fitN} from={from} to={to} pairId={pairId} obstacles={obstaclesNow} onOverlay={setTransitOv} onOpenHit={openHit} />}

          {mode === 'walk' && <>
          {result.fallback && <Sentences as="p" className="rf-warn">이 구간은 길 자료가 부족해서 다른 방식으로 찾았어요. 장애요소를 다 피하지 못할 수 있어요.</Sentences>}

              {result.own && steps.length > 0 ? (
                  <Tl>
                    {steps.map((st, i) => {
                      const tx = stepText(st)
                      const near = st.notes.filter((n) => n.kind === 'hit')
                      const on = notesOpen === i
                      return (
                        <TlStep key={i} color={st.kind === 'crossing' || st.kind === 'stairs' ? 'var(--text-sub)' : WALK_COLOR} title={<><span className="rt-s-glyph" aria-hidden="true">{stepGlyph(st)}</span> {tx.title}</>} sub={tx.sub} last={i === steps.length - 1} end={st.kind === 'arrive'}>
                          {near.length === 1 && noteBtn(near[0], 0)}
                          {near.length > 1 && (
                            <>
                              <button type="button" className="tl-more" aria-expanded={on} onClick={() => setNotesOpen(on ? null : i)}>
                                <span>{summarizeNear(near.map((n) => obstacleName(n.o)))}</span>
                                <span className={'rt-chev' + (on ? ' on' : '')} aria-hidden="true" />
                              </button>
                              {on && near.map(noteBtn)}
                            </>
                          )}
                          {st.kind === 'arrive' && entryBtns}
                        </TlStep>
                      )
                    })}
                  </Tl>
              ) : (
              <Tl>
                <TlStep color={WALK_COLOR} title="출발" sub={result.start.name} />
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
                  {entryBtns}
                </TlStep>
              </Tl>
              )}

              <details className="rt-more">
                <summary>자세히 보기</summary>
                <div className="rt-more-in">
                  {alongBlock}
                  {finalSummary && finalSummary.stops.length > 0 && (
                    <section className="rt-sec">
                      <h3>타고 내리기 불편한 정류장 {finalSummary.boardingCount}곳</h3>
                      <ul className="rt-hits">
                        {finalSummary.stops.map((s) => (
                          <li key={s.o.id}>
                            <button
                              type="button"
                              className="lr"
                              onClick={() => {
                                setOpen(false)
                                if (s.o.origin === 'report') onOpenReport(s.o.id)
                                else onOpenSeed(s.o.id)
                              }}
                            >
                              <i className="lr-glyph" style={{ background: ROLE_STYLE.B.color, color: inkOf(ROLE_STYLE.B) }}>
                                {ROLE_STYLE.B.glyph}
                              </i>
                              <span className="lr-main">
                                <span className="lr-title">{bareName(obstacleName(s.o))}</span>
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
          </>}
        </div>
      )}
    </div>
    </>
  )
}

export type { Pt }
