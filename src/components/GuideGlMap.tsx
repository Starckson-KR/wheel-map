// 길 안내 새 지도 시험판: 안내 중에 카카오 지도 위를 덮는 MapLibre GL 지도(진행 방향 위 회전·기울이기).
// 이 파일만 maplibre-gl을 불러오고, BarrierMap이 React.lazy로 불러오므로 길 안내를 시작할 때까지 내려받지 않는다.
// 좌표 순서: 앱은 [lat, lng], MapLibre는 [lng, lat] — toLngLat 한 곳에서만 바꾼다.
import { useEffect, useRef, useState, type RefObject } from 'react'
import { Map as GlMap, Marker, setWorkerUrl, type GeoJSONSource } from 'maplibre-gl'
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url' // 번들러가 워커 파일 위치를 알 수 있게 주소를 직접 넘긴다(v6 안내)
import 'maplibre-gl/dist/maplibre-gl.css'
import { NAV_STEP_NEAR_M, NAV_Z } from '../lib/config'
import { GL_STYLE_URL, bearingAhead, firstSymbolId, followPadding, koreanizeStyle, toLngLat } from '../lib/guideGl/core.ts'
import type { Pt } from '../lib/routing/engine.ts'
import { isStepNear } from '../lib/routing/followNav.ts'
import { prefersCalm } from '../lib/viewPrefs'

type Mode = 'head' | 'north' | 'free' // 진행 방향 위(회전·기울임) / 북쪽 위(평평) / 직접 움직이는 중
type Guide = { coords: Pt[]; next: Pt[]; at: Pt; turn: string; n: number }
type Props = {
  path: Pt[] // 안내 중인 전체 경로 [lat,lng]
  guide: Guide
  me: { lat: number; lng: number } | null
  headingRef: RefObject<number | null> // 폰이 향한 방향(북=0, 시계 방향). 모르면 null
  getInsets: () => { top: number; bottom: number; left: number } // 위·아래·왼쪽을 덮은 패널 크기(px)
  onFail: () => void // 못 쓰면 카카오 지도로 돌아간다
}

setWorkerUrl(workerUrl)

const HEAD_PITCH = 45
const FIRST_ZOOM = 17.5
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
      if (import.meta.env.DEV) (window as unknown as { __glNav?: unknown }).__glNav = { map: m, headingRef: p0.headingRef, get mode() { return modeRef.current } }

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
        ;(m.getSource('route') as GeoJSONSource | undefined)?.setData(line(p.path))
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
        m.addSource('route', { type: 'geojson', data: line(p.path) })
        m.addSource('step', { type: 'geojson', data: line(p.guide.coords) })
        const lay = (id: string, source: string, color: string, w0: number, w1: number) =>
          m.addLayer({ id, type: 'line', source, layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': color, 'line-width': ['interpolate', ['linear'], ['zoom'], 14, w0, 18, w1] } }, before)
        lay('route-casing', 'route', '#ffffff', 7, 17)
        lay('route-line', 'route', '#2272eb', 4, 11)
        lay('step-casing', 'step', '#ffffff', 9, 21)
        lay('step-line', 'step', '#ff8a00', 6, 14)
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
      map?.remove()
      if (import.meta.env.DEV) delete (window as unknown as { __glNav?: unknown }).__glNav
    }
  }, [])

  // 경로·단계·내 위치가 바뀔 때마다 그림을 고치고 따라간다
  const { path, guide, me } = props
  useEffect(() => {
    syncRef.current()
    // guide·me 객체는 매번 새로 만들어지므로 값이 바뀔 때만 다시 그린다
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, guide.n, guide.at[0], guide.at[1], me?.lat, me?.lng])

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
