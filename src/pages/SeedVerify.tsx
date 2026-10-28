import { useEffect, useMemo, useRef, useState } from 'react'
import type { ChangeEvent } from 'react'
import candidatesData from '../../data/seed/pilot_candidates.json'
import { CENTER_ADDRESS_CANDIDATES, geocode, keywordSearch, loadKakao } from '../lib/kakao'
import type { KeywordSearchResult } from '../lib/kakao'

// 개발용 화면: 시범 경로 지점의 위치(점·선·영역)를 사용자가 지도에서 직접 확인·확정한다.
// 검색 결과는 '후보'일 뿐이며, 확정 전 좌표는 임시다. 좌표를 코드에 적지 않는다.
// 좌표는 [위도, 경도] 순서(docs/명세서_5장_수정안.md의 Geometry).

type LatLngT = [number, number]
type Kind = 'point' | 'line' | 'area'
type Kind4 = Kind | 'group' // group: 여러 점 — 항목 자체엔 모양이 없고 하위 점으로만 위치를 나타낸다
type Geometry = { kind: 'point'; at: LatLngT } | { kind: 'line'; path: LatLngT[] } | { kind: 'area'; path: LatLngT[] }
type Source = 'kakao-search' | 'map-click'

type Candidate = {
  id: string
  geometryKind: Kind
  name: string
  type: string
  query: string | null
  searchable: boolean
  sourceRefs: string[]
  note: string
}

type Entry = {
  id: string
  name: string
  kind: Kind4
  geometry: Geometry | null
  parentId?: string
  source?: Source
  kakaoPlaceId?: string
  confirmedAt: string
}

type SubDef = { id: string; name: string; parentId: string }
type Store = { confirmed: Record<string, Entry>; subs: SubDef[]; kinds: Record<string, Kind4> }

type Item = {
  id: string
  name: string
  kind: Kind4
  type: string
  query: string | null
  searchable: boolean
  sourceRefs: string[]
  note: string
  parentId?: string
}

type Pending = { lat: number; lng: number; source: Source; kakaoPlaceId?: string; label?: string }
type SearchState = { status: 'idle' } | (KeywordSearchResult & { forId: string })

const POINTS = candidatesData as Candidate[]
const TOP_IDS = new Set(POINTS.map((p) => p.id))
const STORAGE_KEY = 'wheelmap.pilotCoords'
const KINDS_KEY = 'wheelmap.pilotKinds' // 사용자가 고른 종류(확정 전 선택도 유지)
const KIND_OPTIONS: Kind4[] = ['point', 'line', 'area', 'group']
const MIN_VERTEX: Record<'line' | 'area', number> = { line: 2, area: 3 }
const KIND_LABEL: Record<Kind4, string> = { point: '점', line: '선', area: '영역', group: '여러 점' }

function isLatLng(v: unknown): v is LatLngT {
  return Array.isArray(v) && v.length === 2 && typeof v[0] === 'number' && typeof v[1] === 'number'
}

// 새 형식(geometry)과 예전 형식({lat,lng})을 모두 읽는다. 예전 형식은 점으로 바꾼다.
function normalizeEntry(raw: unknown): Entry | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  if (typeof r.id !== 'string' || typeof r.name !== 'string') return null
  let geometry: Geometry | null = null
  const g = r.geometry as Record<string, unknown> | null | undefined
  if (g && typeof g === 'object') {
    if (g.kind === 'point' && isLatLng(g.at)) geometry = { kind: 'point', at: g.at }
    else if ((g.kind === 'line' || g.kind === 'area') && Array.isArray(g.path) && g.path.every(isLatLng)) {
      if (g.path.length >= MIN_VERTEX[g.kind]) geometry = { kind: g.kind, path: g.path as LatLngT[] }
    }
  } else if (typeof r.lat === 'number' && typeof r.lng === 'number') {
    geometry = { kind: 'point', at: [r.lat, r.lng] }
  }
  const entry: Entry = {
    id: r.id,
    name: r.name,
    kind: 'group',
    geometry,
    confirmedAt: typeof r.confirmedAt === 'string' ? r.confirmedAt : '',
  }
  if (geometry) {
    entry.kind = geometry.kind
    entry.source = r.source === 'kakao-search' ? 'kakao-search' : 'map-click'
  } else if (r.kind !== 'group') {
    return null
  }
  if (typeof r.parentId === 'string') entry.parentId = r.parentId
  if (typeof r.kakaoPlaceId === 'string') entry.kakaoPlaceId = r.kakaoPlaceId
  return entry
}

// 기존 id 규칙에 맞는 항목만 받는다: 시범 지점 id이거나, `${부모id}-${n}` 형태의 하위 점.
function isValidEntry(e: Entry): boolean {
  if (e.parentId === undefined) return TOP_IDS.has(e.id)
  return TOP_IDS.has(e.parentId) && /^.+-\d+$/.test(e.id) && e.id.startsWith(`${e.parentId}-`) && e.geometry?.kind === 'point'
}

function storeFromEntries(entries: Entry[], base?: Store): Store {
  const confirmed = { ...(base?.confirmed ?? {}) }
  const subs = [...(base?.subs ?? [])]
  const kinds = { ...(base?.kinds ?? {}) }
  for (const e of entries) {
    confirmed[e.id] = e
    if (!e.parentId) kinds[e.id] = e.kind
    if (e.parentId) {
      const i = subs.findIndex((s) => s.id === e.id)
      const def = { id: e.id, name: e.name, parentId: e.parentId }
      if (i >= 0) subs[i] = def
      else subs.push(def)
    }
  }
  return { confirmed, subs, kinds }
}

function loadStore(): Store {
  const empty: Store = { confirmed: {}, subs: [], kinds: {} }
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    const arr: unknown = raw ? JSON.parse(raw) : []
    const entries = Array.isArray(arr) ? arr.map(normalizeEntry).filter((e): e is Entry => e !== null && isValidEntry(e)) : []
    const store = storeFromEntries(entries, empty)
    const rawKinds = localStorage.getItem(KINDS_KEY)
    const k: unknown = rawKinds ? JSON.parse(rawKinds) : {}
    if (k && typeof k === 'object') {
      for (const [id, v] of Object.entries(k)) {
        if (TOP_IDS.has(id) && (KIND_OPTIONS as unknown[]).includes(v)) store.kinds[id] = v as Kind4
      }
    }
    return store
  } catch {
    return empty
  }
}

function subNumber(id: string): number {
  return Number(id.slice(id.lastIndexOf('-') + 1)) || 0
}

function buildItems(subs: SubDef[], kinds: Record<string, Kind4>): Item[] {
  const items: Item[] = []
  for (const p of POINTS) {
    items.push({ ...p, kind: kinds[p.id] ?? p.geometryKind })
    subs
      .filter((s) => s.parentId === p.id)
      .sort((a, b) => subNumber(a.id) - subNumber(b.id))
      .forEach((s) =>
        items.push({
          id: s.id,
          name: s.name,
          kind: 'point',
          type: '하위 지점',
          query: null,
          searchable: false,
          sourceRefs: [],
          note: '',
          parentId: s.parentId,
        }),
      )
  }
  return items
}

function entriesOf(store: Store): Entry[] {
  return buildItems(store.subs, store.kinds)
    .filter((i) => store.confirmed[i.id])
    .map((i) => store.confirmed[i.id])
}

function saveStore(store: Store) {
  try {
    const list = entriesOf(store)
    if (list.length === 0) localStorage.removeItem(STORAGE_KEY)
    else localStorage.setItem(STORAGE_KEY, JSON.stringify(list))
    if (Object.keys(store.kinds).length === 0) localStorage.removeItem(KINDS_KEY)
    else localStorage.setItem(KINDS_KEY, JSON.stringify(store.kinds))
  } catch {
    // 저장소를 쓸 수 없어도 화면은 동작한다.
  }
}

function anchorOf(g: Geometry): LatLngT {
  return g.kind === 'point' ? g.at : g.path[0]
}

function describe(g: Geometry | null): string {
  if (!g) return '여러 점(하위 지점)'
  if (g.kind === 'point') return `${g.at[0].toFixed(6)}, ${g.at[1].toFixed(6)}`
  return `꼭짓점 ${g.path.length}개`
}

function nowIso(): string {
  return new Date().toISOString()
}

function makePin(text: string, className: string, onClick?: () => void): HTMLElement {
  const el = document.createElement('div')
  el.className = className
  el.textContent = text
  if (onClick) {
    el.addEventListener('click', (e) => {
      e.stopPropagation()
      onClick()
    })
  }
  return el
}

const COLORS = { point: '#2e7d32', sub: '#00897b', line: '#1565c0', area: '#8e24aa' }

export default function SeedVerify() {
  const container = useRef<HTMLDivElement>(null)
  const fileInput = useRef<HTMLInputElement>(null)
  const kRef = useRef<typeof kakao | null>(null)
  const mapRef = useRef<kakao.maps.Map | null>(null)
  const searchToken = useRef(0)
  const clickRef = useRef<((lat: number, lng: number) => void) | null>(null)

  const [mapState, setMapState] = useState<{ status: 'loading' | 'ready' } | { status: 'error'; message: string }>({
    status: 'loading',
  })
  const [store, setStore] = useState<Store>(loadStore)
  const [selectedId, setSelectedId] = useState<string>(POINTS[0].id)
  const [pending, setPending] = useState<Pending | null>(null)
  const [draft, setDraft] = useState<LatLngT[]>([])
  const [search, setSearch] = useState<SearchState>({ status: 'idle' })
  const [subName, setSubName] = useState('')
  const [message, setMessage] = useState('')

  const confirmed = store.confirmed
  const items = useMemo(() => buildItems(store.subs, store.kinds), [store.subs, store.kinds])
  const confirmedRef = useRef(confirmed)
  useEffect(() => {
    confirmedRef.current = confirmed
  })

  const selected = items.find((p) => p.id === selectedId) ?? items[0]
  // 선택한 지점의 검색 결과만 보여 준다(다른 지점 결과가 남아 있으면 '검색 중'으로 취급).
  const searchView: KeywordSearchResult | { status: 'loading' } | { status: 'idle' } = !selected.searchable
    ? { status: 'idle' }
    : search.status !== 'idle' && search.forId === selected.id
      ? search
      : { status: 'loading' }
  const candItems = searchView.status === 'ok' ? searchView.items : null
  const ready = mapState.status === 'ready'

  // 지도 클릭: 점은 임시 마커, 선·영역은 꼭짓점 추가
  useEffect(() => {
    clickRef.current = (lat, lng) => {
      if (selected.kind === 'point') setPending({ lat, lng, source: 'map-click' })
      else if (selected.kind === 'line' || selected.kind === 'area') setDraft((d) => [...d, [lat, lng]])
    }
  })

  // 지도 초기화
  useEffect(() => {
    let cancelled = false
    async function init() {
      try {
        const k = await loadKakao()
        let center: kakao.maps.LatLng | null = null
        const first = Object.values(confirmedRef.current).find((c) => c.geometry)
        if (first?.geometry) {
          const a = anchorOf(first.geometry)
          center = new k.maps.LatLng(a[0], a[1]) // 이미 확정된 지점 근처
        } else {
          for (const address of CENTER_ADDRESS_CANDIDATES) {
            center = await geocode(k, address)
            if (center) break
          }
        }
        if (cancelled || !container.current) return
        if (!center) throw new Error('지도 중심 주소를 조회하지 못했습니다. 카카오 앱의 지도·로컬 사용 설정을 확인해 주세요.')
        const map = new k.maps.Map(container.current, { center, level: 4 })
        k.maps.event.addListener(map, 'click', (e) => {
          clickRef.current?.(e.latLng.getLat(), e.latLng.getLng())
        })
        kRef.current = k
        mapRef.current = map
        setMapState({ status: 'ready' })
      } catch (e) {
        if (!cancelled) setMapState({ status: 'error', message: e instanceof Error ? e.message : String(e) })
      }
    }
    init()
    return () => {
      cancelled = true
    }
  }, [])

  // 확정 결과 자동 저장
  useEffect(() => {
    saveStore(store)
  }, [store])

  // 항목 선택 시: 검색 가능 지점은 카카오 장소 검색, 이미 확정된 항목은 그 위치로 이동
  useEffect(() => {
    if (!ready) return
    const k = kRef.current
    const map = mapRef.current
    if (!k || !map) return
    const token = ++searchToken.current
    const existing = confirmedRef.current[selectedId]
    if (existing?.geometry) {
      const a = anchorOf(existing.geometry)
      map.panTo(new k.maps.LatLng(a[0], a[1]))
    }
    const point = POINTS.find((p) => p.id === selectedId)
    if (!point || !point.searchable || !point.query) return
    keywordSearch(k, point.query).then((result) => {
      if (token !== searchToken.current) return
      setSearch({ ...result, forId: selectedId })
      if (result.status === 'ok' && !existing) {
        const bounds = new k.maps.LatLngBounds()
        result.items.forEach((it) => bounds.extend(new k.maps.LatLng(Number(it.y), Number(it.x))))
        map.setBounds(bounds)
      }
    })
  }, [selectedId, ready])

  // 검색 후보: 번호 마커
  useEffect(() => {
    const k = kRef.current
    const map = mapRef.current
    if (!ready || !k || !map || !candItems) return
    const overlays = candItems.map((it, i) => {
      const pin = makePin(String(i + 1), 'pin pin-cand', () =>
        setPending({
          lat: Number(it.y),
          lng: Number(it.x),
          source: 'kakao-search',
          kakaoPlaceId: it.id,
          label: it.place_name,
        }),
      )
      return new k.maps.CustomOverlay({
        position: new k.maps.LatLng(Number(it.y), Number(it.x)),
        content: pin,
        map,
        yAnchor: 1,
        zIndex: 3,
      })
    })
    return () => overlays.forEach((o) => o.setMap(null))
  }, [candItems, ready])

  // 확정된 점·선·영역: 종류별 색, 선택 항목은 강조
  useEffect(() => {
    const k = kRef.current
    const map = mapRef.current
    if (!ready || !k || !map) return
    const shapes: { setMap(m: kakao.maps.Map | null): void }[] = []
    for (const c of Object.values(confirmed)) {
      const isSel = c.id === selectedId
      const g = c.geometry
      if (!g) continue
      const a = anchorOf(g)
      const select = () => {
        setSelectedId(c.id)
        setPending(null)
        setDraft([])
      }
      let cls = 'pin pin-done'
      if (g.kind === 'point' && c.parentId) cls = 'pin pin-sub'
      else if (g.kind === 'line') cls = 'pin pin-line'
      else if (g.kind === 'area') cls = 'pin pin-area'
      if (isSel) cls += ' pin-sel'
      if (g.kind === 'line') {
        shapes.push(
          new k.maps.Polyline({
            map,
            path: g.path.map((p) => new k.maps.LatLng(p[0], p[1])),
            strokeWeight: isSel ? 8 : 5,
            strokeColor: COLORS.line,
            strokeOpacity: isSel ? 0.95 : 0.7,
            zIndex: isSel ? 2 : 1,
          }),
        )
      } else if (g.kind === 'area') {
        shapes.push(
          new k.maps.Polygon({
            map,
            path: g.path.map((p) => new k.maps.LatLng(p[0], p[1])),
            strokeWeight: isSel ? 4 : 2,
            strokeColor: COLORS.area,
            strokeOpacity: 0.9,
            fillColor: COLORS.area,
            fillOpacity: isSel ? 0.4 : 0.2,
            zIndex: isSel ? 2 : 1,
          }),
        )
      }
      shapes.push(
        new k.maps.CustomOverlay({
          position: new k.maps.LatLng(a[0], a[1]),
          content: makePin(c.id, cls, select),
          map,
          yAnchor: 1,
          zIndex: isSel ? 4 : 2,
        }),
      )
    }
    return () => shapes.forEach((o) => o.setMap(null))
  }, [confirmed, selectedId, ready])

  // 그리는 중인 선·영역(점선)과 꼭짓점
  useEffect(() => {
    const k = kRef.current
    const map = mapRef.current
    if (!ready || !k || !map || draft.length === 0 || selected.kind === 'point' || selected.kind === 'group') return
    const path = draft.map((p) => new k.maps.LatLng(p[0], p[1]))
    const shapes: { setMap(m: kakao.maps.Map | null): void }[] = []
    if (selected.kind === 'area' && draft.length >= 3) {
      shapes.push(
        new k.maps.Polygon({
          map,
          path,
          strokeWeight: 3,
          strokeColor: COLORS.area,
          strokeStyle: 'shortdash',
          fillColor: COLORS.area,
          fillOpacity: 0.3,
          zIndex: 5,
        }),
      )
    } else {
      shapes.push(
        new k.maps.Polyline({
          map,
          path,
          strokeWeight: 4,
          strokeColor: selected.kind === 'area' ? COLORS.area : COLORS.line,
          strokeStyle: 'shortdash',
          zIndex: 5,
        }),
      )
    }
    path.forEach((pos, i) => {
      shapes.push(new k.maps.CustomOverlay({ position: pos, content: makePin(String(i + 1), 'pin pin-vertex'), map, yAnchor: 0.5, xAnchor: 0.5, zIndex: 6 }))
    })
    return () => shapes.forEach((o) => o.setMap(null))
  }, [draft, selected.kind, ready])

  // 임시 위치(점): 드래그 가능한 마커
  useEffect(() => {
    const k = kRef.current
    const map = mapRef.current
    if (!ready || !k || !map || !pending) return
    const marker = new k.maps.Marker({
      position: new k.maps.LatLng(pending.lat, pending.lng),
      map,
      draggable: true,
      title: '임시 위치(드래그해서 조정)',
      zIndex: 7,
    })
    k.maps.event.addListener(marker, 'dragend', () => {
      const pos = marker.getPosition()
      setPending({ lat: pos.getLat(), lng: pos.getLng(), source: 'map-click' })
    })
    return () => marker.setMap(null)
  }, [pending, ready])

  function select(id: string) {
    setSelectedId(id)
    setPending(null)
    setDraft([])
    setMessage('')
  }

  function putEntry(geometry: Geometry, source: Source, kakaoPlaceId?: string) {
    const entry: Entry = {
      id: selected.id,
      name: selected.name,
      kind: geometry.kind,
      geometry,
      ...(selected.parentId ? { parentId: selected.parentId } : {}),
      source,
      ...(kakaoPlaceId ? { kakaoPlaceId } : {}),
      confirmedAt: nowIso(),
    }
    setStore((prev) => ({ ...prev, confirmed: { ...prev.confirmed, [selected.id]: entry } }))
  }

  function confirmPending() {
    if (!pending) return
    putEntry({ kind: 'point', at: [pending.lat, pending.lng] }, pending.source, pending.kakaoPlaceId)
    setPending(null)
  }

  function confirmDraft() {
    if (selected.kind === 'point' || selected.kind === 'group' || draft.length < MIN_VERTEX[selected.kind]) return
    putEntry({ kind: selected.kind, path: draft }, 'map-click')
    setDraft([])
  }

  function confirmGroup() {
    if (selected.kind !== 'group' || !groupReady) return
    const entry: Entry = { id: selected.id, name: selected.name, kind: 'group', geometry: null, confirmedAt: nowIso() }
    setStore((prev) => ({ ...prev, confirmed: { ...prev.confirmed, [selected.id]: entry } }))
  }

  function changeKind(kind: Kind4) {
    if (kind === selected.kind || selected.parentId) return
    const existing = confirmed[selected.id]
    if (existing && !window.confirm('기존 모양이 지워집니다. 계속하시겠습니까?')) return
    setStore((prev) => {
      const next = { ...prev.confirmed }
      delete next[selected.id]
      return { ...prev, confirmed: next, kinds: { ...prev.kinds, [selected.id]: kind } }
    })
    setPending(null)
    setDraft([])
  }

  function unconfirm() {
    setStore((prev) => {
      const next = { ...prev.confirmed }
      delete next[selected.id]
      return { ...prev, confirmed: next }
    })
  }

  function addSub() {
    const name = subName.trim()
    if (!name || selected.parentId) return
    const n = Math.max(0, ...store.subs.filter((s) => s.parentId === selected.id).map((s) => subNumber(s.id))) + 1
    const id = `${selected.id}-${n}`
    setStore((prev) => ({ ...prev, subs: [...prev.subs, { id, name, parentId: selected.id }] }))
    setSubName('')
    select(id)
  }

  function removeSub(id: string) {
    const sub = store.subs.find((s) => s.id === id)
    if (!sub || !window.confirm(`하위 지점 ${id}(${sub.name})을 삭제합니다. 계속하시겠습니까?`)) return
    setStore((prev) => {
      const next = { ...prev.confirmed }
      delete next[id]
      return { ...prev, confirmed: next, subs: prev.subs.filter((s) => s.id !== id) }
    })
    if (selectedId === id) select(sub.parentId)
  }

  function exportJson() {
    const blob = new Blob([JSON.stringify(entriesOf(store), null, 2) + '\n'], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'pilot_coords.json'
    document.body.appendChild(a)
    a.click()
    a.remove()
    URL.revokeObjectURL(url)
  }

  async function importJson(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    try {
      const arr: unknown = JSON.parse(await file.text())
      if (!Array.isArray(arr)) throw new Error('배열 형식이 아닙니다.')
      const entries = arr.map(normalizeEntry).filter((x): x is Entry => x !== null && isValidEntry(x))
      if (entries.length === 0) throw new Error('불러올 수 있는 항목이 없습니다.')
      const overlap = entries.filter((x) => store.confirmed[x.id]).length
      const skipped = arr.length - entries.length
      const ok = window.confirm(
        `${entries.length}건을 불러옵니다. 같은 id ${overlap}건은 불러온 값으로 바뀝니다.` +
          (skipped > 0 ? ` (읽지 못한 ${skipped}건은 건너뜁니다.)` : '') +
          ' 계속하시겠습니까?',
      )
      if (!ok) return
      setStore((prev) => storeFromEntries(entries, prev))
      setMessage(`${entries.length}건을 불러왔습니다.`)
    } catch (err) {
      setMessage(`불러오기에 실패했습니다: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  function reset() {
    if (!window.confirm('확정한 위치와 하위 지점을 모두 지웁니다. 계속하시겠습니까?')) return
    setStore({ confirmed: {}, subs: [], kinds: {} })
    setPending(null)
    setDraft([])
  }

  const doneCount = POINTS.filter((p) => confirmed[p.id]).length
  const subCount = store.subs.length
  const current = confirmed[selected.id]
  const minV = selected.kind === 'line' || selected.kind === 'area' ? MIN_VERTEX[selected.kind] : 0
  const groupReady = store.subs.some((s) => s.parentId === selected.id && confirmed[s.id])

  return (
    <div className="verify">
      <header className="verify-head">
        <div className="verify-title">
          <strong>시범 경로 위치 확인 (개발용)</strong>
          <span className="verify-count">
            확정 {doneCount} / {POINTS.length}
            {subCount > 0 ? ` · 하위 지점 ${subCount}` : ''}
          </span>
        </div>
        <div className="verify-actions">
          <button type="button" onClick={exportJson} disabled={Object.keys(confirmed).length === 0}>
            JSON 내보내기
          </button>
          <button type="button" onClick={() => fileInput.current?.click()}>
            JSON 불러오기
          </button>
          <button type="button" onClick={reset} disabled={Object.keys(confirmed).length === 0 && subCount === 0}>
            초기화
          </button>
          <input ref={fileInput} type="file" accept="application/json,.json" hidden onChange={importJson} />
        </div>
        {message && <p className="meta">{message}</p>}
        <p className="verify-warn">
          확정하기 전의 좌표는 임시 값입니다. 카카오 검색 결과는 후보일 뿐이므로, 반드시 지도에서 직접 확인한 뒤 확정해 주세요.
        </p>
      </header>

      <div className="verify-body">
        <div className="verify-map">
          <div ref={container} className="map" role="application" aria-label="위치 확인 지도" />
          {mapState.status === 'loading' && <p className="map-notice">지도를 불러오는 중입니다…</p>}
          {mapState.status === 'error' && (
            <p className="map-notice map-notice-error" role="alert">
              {mapState.message}
            </p>
          )}
        </div>

        <aside className="verify-side">
          <section className="verify-detail" aria-live="polite">
            <h2>
              {selected.id} · {selected.name}
            </h2>
            {!selected.parentId && (
              <div className="kind-seg" role="group" aria-label="종류 선택">
                {KIND_OPTIONS.map((k) => (
                  <button
                    key={k}
                    type="button"
                    className={k === selected.kind ? 'seg active' : 'seg'}
                    aria-pressed={k === selected.kind}
                    onClick={() => changeKind(k)}
                  >
                    {KIND_LABEL[k]}
                  </button>
                ))}
              </div>
            )}
            <p className="meta">
              {KIND_LABEL[selected.kind]} · {selected.type}
              {selected.sourceRefs.length > 0 ? ` · 출처: ${selected.sourceRefs.join(', ')}` : ''}
            </p>
            {selected.note && <p className="meta">{selected.note}</p>}

            {selected.kind === 'point' && selected.searchable && (
              <div>
                <p className="meta">검색어: {selected.query}</p>
                {searchView.status === 'loading' && <p>장소를 검색하는 중입니다…</p>}
                {searchView.status === 'empty' && <p>검색 결과가 없습니다. 지도를 클릭해 직접 찍어 주세요.</p>}
                {searchView.status === 'error' && <p className="err">장소 검색에 실패했습니다. 지도를 클릭해 직접 찍어 주세요.</p>}
                {searchView.status === 'ok' && (
                  <ol className="cands">
                    {searchView.items.map((it, i) => (
                      <li key={it.id}>
                        <button
                          type="button"
                          className={pending?.kakaoPlaceId === it.id ? 'cand active' : 'cand'}
                          onClick={() =>
                            setPending({
                              lat: Number(it.y),
                              lng: Number(it.x),
                              source: 'kakao-search',
                              kakaoPlaceId: it.id,
                              label: it.place_name,
                            })
                          }
                        >
                          <span className="num">{i + 1}</span>
                          <span>
                            <b>{it.place_name}</b>
                            <br />
                            {it.road_address_name || it.address_name}
                            <br />
                            <small>{it.category_name}</small>
                          </span>
                        </button>
                      </li>
                    ))}
                  </ol>
                )}
              </div>
            )}
            {selected.kind === 'point' && !selected.searchable && (
              <p className="meta">검색으로 찾을 수 없는 지점입니다. 지도를 클릭해 위치를 찍고, 마커를 드래그해 조정해 주세요.</p>
            )}
            {selected.kind === 'line' && <p className="meta">길을 따라 지도를 차례로 클릭해 꼭짓점을 추가해 주세요(2개 이상).</p>}
            {selected.kind === 'area' && (
              <p className="meta">구역의 둘레를 따라 지도를 차례로 클릭해 꼭짓점을 추가해 주세요(3개 이상, 첫 점을 다시 찍지 않습니다).</p>
            )}
            {selected.kind === 'group' && (
              <p className="meta">여러 점: 이 항목 자체에는 모양이 없고, 아래 하위 지점으로만 위치를 나타냅니다. 하위 지점을 추가해 각각 확정한 뒤(1개 이상) 이 항목을 확정해 주세요.</p>
            )}

            <div className="state">
              {selected.kind === 'point' ? (
                pending ? (
                  <p>
                    임시 위치: {pending.lat.toFixed(6)}, {pending.lng.toFixed(6)}
                    {pending.label ? ` (${pending.label})` : ''} — 지도에서 확인 후 확정해 주세요.
                  </p>
                ) : current ? (
                  <p>
                    확정됨: {describe(current.geometry)} ({current.source === 'kakao-search' ? '검색 후보' : '지도 클릭'})
                  </p>
                ) : (
                  <p>아직 위치를 고르지 않았습니다. 후보를 누르거나 지도를 클릭해 주세요.</p>
                )
              ) : selected.kind === 'group' ? (
                <p>
                  {current ? '확정됨: 여러 점' : '아직 확정하지 않았습니다.'} — 확정된 하위 지점 {store.subs.filter((s) => s.parentId === selected.id && confirmed[s.id]).length}개
                </p>
              ) : draft.length > 0 ? (
                <p>
                  그리는 중: 꼭짓점 {draft.length}개 (최소 {minV}개){current ? ` — 확정하면 기존 ${KIND_LABEL[selected.kind]}을 대체합니다.` : ''}
                </p>
              ) : current ? (
                <p>확정됨: {describe(current.geometry)}. 다시 그리려면 지도를 클릭해 주세요.</p>
              ) : (
                <p>아직 그리지 않았습니다. 지도를 클릭해 시작해 주세요.</p>
              )}
              <div className="verify-actions">
                {selected.kind === 'point' ? (
                  <button type="button" className="primary" onClick={confirmPending} disabled={!pending}>
                    {selected.searchable && pending?.source === 'kakao-search' ? '이 위치로 확정' : '확정'}
                  </button>
                ) : selected.kind === 'group' ? (
                  <button type="button" className="primary" onClick={confirmGroup} disabled={!groupReady}>
                    확정
                  </button>
                ) : (
                  <>
                    <button type="button" className="primary" onClick={confirmDraft} disabled={draft.length < minV}>
                      확정
                    </button>
                    <button type="button" onClick={() => setDraft((d) => d.slice(0, -1))} disabled={draft.length === 0}>
                      마지막 점 취소
                    </button>
                    <button type="button" onClick={() => setDraft([])} disabled={draft.length === 0}>
                      다시 그리기
                    </button>
                  </>
                )}
                {current && (
                  <button type="button" onClick={unconfirm}>
                    확정 해제
                  </button>
                )}
              </div>
            </div>

            {!selected.parentId && (
              <div className="sub-add">
                <input
                  type="text"
                  value={subName}
                  placeholder="하위 지점 이름 (예: 보도 폭 1.74m 지점)"
                  onChange={(e) => setSubName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') addSub()
                  }}
                />
                <button type="button" onClick={addSub} disabled={!subName.trim()}>
                  하위 지점 추가
                </button>
              </div>
            )}
          </section>

          <ul className="verify-list">
            {items.map((p) => (
              <li key={p.id} className={p.parentId ? 'sub' : undefined}>
                <button
                  type="button"
                  className={p.id === selectedId ? 'row active' : 'row'}
                  onClick={() => select(p.id)}
                >
                  <span className={confirmed[p.id] ? 'badge done' : 'badge'}>{confirmed[p.id] ? '확정' : '미확정'}</span>
                  <span className="row-id">{p.id}</span>
                  <span className="row-name">{p.name}</span>
                  <span className="row-tag">
                    {KIND_LABEL[p.kind]}
                    {p.kind === 'point' && !p.searchable && !p.parentId ? ' · 직접 찍기' : ''}
                  </span>
                </button>
                {p.parentId && (
                  <button type="button" className="row-del" aria-label={`${p.id} 삭제`} onClick={() => removeSub(p.id)}>
                    삭제
                  </button>
                )}
              </li>
            ))}
          </ul>
        </aside>
      </div>
    </div>
  )
}
