// 크리스마스 모드(발표용)의 뿌리: 관리자가 켜면 모든 기기가 새로 고쳐지며 여기서 시작한다.
//  - <html class="xmas-mode">: 크리스마스 색(xmas.css의 토큰 재정의)
//  - 첫 화면 연출(XmasIntro) → X를 누르면 눈 내리는 홈(HomePage가 눈과 선물 상자를 맡는다)
//  - 구석의 소리 버튼, 버튼·탭을 누를 때 튀는 작은 반짝이
import { Suspense, lazy, useEffect, useState, useSyncExternalStore } from 'react'
import { useXmas } from '../lib/useXmas'
import { dismissXmasIntro } from '../lib/xmas'
import { prefersCalm } from '../lib/viewPrefs'
import { soundSnapshot, stopSong, subscribeSound, toggleSound } from '../lib/xmasAudio'
import { TO, go, parseHash } from '../lib/nav'
import { loadXmasFont, unloadXmasFont } from '../lib/xmasFont'
import '../styles/xmas.css'

const XmasIntro = lazy(() => import('./XmasIntro'))
const MAX_TAPS = 6

function tapSpark(x: number, y: number) {
  if (document.querySelectorAll('.xm-tap').length >= MAX_TAPS) return
  const el = document.createElement('span')
  el.className = 'xm-tap'
  el.setAttribute('aria-hidden', 'true')
  el.style.left = `${x}px`
  el.style.top = `${y}px`
  for (let i = 0; i < 3; i++) {
    const p = document.createElement('i')
    const a = -Math.PI / 2 + (i - 1) * 1.1 + (Math.random() - 0.5) * 0.5
    p.style.setProperty('--dx', `${Math.round(Math.cos(a) * 26)}px`)
    p.style.setProperty('--dy', `${Math.round(Math.sin(a) * 26)}px`)
    el.appendChild(p)
  }
  document.body.appendChild(el)
  window.setTimeout(() => el.remove(), 560)
}

export default function XmasMode() {
  const xmas = useXmas()
  const sound = useSyncExternalStore(subscribeSound, soundSnapshot)
  // 지도 화면에서는 아래 시트 머리(장소 수)를 가리지 않게 소리 버튼을 조금 올린다
  const [onMap, setOnMap] = useState(() => parseHash(location.hash).page === 'map')
  useEffect(() => {
    const h = () => setOnMap(parseHash(location.hash).page === 'map')
    window.addEventListener('hashchange', h)
    return () => window.removeEventListener('hashchange', h)
  }, [])

  useEffect(() => {
    document.documentElement.classList.toggle('xmas-mode', xmas.mode)
    if (!xmas.mode) stopSong()
    // 문구 글꼴은 모드가 켜지는 즉시 미리 받아 둔다(첫 화면 문구가 나오기 전에 준비되게). 평소에는 요청하지 않는다
    if (xmas.mode) loadXmasFont()
    else unloadXmasFont()
    return () => document.documentElement.classList.remove('xmas-mode')
  }, [xmas.mode])

  // 버튼·탭을 누르면 작은 반짝이가 튄다(누르는 것은 막지 않는다)
  useEffect(() => {
    if (!xmas.mode) return
    const h = (e: PointerEvent) => {
      if (prefersCalm()) return
      const t = e.target as Element | null
      if (!t?.closest || t.closest('.xi, .xg, .xm-sound') || !t.closest('button, a, [role="tab"], [role="button"]')) return
      tapSpark(e.clientX, e.clientY)
    }
    document.addEventListener('pointerdown', h, { capture: true, passive: true })
    return () => document.removeEventListener('pointerdown', h, { capture: true })
  }, [xmas.mode])

  if (!xmas.mode) return null
  const on = sound.playing && !sound.muted
  return (
    <>
      {xmas.intro && (
        <Suspense fallback={null}>
          <XmasIntro
            onClose={() => {
              dismissXmasIntro()
              go(TO.home)
            }}
          />
        </Suspense>
      )}
      {!prefersCalm() && (
        <button type="button" className={'xm-sound' + (xmas.intro ? ' in-intro' : onMap ? ' on-map' : '') + (on ? ' playing' : '')} aria-label={on ? '소리 끄기' : '소리 켜기'} aria-pressed={on} onClick={toggleSound}>
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
            <path d="M4 9.5v5h3.5L12 18.5v-13L7.5 9.5Z" fill="currentColor" />
            {sound.muted ? <path d="M16 9.5l5 5M21 9.5l-5 5" /> : <path d="M15.5 9a4 4 0 0 1 0 6M18 6.5a7.5 7.5 0 0 1 0 11" />}
          </svg>
        </button>
      )}
    </>
  )
}
