import { useCallback, useEffect, useRef, useState } from 'react'
import Skeleton from './Skeleton'
import type { BoardingWarn } from '../lib/bus/boarding.ts'
import { getArrivals, getLineLow, LIVE_AVAILABLE, hasSnapshot } from '../lib/bus/provider.ts'
import { nextLow, arrivalText, type Arrival, type ArrivalResult, type LineLowResult } from '../lib/bus/types.ts'

export type StopChoice = { stationId: string; name: string; next?: string }

type Props = {
  choices: StopChoice[] // 같은 자리의 정류소 후보(반대 방면 포함). 둘 이상이면 방면 버튼을 보여 준다.
  lineName?: string // 길찾기에서 탈 노선. 있으면 그 노선을 먼저 보여 준다
  warns?: BoardingWarn[] // 이 정류장의 '버스 타기 불편' 장애요소
  autoLoad?: boolean
}

const hhmm = (iso: string) => {
  const d = new Date(iso)
  return `${d.getMonth() + 1}월 ${d.getDate()}일 ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

function Row({ a, mark }: { a: Arrival; mark?: boolean }) {
  return (
    <li className={'bus-row' + (mark ? ' bus-row-mark' : '')}>
      <span className={'bus-tag ' + (a.low ? 'bus-low' : 'bus-norm')}>{a.low ? '저상' : '일반'}</span>
      <span className="bus-line">{a.lineName}번</span>
      <span className="bus-eta">{arrivalText(a).replace(`${a.lineName}번 `, '')}</span>
    </li>
  )
}

export default function BusArrivals({ choices, lineName, warns = [], autoLoad = true }: Props) {
  const [idx, setIdx] = useState(0)
  const [res, setRes] = useState<ArrivalResult | null>(null)
  const [lineLow, setLineLow] = useState<LineLowResult | null>(null)
  const [loading, setLoading] = useState(false)
  const [started, setStarted] = useState(autoLoad)
  const seq = useRef(0)
  const cur = choices[Math.min(idx, choices.length - 1)]

  const load = useCallback(async () => {
    if (!cur) return
    const my = ++seq.current
    setLoading(true)
    const [a, l] = await Promise.all([getArrivals(cur.stationId), lineName ? getLineLow(lineName) : Promise.resolve(null)])
    if (my !== seq.current) return
    setRes(a)
    setLineLow(l)
    setLoading(false)
  }, [cur, lineName])

  useEffect(() => {
    if (started) queueMicrotask(() => void load())
  }, [started, load])

  if (!cur) return null
  const warnX = warns.some((w) => w.rating === 'X')

  return (
    <div className="bus-box">
      {warns.length > 0 && (
        <p className={'bus-warn ' + (warnX ? 'bus-warn-x' : 'bus-warn-t')} role="alert">
          <b>{warnX ? '이 정류장은 휠체어 탑승이 어려워요' : '이 정류장은 타고 내릴 때 주의해야 해요'}</b>
          <br />
          {warns.map((w) => `${w.rating === 'X' ? 'X' : '△'} ${w.name}`).join(' · ')}
        </p>
      )}

      {choices.length > 1 && (
        <div className="bus-dirs" role="group" aria-label="정류장 방면">
          {choices.map((c, i) => (
            <button key={c.stationId} type="button" className={'bus-dir' + (i === idx ? ' on' : '')} aria-pressed={i === idx} onClick={() => setIdx(i)}>
              {c.next ? `${c.next} 방면` : c.name}
            </button>
          ))}
        </div>
      )}

      {!started ? (
        <button type="button" className="bus-load" onClick={() => setStarted(true)}>
          {LIVE_AVAILABLE ? '다음 저상버스 보기' : hasSnapshot(cur.stationId) ? '예시 도착 정보 보기' : '저상버스 정보 보기'}
        </button>
      ) : loading && !res ? (
        <Skeleton rows={2} label="도착 정보를 불러오고 있어요" />
      ) : res && !res.ok ? (
        <p className="bus-none" role="status">
          {res.reason === 'no-snapshot' || res.reason === 'unavailable'
            ? LIVE_AVAILABLE
              ? res.message
              : '실시간 저상버스 정보는 준비 중이에요(시연판). 이 정류장은 미리 받아 둔 예시 정보도 없어요.'
            : res.message}
        </p>
      ) : res && res.ok ? (
        <>
          <p className={'bus-mode ' + (res.mode === 'live' ? 'bus-mode-live' : 'bus-mode-snap')}>
            {res.mode === 'live' ? `실시간 · ${hhmm(res.collectedAt)} 기준` : `실시간이 아니에요 · 미리 받아 둔 예시 (${hhmm(res.collectedAt)} 기준)`}
          </p>
          {res.mode === 'snapshot' && !LIVE_AVAILABLE && <p className="bm-meta">실시간 저상버스 정보는 준비 중이에요(시연판). 서버를 붙이면 지금 오는 버스를 보여 드릴 수 있어요.</p>}

          {lineName && (
            <div className="bus-line-box">
              {(() => {
                const mine = res.arrivals.filter((a) => a.lineName === lineName)
                const mineLow = nextLow(res.arrivals, lineName)
                return (
                  <>
                    <p className="bus-big">
                      {mineLow ? (
                        <>
                          다음 저상버스 <b>{arrivalText(mineLow)}</b>
                        </>
                      ) : mine.length > 0 ? (
                        <>
                          {lineName}번이 오지만 <b>저상버스가 아니에요</b>
                        </>
                      ) : (
                        <>
                          {lineName}번이 곧 오는 정보가 없어요
                        </>
                      )}
                    </p>
                    {mine.length > 0 && <ul className="bus-list">{mine.slice(0, 3).map((a, i) => <Row key={i} a={a} mark />)}</ul>}
                    {lineLow?.ok && (
                      <p className="bm-meta">
                        {lineName}번 {lineLow.mode === 'live' ? '지금' : `(${hhmm(lineLow.data.collectedAt)} 기준)`} 운행 중{' '}
                        {lineLow.data.total}대 중 저상버스 <b>{lineLow.data.low}대</b>
                        {lineLow.data.low === 0 && lineLow.data.total > 0 ? ' — 이 노선은 지금 휠체어로 타기 어려울 수 있어요' : ''}
                      </p>
                    )}
                  </>
                )
              })()}
            </div>
          )}

          {!lineName &&
            (() => {
              const n = nextLow(res.arrivals)
              return (
                <p className="bus-big">
                  {n ? (
                    <>
                      다음 저상버스 <b>{arrivalText(n)}</b>
                    </>
                  ) : (
                    <b>곧 오는 저상버스가 없어요</b>
                  )}
                </p>
              )
            })()}

          {res.arrivals.length > 0 ? (
            <details className="bus-more" open={!lineName}>
              <summary>이 정류장에 오는 버스 {res.arrivals.length}대</summary>
              <ul className="bus-list">
                {res.arrivals.slice(0, 8).map((a, i) => (
                  <Row key={i} a={a} />
                ))}
              </ul>
              <p className="bm-meta">저상은 광주 BIS의 저상버스 구분(LOW_BUS)이 1인 버스예요.</p>
            </details>
          ) : (
            <p className="bm-meta">지금 도착 예정인 버스가 없어요.</p>
          )}

          {res.mode === 'live' && (
            <button type="button" className="bus-refresh" onClick={() => void load()} disabled={loading}>
              {loading ? '불러오는 중…' : '새로 고침'}
            </button>
          )}
        </>
      ) : null}
    </div>
  )
}
