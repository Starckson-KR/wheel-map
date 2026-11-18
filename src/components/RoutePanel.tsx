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
import { getWalkGraph } from '../lib/routing/walkData.ts'
import type { OwnRoute } from '../lib/routing/walkRoute.ts'
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
}) {
  const { label, value, k, allowCurrent, active, onChange, onPickMap, preset } = props
  const [q, setQ] = useState(preset ?? '')
  const presetDone = useRef(false)
  const [items, setItems] = useState<kakao.maps.services.PlaceResult[]>([])
  const [msg, setMsg] = useState('')
  const [outside, setOutside] = useState(false)
  const search = async (text = q) => {
    if (!k || !text.trim()) return
    setMsg('찾고 있어요…')
    const r = await keywordSearch(k, text.trim(), 5)
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
  useEffect(() => {
    if (!preset || !k || presetDone.current) return
    presetDone.current = true
    void search(preset)
    // 한 번만: 지도가 준비되면 목록을 띄운다
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [k])
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
      <p className="rt-val">{value ? <strong>{value.name}</strong> : <span className="bm-meta">아직 정하지 않았어요.</span>}</p>
      <div className="rt-row">
        <input
          type="search"
          value={q}
          placeholder="장소 이름 검색"
          aria-label={`${label} 장소 검색어`}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && search()}
        />
        <button type="button" onClick={() => search()} disabled={!k || !q.trim()}>
          검색
        </button>
      </div>
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
  const [to, setTo] = useState<Place | null>(null)
  const [pairId, setPairId] = useState<string | null>(null)
  const [status, setStatus] = useState<'idle' | 'loading' | 'done' | 'error'>('idle')
  const [error, setError] = useState('')
  const [result, setResult] = useState<Result | null>(null)
  const [active, setActive] = useState<'base' | 'detour'>('base')
  const [focus, setFocus] = useState<string | null>(null)
  const [chosen, setChosen] = useState(false) // 경로 카드를 골랐는가(고르면 그 경로만 보이고 단계별 안내가 나온다)
  const [fitN, setFitN] = useState(0)
  const [pairsOpen, setPairsOpen] = useState(false)
  const topRef = useRef<HTMLDivElement>(null)
  const [collapsed, setCollapsed] = useState(false)
  const [mode, setMode] = useState<'walk' | 'bus'>(props.initialMode ?? 'walk') // 걸어서 / 버스 타고(7단계)
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

  // 지도에서 고른 위치 반영
  const lastPicked = useRef(0)
  useEffect(() => {
    if (!picked || picked.n === lastPicked.current) return
    lastPicked.current = picked.n
    setPairId(null)
    if (picked.which === 'from') setFrom(picked.place)
    else setTo(picked.place)
    setCollapsed(false)
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
      setActive(res.detour ? 'detour' : 'base')
      setChosen(!res.detour)
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

  const pick = (v: boolean) => {
    setChosen(v)
    setFitN((n) => n + 1)
    requestAnimationFrame(() => topRef.current?.scrollIntoView({ block: 'start' }))
  }

  const choosePair = (p: DemoPair) => {
    setPairsOpen(false)
    const f: Place = { id: p.from.stopId, name: p.fromName, lat: p.from.lat, lng: p.from.lng }
    const t: Place = { id: p.to.stopId, name: p.toName, lat: p.to.lat, lng: p.to.lng }
    setFrom(f)
    setTo(t)
    setPairId(p.id)
    void run(f, t, p.id, `${p.fromName} → ${p.toName}`)
  }

  const cards: Card[] = useMemo(() => {
    if (!result?.res.base) return []
    const r = result.res
    const out: Card[] = [{ id: 'base', title: '가장 짧은 길', route: r.base as RouteData, hits: r.baseHits }]
    if (r.detour) out.push({ id: 'detour', title: result.own ? (r.unresolved.length > 0 ? '일부만 피해 가는 길' : '피해 가는 길') : r.unresolved.length + r.untested.length > 0 ? '일부만 돌아가는 길' : '돌아가는 길', route: r.detour, hits: r.detourHits })
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
      base: chosen && active !== 'base' ? null : (result.res.base?.coords ?? null),
      detour: chosen && active !== 'detour' ? null : (result.res.detour?.coords ?? null),
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
  }, [result, activeCard, perRoute, focus, unresolvedIds, mode, transitOv, chosen, active, fitN, guide, steps])

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
    <div className={'rp rt' + (picking ? ' rt-hidden' : '')} data-sheet role="dialog" aria-label="길찾기" hidden={!!picking || collapsed || !!guide}>
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

      {pairId && !pairsOpen && from && to ? (
        <div className="rt-pair-sum">
          <span className="rt-pair-name">
            {from.name} → {to.name}
          </span>
          <button type="button" onClick={() => setPairsOpen(true)}>
            경로 바꾸기
          </button>
        </div>
      ) : (
        <section className="rt-sec">
          <h3>시연 경로</h3>
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
      )}

      {(
        <section className="rf-card rt-sec">
          <h3>직접 검색{DEV_TOOLS ? ' (개발 모드)' : ''}</h3>
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
          <PlacePicker label="출발" value={from} k={k} allowCurrent active={picking === 'from'} onChange={(p) => (setPairId(null), setFrom(p))} onPickMap={() => onPickRequest(picking === 'from' ? null : 'from')} preset={props.presetFrom ?? undefined} />
          <PlacePicker label="도착" value={to} k={k} allowCurrent={false} active={picking === 'to'} onChange={(p) => (setPairId(null), setTo(p))} onPickMap={() => onPickRequest(picking === 'to' ? null : 'to')} preset={props.presetTo ?? undefined} />
          <button type="button" className="rf-primary" disabled={!canRun} onClick={() => from && to && run(from, to, pairId, `${from.name} → ${to.name}`)}>
            {status === 'loading' ? '찾고 있어요…' : '길찾기'}
          </button>
        </section>
      )}

      <div className="tr-tabs" role="tablist" aria-label="이동 방법">
        {(
          [
            ['walk', '걸어서'],
            ['bus', '버스 타고'],
          ] as const
        ).map(([id, label]) => (
          <button key={id} type="button" role="tab" aria-selected={mode === id} className={'tr-tab' + (mode === id ? ' on' : '')} onClick={() => setMode(id)}>
            {label}
          </button>
        ))}
      </div>

      {mode === 'bus' && <TransitView fitSeed={fitN} from={from} to={to} pairId={pairId} obstacles={obstaclesNow} onOverlay={setTransitOv} onOpenHit={openHit} />}

      {mode === 'walk' && status === 'loading' && (
        <p className="rf-notice" role="status">
          경로를 찾고 장애요소를 살펴보고 있어요…
        </p>
      )}
      {mode === 'walk' && status === 'error' && (
        <Sentences as="p" className="rf-warn" role="alert">
          {error}
        </Sentences>
      )}

      {mode === 'walk' && status === 'done' && result && activeCard && (
        <div ref={topRef} className="rt-top" aria-live="polite">
          {chosen && cards.length > 1 && (
            <button type="button" className="rt-back" onClick={() => pick(false)}>
              다른 경로 보기
            </button>
          )}
          <ul className="rc-list">
            {cards.map((c) => {
              if (chosen && c.id !== active) return null
              const sm = result.res.summary[c.id]
              return (
                <RouteCard
                  key={c.id}
                  on={chosen && active === c.id}
                  onPick={() => {
                    setActive(c.id)
                    pick(true)
                  }}
                  time={fmtMin(c.route.time)}
                  sub={`${fmtWalk(c.route.distance)} · ${c.title}`}
                  badges={
                    <>
                      {cards.length > 1 && c.id === finalId && <Badge tone="blue">추천</Badge>}
                      <VerdictBadge v={sm?.verdict ?? 'pass'} />
                    </>
                  }
                />
              )
            })}
          </ul>
    
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

          {chosen && (
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
        </div>
      )}
    </div>
    </>
  )
}

export type { Pt }
