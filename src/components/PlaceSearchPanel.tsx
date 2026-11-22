import { useEffect, useRef, useState } from 'react'
import { stripId } from '../lib/display'
import { keywordSearch } from '../lib/kakao'
import { searchDelay } from '../lib/routing/searchUi.ts'
import { makeLatest, searchView, type SearchStatus } from '../lib/routing/searchState.ts'
import { DEMO_PAIRS, type DemoPair, type Place } from '../lib/routing/provider.ts'
import { Sentences } from './Sentences'

type Props = {
  k: typeof kakao | null
  query: string
  onPlace: (p: Place) => void
  onPair: (p: DemoPair) => void
}

/** 위쪽 검색바 아래에 나오는 장소 검색 결과(카카오 JS SDK). 입력이 비면 추천 경로를 보여 준다 */
export default function PlaceSearchPanel({ k, query, onPlace, onPair }: Props) {
  const [status, setStatus] = useState<SearchStatus>('idle')
  const [items, setItems] = useState<kakao.maps.services.PlaceResult[]>([])
  const [outside, setOutside] = useState(false)
  const gate = useRef(makeLatest())
  const first = useRef(true) // 처음 찾을 때만 기다리지 않는다

  useEffect(() => {
    const g = gate.current
    const delay = searchDelay(query, first.current)
    if (delay === null) {
      g.cancel()
      setItems([])
      setStatus('idle')
      return
    }
    if (!k) {
      // 지도 SDK가 아직 오는 중이면 찾는 중으로 두고, 10초가 지나도 없을 때만 실패로 알린다
      setItems([])
      setStatus('loading')
      const w = setTimeout(() => setStatus('error'), 10000)
      return () => clearTimeout(w)
    }
    first.current = false
    setStatus('loading')
    const t = setTimeout(async () => {
      const my = g.next()
      const r = await keywordSearch(k, query.trim(), 8)
      if (!g.isCurrent(my)) return // 그 사이에 더 새로 입력했으면 옛 결과는 버린다
      if (r.status === 'ok') {
        setItems(r.items)
        setOutside(r.outsideBukgu)
        setStatus('ok')
      } else {
        setItems([])
        setStatus(r.status === 'empty' ? 'empty' : 'error')
      }
    }, delay)
    return () => {
      clearTimeout(t)
      g.cancel() // 이미 보낸 옛 요청의 응답은 버린다
    }
  }, [query, k])

  const view = searchView(query, status, items.length)

  return (
    <div className="ps" id="map-search-results" role="region" aria-label="장소 검색 결과" aria-live="polite">
      {view === 'recommend' && (
        <section className="ps-sec">
          <h2 className="ps-h">추천 경로</h2>
          <ul className="ps-list">
            {DEMO_PAIRS.map((p) => (
              <li key={p.id}>
                <button type="button" className="ps-row" onClick={() => onPair(p)}>
                  <span className="ps-name">{stripId(p.fromName)} → {stripId(p.toName)}</span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
      {view === 'loading' && <p className="ps-note" role="status">찾고 있어요…</p>}
      {view === 'empty' && <Sentences as="p" className="ps-note">검색 결과가 없어요.</Sentences>}
      {view === 'error' && <Sentences as="p" className="ps-note" role="alert">검색하지 못했어요. 잠시 뒤에 다시 해 주세요.</Sentences>}
      {view === 'results' && (
        <section className="ps-sec">
          {outside && <p className="ps-note">광주 북구 밖의 결과예요.</p>}
          <ul className="ps-list">
            {items.map((p) => (
              <li key={p.id}>
                <button type="button" className="ps-row" onClick={() => onPlace({ name: p.place_name, lat: Number(p.y), lng: Number(p.x), address: p.road_address_name || p.address_name })}>
                  <span className="ps-name">{p.place_name}</span>
                  <span className="ps-addr">{p.road_address_name || p.address_name}</span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  )
}
