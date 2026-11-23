// 길 안내 3D 지도: 안내 중에 카카오 지도 위를 덮는 MapLibre GL 지도(진행 방향 위 회전·기울이기).
// 이 파일만 maplibre-gl을 불러오고, BarrierMap이 React.lazy로 불러오므로 길 안내를 시작할 때까지 내려받지 않는다.
// 좌표 순서: 앱은 [lat, lng], MapLibre는 [lng, lat] — toLngLat 한 곳에서만 바꾼다.
import { useEffect, useRef, useState, type RefObject } from 'react'
import { Map as GlMap, Marker, setWorkerUrl, type GeoJSONSource } from 'maplibre-gl'
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url' // 번들러가 워커 파일 위치를 알 수 있게 주소를 직접 넘긴다(v6 안내)
import 'maplibre-gl/dist/maplibre-gl.css'
import { NAV_STEP_NEAR_M, NAV_Z } from '../lib/config'
import { obstacleName } from '../lib/display'
import { GL_STYLE_URL, bearingAhead, firstSymbolId, followPadding, koreanizeStyle, routeCollection, toLngLat } from '../lib/guideGl/core.ts'
import { busColor } from '../lib/routing/busColor.ts'
import type { Hit, Pt } from '../lib/routing/engine.ts'
import { isStepNear } from '../lib/routing/followNav.ts'
import { clusterByScreen } from '../lib/routing/markerCluster.ts'
import type { RouteLeg, RouteMarker } from '../lib/routing/overlay.ts'
import { ROLE_STYLE } from '../lib/routing/roleStyle.ts'
import { prefersCalm } from '../lib/viewPrefs'
import { iconSvg } from './Icon'

type Mode = 'head' | 'north' | 'free' // 진행 방향 위(회전·기울임) / 북쪽 위(평평) / 직접 움직이는 중
type Guide = { coords: Pt[]; next: Pt[]; at: Pt; turn: string; n: number }
type Props = {
  path: Pt[] // 안내 중인 전체 경로 [lat,lng]
  legs?: RouteLeg[] // 걷는 구간·버스 구간(있으면 구간마다 색을 달리 그린다)
  hits: Hit[] // 경로 위 장애요소
  markers: RouteMarker[] // 횡단보도·정류장·화장실 등 작은 딱지
  start: { lat: number; lng: number }
  end: { lat: number; lng: number }
  focus: string | null // 지금 고른 장애요소 id
  guide: Guide
  me: { lat: number; lng: number } | null
  headingRef: RefObject<number | null> // 폰이 향한 방향(북=0, 시계 방향). 모르면 null
  getInsets: () => { top: number; bottom: number; left: number } // 위·아래·왼쪽을 덮은 패널 크기(px)
  onFail: () => void // 못 쓰면 카카오 지도로 돌아간다
}

setWorkerUrl(workerUrl)

const HEAD_PITCH = 45
const FIRST_ZOOM = 17.5
const WALK_COLOR = '#2272eb'
const ICON_OF: Record<string, string> = { 'rt-m-bus': 'bus', 'rt-m-toilet': 'toilet', 'rt-m-shade': 'umbrella', 'rt-m-overpass': 'bridge', 'rt-m-flood': 'drop' }
const colorOf = (l: { kind: 'walk' | 'bus'; route?: string }) => (l.kind === 'bus' ? busColor(l.route) : WALK_COLOR)
// 경로 위 진행 방향 화살표(카카오 지도의 .rt-arrow와 같은 모양): 오른쪽을 향한 그림을 만들어 두고 선을 따라 놓는다
const arrowImage = () => {
  const c = document.createElement('canvas')
  c.width = c.height = 24
  const g = c.getContext('2d')!
  g.beginPath()
  g.moveTo(20, 12)
  g.lineTo(6, 19)
  g.lineTo(9, 12)
  g.lineTo(6, 5)
  g.closePath()
  g.fillStyle = '#fff'
  g.fill()
  g.strokeStyle = 'rgba(25,31,40,.55)'
  g.lineWidth = 1.5
  g.lineJoin = 'round'
  g.stroke()
  return g.getImageData(0, 0, 24, 24)
}
const line = (pts: Pt[]) => ({ type: 'Feature' as const, properties: {}, geometry: { type: 'LineString' as const, coordinates: pts.map(toLngLat) } })
const angDiff = (a: number, b: number) => Math.abs((((a - b) % 360) + 540) % 360 - 180)

export default function GuideGlMap(props: Props) {
  const wrap = useRef<HTMLDivElement>(null)
  const stage = useRef<HTMLDivElement>(null)
  const needle = useRef<HTMLSpanElement>(null)
  const propsRef = useRef(props)
  propsRef.current = props
  const syncRef = useRef<() => void>(() => {})
  const followRef = useRef<() => void>(() => {})
  const decoRef = useRef<() => void>(() => {})
  const modeRef = useRef<Mode>('head')
  const [mode, setModeState] = useState<Mode>('head')
  const setMode = (m: Mode) => {
    modeRef.current = m
    setModeState(m)
  }
  const setModeRef = useRef(setMode)
  setModeRef.current = setMode

  useEffect(() => {
    const host = stage.current
    if (!host) return
    let dead = false
    let map: GlMap | null = null
    let timer = 0
    let loadTimer = 0
    let ro: ResizeObserver | null = null
    const ac = new AbortController()
    const fail = () => {
      if (!dead) {
        dead = true
        propsRef.current.onFail()
      }
    }
    ;(async () => {
      const res = await fetch(GL_STYLE_URL, { signal: ac.signal })
      if (!res.ok) throw new Error('style')
      const style = koreanizeStyle(await res.json())
      if (dead) return
      const p0 = propsRef.current
      const start = p0.me ? ([p0.me.lat, p0.me.lng] as Pt) : p0.guide.at
      const m = new GlMap({ container: host, style, center: toLngLat(start), zoom: FIRST_ZOOM, pitch: HEAD_PITCH, bearing: bearingAhead(p0.path, start) ?? 0, maxPitch: 60, attributionControl: false })
      map = m
      m.getCanvas().addEventListener('webglcontextlost', fail)
      loadTimer = window.setTimeout(fail, 10000) // 스타일이 열리지 않으면 카카오 지도로

      // 내 위치 점(+방향 부채꼴)은 기존 .hm-me 모양을 그대로 쓴다. Marker 바깥 상자는 라이브러리가 위치를 잡는 용도라 한 겹 감싼다.
      const meBox = document.createElement('div')
      meBox.style.zIndex = String(NAV_Z.me)
      const meEl = document.createElement('div')
      meEl.className = 'hm-me'
      const cone = document.createElement('i')
      cone.className = 'hm-me-cone'
      meEl.appendChild(cone)
      meBox.appendChild(meEl)
      const meMk = new Marker({ element: meBox, pitchAlignment: 'viewport', rotationAlignment: 'viewport' })
      const stBox = document.createElement('div')
      stBox.style.zIndex = String(NAV_Z.step)
      const stEl = document.createElement('div')
      stEl.className = 'rt-gstep'
      stBox.appendChild(stEl)
      const stMk = new Marker({ element: stBox, pitchAlignment: 'viewport', rotationAlignment: 'viewport' })

      // 경로 위 장애요소 고리·출발/도착·버스 번호·정류장 등 딱지(카카오 지도 길 안내에서 보이던 것). 눌러지지 않게 두어 지도 끌기를 막지 않는다.
      const decoMks: Marker[] = []
      const put = (el: HTMLElement, at: { lat: number; lng: number }, z: number, up = 0) => {
        const box = document.createElement('div')
        box.style.zIndex = String(z)
        box.style.pointerEvents = 'none'
        box.appendChild(el)
        decoMks.push(new Marker({ element: box, anchor: up ? 'bottom' : 'center', offset: [0, up ? -up : 0], pitchAlignment: 'viewport', rotationAlignment: 'viewport' }).setLngLat(toLngLat([at.lat, at.lng])).addTo(m))
      }
      const drawDeco = () => {
        decoMks.splice(0).forEach((x) => x.remove())
        const p = propsRef.current
        for (const h of p.hits) {
          const st = ROLE_STYLE[h.role]
          const el = document.createElement('div')
          el.className = 'rt-ring' + (p.focus === h.o.id ? ' on' : '')
          el.style.background = st.color
          el.style.color = (st as { ink?: string }).ink ?? '#fff'
          el.textContent = st.glyph
          el.title = `${obstacleName(h.o)} — ${st.label}`
          put(el, { lat: h.anchor[0], lng: h.anchor[1] }, 11)
        }
        const isStop = (x: RouteMarker) => x.cls === 'rt-m-bus' && (x.text === '정류장' || x.text === '버스')
        const tag = (x: RouteMarker, text: string, title: string, count = 0) => {
          const el = document.createElement('div')
          const ic = ICON_OF[x.cls]
          el.className = 'rt-m ' + x.cls + (ic ? ' rt-m-ic' : '')
          if (ic) {
            el.innerHTML = iconSvg(ic, 14, 2.4) + (count > 1 ? `<b>${count}</b>` : '')
            el.setAttribute('role', 'img')
            el.setAttribute('aria-label', count > 1 ? `정류장 ${count}곳: ${title}` : title)
          } else el.textContent = text
          el.title = title
          put(el, x, 9)
        }
        for (const x of p.markers) if (!isStop(x)) tag(x, x.text, x.title)
        const stops = p.markers.filter(isStop)
        for (const g of clusterByScreen(stops.map((x) => m.project(toLngLat([x.lat, x.lng]))))) {
          const first = stops[g[0]]
          if (g.length === 1) tag(first, first.text, first.title)
          else tag(first, `정류장 ${g.length}`, [...new Set(g.map((i) => stops[i].title))].join(', '), g.length)
        }
        for (const l of p.legs ?? []) {
          if (l.kind === 'bus' && l.lineName && l.coords.length > 0) {
            const el = document.createElement('div')
            el.className = 'rt-busno'
            el.style.background = busColor(l.route)
            el.textContent = l.lineName
            put(el, { lat: l.coords[0][0], lng: l.coords[0][1] }, 12, 22)
          }
        }
        for (const [pl, text, cls, z] of [[p.end, '도착', 'rt-flag rt-flag-e', 14], [p.start, '출발', 'rt-flag rt-flag-s', 13]] as const) {
          const el = document.createElement('div')
          el.className = cls
          el.textContent = text
          put(el, pl, z, 18)
        }
      }
      decoRef.current = drawDeco

      const calm = () => prefersCalm()
      const follow = () => {
        const p = propsRef.current
        const md = modeRef.current
        if (md === 'free') return
        const head = md === 'head'
        const target: Pt = p.me ? [p.me.lat, p.me.lng] : p.guide.at
        const bearing = head ? (p.headingRef.current ?? bearingAhead(p.path, target) ?? m.getBearing()) : 0
        lastBearing = bearing
        m.easeTo({ center: toLngLat(target), bearing, pitch: head ? HEAD_PITCH : 0, padding: followPadding(host.clientHeight, p.getInsets(), head), duration: calm() ? 0 : 500, essential: true })
      }
      let lastBearing = 0
      followRef.current = follow

      const paintCone = () => {
        const hd = propsRef.current.headingRef.current
        if (hd === null) return meEl.classList.remove('hm-me-dir')
        meEl.style.setProperty('--hd', `${(hd - m.getBearing()).toFixed(1)}deg`) // 화면 위쪽 기준 각도 = 폰 방향 - 지도 회전
        meEl.classList.add('hm-me-dir')
      }
      const sync = () => {
        const p = propsRef.current
        if (!m.getSource('route')) return
        ;(m.getSource('route') as GeoJSONSource | undefined)?.setData(routeCollection(p.path, p.legs, colorOf))
        ;(m.getSource('step') as GeoJSONSource | undefined)?.setData(line(p.guide.coords))
        stEl.textContent = p.guide.turn
        stMk.setLngLat(toLngLat(p.guide.at)).addTo(m)
        stEl.classList.toggle('rt-gstep-near', isStepNear(p.me ? [p.me.lat, p.me.lng] : null, p.guide.at, NAV_STEP_NEAR_M))
        if (p.me) meMk.setLngLat(toLngLat([p.me.lat, p.me.lng])).addTo(m)
        else meMk.remove()
        paintCone()
        follow()
      }
      syncRef.current = sync

      const user = (e: { originalEvent?: unknown }) => {
        if (e.originalEvent) setModeRef.current('free') // 손으로 끌거나 돌리거나 기울이면 따라가기를 멈춘다(버튼으로 다시 켠다)
      }
      m.on('dragstart', user)
      m.on('rotatestart', user)
      m.on('pitchstart', user)
      m.on('rotate', () => {
        if (needle.current) needle.current.style.transform = `rotate(${(-m.getBearing()).toFixed(1)}deg)`
        paintCone()
      })
      m.on('load', () => {
        window.clearTimeout(loadTimer)
        const before = firstSymbolId(style)
        const p = propsRef.current
        m.addSource('route', { type: 'geojson', data: routeCollection(p.path, p.legs, colorOf) })
        m.addSource('step', { type: 'geojson', data: line(p.guide.coords) })
        const lay = (id: string, source: string, color: string | unknown[], w0: number, w1: number) =>
          m.addLayer({ id, type: 'line', source, layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': color as string, 'line-width': ['interpolate', ['linear'], ['zoom'], 14, w0, 18, w1] } }, before)
        lay('route-casing', 'route', '#ffffff', 7, 17)
        lay('route-line', 'route', ['get', 'color'], 4, 11)
        lay('step-casing', 'step', '#ffffff', 9, 21)
        lay('step-line', 'step', '#ff8a00', 6, 14)
        m.addImage('route-arrow', arrowImage(), { pixelRatio: 2 })
        m.addLayer(
          { id: 'route-arrows', type: 'symbol', source: 'route', layout: { 'symbol-placement': 'line', 'symbol-spacing': 90, 'icon-image': 'route-arrow', 'icon-allow-overlap': true, 'icon-ignore-placement': true, 'icon-rotation-alignment': 'map', 'icon-pitch-alignment': 'map' } },
          before,
        )
        m.on('zoomend', drawDeco) // 정류장 묶음은 확대·축소에 맞춰 다시 계산한다
        drawDeco()
        sync()
      })
      // 스타일·타일 한두 개가 늦거나 실패하는 것은 흔하므로 error 이벤트로는 되돌아가지 않는다(스타일 자체가 안 열릴 때만 위 제한 시간으로 되돌아간다)

      timer = window.setInterval(() => {
        const p = propsRef.current
        const ins = p.getInsets()
        const el = wrap.current
        el?.style.setProperty('--gl-top', `${ins.top}px`)
        el?.style.setProperty('--gl-bottom', `${ins.bottom}px`)
        el?.style.setProperty('--gl-left', `${ins.left}px`)
        paintCone()
        const hd = p.headingRef.current
        if (modeRef.current === 'head' && hd !== null && angDiff(hd, lastBearing) > 4) follow() // 나침반이 바뀌면 지도를 따라 돌린다
      }, 250)
      ro = new ResizeObserver(() => m.resize())
      ro.observe(host)
    })().catch(() => {
      if (!ac.signal.aborted) fail()
    })
    return () => {
      dead = true
      ac.abort()
      window.clearTimeout(loadTimer)
      window.clearInterval(timer)
      ro?.disconnect()
      syncRef.current = () => {}
      followRef.current = () => {}
      decoRef.current = () => {}
      map?.remove()
    }
  }, [])

  // 경로·단계·내 위치가 바뀔 때마다 그림을 고치고 따라간다
  const { path, guide, me } = props
  useEffect(() => {
    syncRef.current()
    // guide·me 객체는 매번 새로 만들어지므로 값이 바뀔 때만 다시 그린다
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, guide.n, guide.at[0], guide.at[1], me?.lat, me?.lng])

  // 장애요소·딱지·구간이 바뀔 때만 다시 그린다
  const { legs, hits, markers, focus } = props
  useEffect(() => {
    decoRef.current()
    syncRef.current() // 구간 색도 같이
  }, [legs, hits, markers, focus])

  const choose = (m: Mode) => {
    setMode(m)
    followRef.current()
  }

  return (
    <div ref={wrap} className="gl-nav">
      <div ref={stage} className="gl-stage" />
      <div className="gl-ctl" role="group" aria-label="지도 방향">
        <button type="button" aria-pressed={mode === 'north'} onClick={() => choose('north')}>
          <span ref={needle} className="gl-needle" aria-hidden="true">
            ▲
          </span>
          북쪽 위
        </button>
        <button type="button" aria-pressed={mode === 'head'} onClick={() => choose('head')}>
          진행 방향 위
        </button>
      </div>
      <p className="gl-attr">
        <a href="https://openfreemap.org" target="_blank" rel="noreferrer">
          OpenFreeMap
        </a>{' '}
        <a href="https://www.openmaptiles.org/" target="_blank" rel="noreferrer">
          © OpenMapTiles
        </a>{' '}
        Data from{' '}
        <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">
          OpenStreetMap
        </a>
      </p>
    </div>
  )
}
