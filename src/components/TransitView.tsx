import { useEffect, useMemo, useRef, useState } from 'react'
import { obstacleName } from '../lib/display'
import { ROUTE_CFG } from '../lib/config'
import { boardingNear, worstOf, type BoardingWarn } from '../lib/bus/boarding.ts'
import { loadBisStops, PILOT_STOPS } from '../lib/bus/data.ts'
import { matchBisStop, stopsNear, type BisStop } from '../lib/bus/stops.ts'
import { analyze, searchRoute, verdictOf, type Hit, type Obstacle, type Pt, type RouteData, type Verdict } from '../lib/routing/engine.ts'
import type { RouteOverlay } from '../lib/routing/overlay.ts'
import { makeFetcher, newStats, type Place } from '../lib/routing/provider.ts'
import { ROLE_STYLE } from '../lib/routing/roleStyle.ts'
import type { TItinerary, TLeg } from '../lib/transit/parse.ts'
import { fetchTransit, hasStoredTransit, TRANSIT_FREE_SEARCH } from '../lib/transit/provider.ts'
import BusArrivals from './BusArrivals'

type StopInfo = { name: string; lat: number; lng: number; bis: (BisStop & { distM: number }) | null; warns: BoardingWarn[] }
type ALeg = {
  leg: TLeg
  kind: 'walk' | 'bus'
  coords: Pt[]
  distance: number
  time: number
  hits: Hit[]
  verdict: Verdict
  detoured: boolean
  unresolved: string[]
  board?: StopInfo
  alight?: StopInfo
}
type AItin = { raw: TItinerary; legs: ALeg[]; verdict: Verdict; reasons: string[]; hasXStop: boolean }

const PILL: Record<Verdict, string> = { pass: '괜찮음', caution: '주의', blocked: '어려움' }
const RANK: Record<Verdict, number> = { pass: 0, caution: 1, blocked: 2 }
const fmtDist = (m: number) => (m >= 1000 ? `${(m / 1000).toFixed(1)}km` : `${Math.round(m)}m`)
const fmtMin = (s: number) => `${Math.max(1, Math.round(s / 60))}분`

type Props = {
  from: Place | null
  to: Place | null
  pairId: string | null
  obstacles: Obstacle[]
  onOverlay: (o: RouteOverlay | null) => void
  onOpenHit: (h: Hit) => void
}

const stopInfo = (s: { name: string; lat: number; lng: number }, next: string | undefined, bis: BisStop[], obstacles: Obstacle[]): StopInfo => {
  const m = matchBisStop(s, next, bis)
  const warns = boardingNear(obstacles, [s.lat, s.lng])
  if (m) for (const w of boardingNear(obstacles, [m.stop.lat, m.stop.lng])) if (!warns.some((x) => x.id === w.id)) warns.push(w)
  return { name: s.name, lat: s.lat, lng: s.lng, bis: m ? { ...m.stop, distM: m.distM } : null, warns }
}

// 걸어가는 구간: 기존 엔진(장애요소 검사·우회)을 그대로 쓴다. 저장본이 없는 우회 조합은 배포판에서 확인하지 못한다.
async function analyzeWalk(leg: TLeg, obstacles: Obstacle[], isFirst: boolean, isLast: boolean, from: Place, to: Place): Promise<Omit<ALeg, 'leg' | 'kind'>> {
  const r = ROUTE_CFG.radiusM
  const base: RouteData = { distance: leg.distance, time: leg.time, coords: leg.coords }
  if (leg.distance < 10 || leg.coords.length < 2) return { coords: leg.coords, distance: leg.distance, time: leg.time, hits: [], verdict: 'pass', detoured: false, unresolved: [] }
  const walkHits = (h: Hit[]) => h.filter((x) => x.role === 'X' || x.role === 'T' || x.role === 'Z')
  const first = analyze(leg.coords, obstacles, r)
  if (!first.some((h) => h.role === 'X')) {
    return { coords: leg.coords, distance: leg.distance, time: leg.time, hits: walkHits(first), verdict: verdictOf(walkHits(first)), detoured: false, unresolved: [] }
  }
  // 지나가기 어려운 곳(X)이 있으면 우회를 시도한다(요청 수를 아끼려고 한 구간당 최대 3번).
  const stats = newStats()
  const a: Place = isFirst ? from : { name: leg.from.name, lat: leg.from.lat, lng: leg.from.lng }
  const b: Place = isLast ? to : { name: leg.to.name, lat: leg.to.lat, lng: leg.to.lng }
  const fetcher = makeFetcher(null, a, b, stats)
  const res = await searchRoute({
    obstacles,
    cfg: { ...ROUTE_CFG, maxAttempts: 4 },
    fetchRoute: async (via, opt) => (via.length === 0 && !opt ? base : fetcher(via, opt)),
  })
  const route = res.detour ?? res.base ?? base
  const hits = walkHits(res.detour ? res.detourHits : res.baseHits)
  const ignore = res.endpoint.map((h) => h.o.id)
  return {
    coords: route.coords,
    distance: route.distance,
    time: route.time,
    hits,
    verdict: verdictOf(hits, ignore),
    detoured: !!res.detour,
    unresolved: res.unresolved.map((h) => h.o.id),
  }
}

async function analyzeItin(it: TItinerary, obstacles: Obstacle[], bis: BisStop[], from: Place, to: Place): Promise<AItin> {
  const legs: ALeg[] = []
  const last = it.legs.length - 1
  for (let i = 0; i < it.legs.length; i++) {
    const leg = it.legs[i]
    if (leg.mode === 'WALK') {
      if (leg.distance < 1) continue // 환승 때 같은 정류장에서 0m 걷기
      legs.push({ leg, kind: 'walk', ...(await analyzeWalk(leg, obstacles, i === 0, i === last, from, to)) })
    } else {
      const st = leg.stations ?? []
      const board = st.length > 0 ? stopInfo(st[0], st[1]?.name, bis, obstacles) : stopInfo({ ...leg.from }, undefined, bis, obstacles)
      const alight = st.length > 0 ? stopInfo(st[st.length - 1], undefined, bis, obstacles) : stopInfo({ ...leg.to }, undefined, bis, obstacles)
      legs.push({ leg, kind: 'bus', coords: leg.coords, distance: leg.distance, time: leg.time, hits: [], verdict: 'pass', detoured: false, unresolved: [], board, alight })
    }
  }
  const reasons: string[] = []
  let v: Verdict = 'pass'
  let hasXStop = false
  const bump = (n: Verdict) => {
    if (RANK[n] > RANK[v]) v = n
  }
  for (const l of legs) {
    if (l.kind === 'walk') {
      bump(l.verdict)
      if (l.unresolved.length > 0) reasons.push('걷는 길에 돌아갈 수 없는 어려운 곳이 있어요')
      else if (l.verdict !== 'pass') reasons.push('걷는 길에 주의할 곳이 있어요')
    } else {
      for (const [lab, s] of [['타는', l.board], ['내리는', l.alight]] as const) {
        const w = worstOf(s?.warns ?? [])
        if (w === 'X') {
          bump('blocked')
          hasXStop = true
          reasons.push(lab === '타는' ? `타는 정류장(${s?.name})은 휠체어 탑승이 어려워요` : `내리는 정류장(${s?.name})은 휠체어로 내리기 어려워요`)
        } else if (w === 'T') {
          bump('caution')
          reasons.push(`${lab} 정류장(${s?.name})은 주의가 필요해요`)
        }
      }
    }
  }
  return { raw: it, legs, verdict: v, reasons: [...new Set(reasons)], hasXStop }
}

const ratingLabel = (r: Obstacle['rating'] | undefined) => (r === 'O' ? '○ 괜찮음' : r === 'TRIANGLE' ? '△ 주의' : r === 'X' ? 'X 어려움' : '평가 없음')

export default function TransitView({ from, to, pairId, obstacles, onOverlay, onOpenHit }: Props) {
  const [status, setStatus] = useState<'idle' | 'loading' | 'done' | 'error'>('idle')
  const [message, setMessage] = useState('')
  const [items, setItems] = useState<AItin[]>([])
  const [sel, setSel] = useState(0)
  const [info, setInfo] = useState('')
  const [bis, setBis] = useState<BisStop[]>([])
  const run = useRef(0)
  const fitKey = useRef(0)
  const obsRef = useRef(obstacles)
  obsRef.current = obstacles

  const load = async (allowRelay: boolean) => {
    if (!from || !to) return
    const my = ++run.current
    setStatus('loading')
    setMessage('')
    const r = await fetchTransit(pairId, from, to, allowRelay)
    if (my !== run.current) return
    if (!r.ok) {
      setStatus('error')
      setMessage(r.message)
      return
    }
    try {
      const list = await loadBisStops()
      const analyzed = await Promise.all(r.itineraries.map((it) => analyzeItin(it, obsRef.current, list, from, to)))
      if (my !== run.current) return
      analyzed.sort((a, b) => RANK[a.verdict] - RANK[b.verdict] || a.raw.time - b.raw.time)
      setBis(list)
      setItems(analyzed)
      setSel(0)
      fitKey.current = my
      setInfo(r.source === 'stored' ? `TMAP 대중교통 경로를 미리 저장해 둔 값이에요(${(r.fetchedAt ?? '').slice(0, 10)}).` : `TMAP 대중교통 경로를 ${r.cached ? '저장해 둔 값에서' : '새로'} 받았어요.`)
      setStatus('done')
    } catch {
      if (my === run.current) {
        setStatus('error')
        setMessage('버스 경로를 살펴보는 중에 문제가 생겼어요.')
      }
    }
  }

  // 시연 쌍을 고르면 저장된 버스 경로를 바로 보여 준다
  useEffect(() => {
    run.current++
    setItems([])
    setStatus('idle')
    setMessage('')
    if (from && to && hasStoredTransit(pairId)) void load(false)
    // 쌍이 바뀔 때만 다시 읽는다
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pairId, from?.lat, from?.lng, to?.lat, to?.lng])

  const cur = items[sel]

  // 지도에 그릴 정보
  useEffect(() => {
    if (!from || !to || !cur) {
      onOverlay(null)
      return
    }
    const markers: RouteOverlay['markers'] = []
    for (const l of cur.legs) {
      if (l.kind !== 'bus') continue
      for (const [t, s] of [['타', l.board], ['내', l.alight]] as const) {
        if (s) markers.push({ lat: s.lat, lng: s.lng, text: t, title: `${t === '타' ? '타는' : '내리는'} 정류장: ${s.name}`, cls: 'rt-m-bus' })
      }
    }
    onOverlay({
      start: from,
      end: to,
      base: null,
      detour: null,
      legs: cur.legs.map((l) => ({ coords: l.coords, kind: l.kind })),
      active: 'detour',
      hits: cur.legs.flatMap((l) => l.hits),
      unresolvedIds: cur.legs.flatMap((l) => l.unresolved),
      markers,
      focus: null,
      fitKey: fitKey.current * 100 + sel,
    })
    // onOverlay는 부모의 setState라 의존성에서 뺀다
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cur, from, to])

  useEffect(() => () => onOverlay(null), []) // eslint-disable-line react-hooks/exhaustive-deps

  // 휠체어로 타기 어려운 정류장 대신 쓸 수 있는 근처 정류장(팀 조사 평가가 있는 것만 평가를 보여 준다)
  const nearbyAlt = useMemo(
    () => (s: StopInfo) => {
      if (bis.length === 0) return []
      const rate = (id: string) => {
        const e = Object.values(PILOT_STOPS.items).find((x) => x.primary === id)
        return e ? obstacles.find((o) => o.id === e.barrierId)?.rating : undefined
      }
      const seen = new Set<string>()
      return stopsNear([[s.lat, s.lng]], bis, 200)
        .filter((m) => m.stationId !== s.bis?.id && m.name !== s.name && !seen.has(m.name) && !!seen.add(m.name))
        .slice(0, 3)
        .map((m) => ({ ...m, rating: rate(m.stationId) }))
    },
    [bis, obstacles],
  )

  if (!from || !to) return <p className="bm-meta">출발과 도착을 먼저 정해 주세요. 시연 경로를 고르면 바로 보여 드려요.</p>

  return (
    <div className="rt-sec" aria-live="polite">
      {status === 'idle' &&
        (TRANSIT_FREE_SEARCH ? (
          <>
            <p className="bm-meta">버스 경로는 TMAP 대중교통 API로 받아요. 무료 상품은 하루 10건이라 한 번에 한 건씩만 받고, 같은 요청은 저장해 둬요.</p>
            <button type="button" className="rf-primary" onClick={() => void load(true)}>
              버스 경로 찾기
            </button>
          </>
        ) : (
          <p className="bm-meta">버스 경로는 발표용으로 미리 저장해 둔 시연 경로에서만 볼 수 있어요. 위에서 시연 경로를 골라 주세요.</p>
        ))}
      {status === 'loading' && <p className="rf-notice">버스 경로를 찾고 있어요…</p>}
      {status === 'error' && (
        <p className="rf-warn" role="alert">
          {message}
        </p>
      )}

      {status === 'done' && cur && (
        <>
          <p className="bm-meta">{info} 추천 순서는 휠체어 이용 기준(정류장·걷는 길)으로 먼저, 같으면 빠른 순이에요.</p>
          <ul className="tr-itins">
            {items.map((it, i) => (
              <li key={i}>
                <button type="button" className={'tr-itin' + (i === sel ? ' on' : '')} aria-pressed={i === sel} onClick={() => setSel(i)}>
                  <span className="tr-chips">
                    {i === 0 && <span className="tr-chip tr-chip-bus">추천</span>}
                    {it.legs.map((l, j) => (
                      <span key={j} className={'tr-chip' + (l.kind === 'bus' ? ' tr-chip-bus' : '')}>
                        {l.kind === 'bus' ? `${l.leg.lineName ?? '버스'}번` : `걷기 ${fmtMin(l.time)}`}
                      </span>
                    ))}
                  </span>
                  <span className="rt-big">
                    약 {fmtMin(it.raw.time)} · 걷는 거리 {fmtDist(it.raw.walkDistance)}
                    {it.raw.fare != null ? ` · ${it.raw.fare.toLocaleString()}원` : ''}
                  </span>
                  <span className={'rt-pill rt-v-' + it.verdict}>{PILL[it.verdict]}</span>
                  {it.reasons.length > 0 && <span className="rt-sum">{it.reasons.join(' · ')}</span>}
                </button>
              </li>
            ))}
          </ul>

          <div>
            {cur.legs.map((l, i) =>
              l.kind === 'walk' && l.distance < 10 ? null : l.kind === 'walk' ? (
                <section key={i} className="tr-leg">
                  <h4>
                    걷기 {fmtDist(l.distance)} · 약 {fmtMin(l.time)}
                    {l.detoured && ' (돌아가는 길)'}
                  </h4>
                  {l.hits.length === 0 ? (
                    <p className="bm-meta">{l.leg.distance < 10 ? '아주 짧은 구간이에요.' : '이 구간에서 등록된 장애요소를 찾지 못했어요.'}</p>
                  ) : (
                    <ul className="rt-hits">
                      {l.hits.map((h) => {
                        const st = ROLE_STYLE[h.role]
                        return (
                          <li key={h.o.id}>
                            <button type="button" className="lr" onClick={() => onOpenHit(h)}>
                              <i className="lr-glyph" style={{ background: st.color, color: (st as { ink?: string }).ink ?? '#fff' }}>
                                {st.glyph}
                              </i>
                              <span className="lr-main">
                                <span className="lr-title rt-wrap">{obstacleName(h.o)}</span>
                                <span className="lr-sub rt-wrap">
                                  {st.label}
                                  {l.unresolved.includes(h.o.id) && <b className="rt-noalt"> · 돌아갈 길을 찾지 못했어요</b>}
                                </span>
                              </span>
                              <span className="lr-chev" aria-hidden="true" />
                            </button>
                          </li>
                        )
                      })}
                    </ul>
                  )}
                </section>
              ) : (
                <section key={i} className="tr-leg">
                  <h4>
                    {l.leg.lineName ?? '버스'}번 타기 · {Math.max(0, (l.leg.stations?.length ?? 1) - 1)}정거장 · 약 {fmtMin(l.time)}
                  </h4>
                  <p className="bm-meta">
                    타는 곳 <b>{l.board?.name}</b> → 내리는 곳 <b>{l.alight?.name}</b>
                  </p>
                  {l.board && (
                    <>
                      {l.board.bis ? (
                        <BusArrivals
                          key={`${l.board.bis.id}-${l.leg.lineName}`}
                          choices={[{ stationId: l.board.bis.id, name: l.board.bis.name, next: l.board.bis.next }]}
                          lineName={l.leg.lineName}
                          warns={l.board.warns}
                        />
                      ) : (
                        <p className="bm-meta">타는 정류장을 광주 BIS 정류소와 맞춰 보지 못해서 도착 정보를 보여 드릴 수 없어요.</p>
                      )}
                      {l.board.warns.some((w) => w.rating === 'X') && <AltBox stop={l.board} alts={nearbyAlt(l.board)} better={items.filter((x, j) => j !== sel && !x.hasXStop)} onPick={setSel} items={items} />}
                    </>
                  )}
                  {l.alight && l.alight.warns.length > 0 && (
                    <>
                      <p className={'bus-warn ' + (worstOf(l.alight.warns) === 'X' ? 'bus-warn-x' : 'bus-warn-t')} role="alert">
                        <b>내리는 정류장({l.alight.name}) {worstOf(l.alight.warns) === 'X' ? '은 휠체어로 내리기 어려워요' : '은 내릴 때 주의가 필요해요'}</b>
                        <br />
                        {l.alight.warns.map((w) => `${w.rating === 'X' ? 'X' : '△'} ${w.name}`).join(' · ')}
                      </p>
                      {worstOf(l.alight.warns) === 'X' && <AltBox stop={l.alight} alts={nearbyAlt(l.alight)} better={items.filter((x, j) => j !== sel && !x.hasXStop)} onPick={setSel} items={items} />}
                    </>
                  )}
                </section>
              ),
            )}
          </div>
          <p className="bm-meta">출처: TMAP 대중교통(SK open API), 광주 BIS(광주버스정보). 저상버스 정보는 도착 예정 버스 기준이고, 실제로 휠체어 승차가 가능한지는 기사님과 정류장 상황에 따라 달라질 수 있어요.</p>
        </>
      )}
    </div>
  )
}

function AltBox(props: { stop: StopInfo; alts: { stationId: string; name: string; distM: number; rating?: Obstacle['rating'] }[]; better: AItin[]; items: AItin[]; onPick: (i: number) => void }) {
  const { stop, alts, better, items, onPick } = props
  return (
    <div className="tr-alt">
      <b>대안</b>
      {better.length > 0 && (
        <p>
          이 정류장을 쓰지 않는 다른 경로가 있어요:{' '}
          {better.map((b) => (
            <button key={items.indexOf(b)} type="button" className="bus-dir" onClick={() => onPick(items.indexOf(b))}>
              {b.legs
                .filter((l) => l.kind === 'bus')
                .map((l) => `${l.leg.lineName}번`)
                .join('→')}{' '}
              경로 보기
            </button>
          ))}
        </p>
      )}
      {alts.length > 0 ? (
        <>
          <p>{stop.name} 근처 200m 안의 다른 정류장이에요(탑승 가능 여부는 따로 확인되지 않았어요).</p>
          <ul className="rt-plain">
            {alts.map((a) => (
              <li key={a.stationId}>
                {a.name} · {a.distM}m · {ratingLabel(a.rating)}
              </li>
            ))}
          </ul>
        </>
      ) : (
        better.length === 0 && <p>근처에 다른 정류장 정보가 없어요.</p>
      )}
    </div>
  )
}
