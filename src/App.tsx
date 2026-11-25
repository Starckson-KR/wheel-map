import { Suspense, lazy, useEffect, useState } from 'react'
import HomePage from './pages/HomePage'
import { AlertsTab, MeTab, ReportTab } from './pages/TabPages'
import { m } from 'motion/react'
import TabBar from './components/TabBar'
import ViewSettings from './components/ViewSettings'
import DevBadge from './components/DevBadge'
import RewardToasts from './components/RewardToasts'
import UiLayer from './components/UiLayer'
import OnboardingGate from './components/onboarding/OnboardingGate'
import CityConsent from './components/CityConsent'
import UsageGuide from './components/UsageGuide'
import { parseHash } from './lib/nav'
import { LazyMap, loadedMap, preloadMap } from './lib/mapChunk'
import { FADE, PAGE_SHIFT, SPRING, TAB_ORDER } from './lib/motionTokens'

// 행정·개발 화면은 일반 이용자 경로에 없으므로 들어갈 때만 내려받는다.
const AdminPage = lazy(() => import('./pages/AdminPage'))
const SeedVerify = lazy(() => import('./pages/SeedVerify'))

// 지도 묶음은 따로 내려받는다. 미리 받아 둔 뒤라면 곧바로 그리고, 아직이면 지도 자리와 같은 배경만 조용히 보인다.
// 어느 쪽으로 그릴지는 처음 한 번만 정한다(중간에 바꾸면 지도가 다시 만들어져 위치·결과가 사라진다).
function MapSlot({ n, intent, active }: { n: number; intent: string; active: boolean }) {
  const [Map] = useState(() => loadedMap() ?? LazyMap)
  return (
    <Suspense fallback={<div className="bm pg" aria-hidden="true" />}>
      <Map key={n} intent={intent} active={active} />
    </Suspense>
  )
}

// 지도는 한 번 만든 뒤 탭을 바꿔도 남겨 두고 숨기기만 한다(위치·확대·고른 지점·길찾기 결과 유지).
// 진입 옵션(#/map?go=...)이 있으면 그 옵션을 새로 적용하려고 지도를 다시 만든다.
type MapKeep = { on: boolean; n: number; q: string }
const nextKeep = (prev: MapKeep, hash: string): MapKeep => {
  const { page, query } = parseHash(hash)
  if (page !== 'map') return prev
  return query ? { on: true, n: prev.n + 1, q: query } : { ...prev, on: true }
}

// 라우터 라이브러리 없이 해시로 화면을 고른다: #/ #/map #/report #/me #/alerts, 개발용 #/verify, 행정 #/admin
export default function App() {
  const [hash, setHash] = useState(() => location.hash)
  const [keep, setKeep] = useState<MapKeep>(() => nextKeep({ on: false, n: 0, q: '' }, location.hash))

  useEffect(() => {
    const onChange = () => {
      setHash(location.hash)
      setKeep((k) => nextKeep(k, location.hash))
    }
    window.addEventListener('hashchange', onChange)
    return () => window.removeEventListener('hashchange', onChange)
  }, [])

  // 지도 묶음 미리 받기: 앱이 뜬 뒤 한가할 때, 또는 그 전에 화면 어디든 처음 손이 닿을 때
  useEffect(() => {
    const opts = { capture: true, passive: true } as const
    const stop = () => {
      window.removeEventListener('pointerdown', run, opts)
      window.removeEventListener('keydown', run, opts)
    }
    const run = () => {
      stop()
      preloadMap()
    }
    window.addEventListener('pointerdown', run, opts)
    window.addEventListener('keydown', run, opts)
    const idle = typeof window.requestIdleCallback === 'function'
    const id = idle ? window.requestIdleCallback(run, { timeout: 2500 }) : window.setTimeout(run, 1200)
    return () => {
      stop()
      if (idle) window.cancelIdleCallback(id)
      else clearTimeout(id)
    }
  }, [])

  const { page, query } = parseHash(hash)
  const onMap = page === 'map'
  // 탭 순서상 오른쪽으로 가면 새 화면이 오른쪽에서, 왼쪽이면 왼쪽에서 들어온다(탭이 아닌 화면은 방향 없음)
  const [nav, setNav] = useState<{ page: string; dir: -1 | 0 | 1 }>({ page, dir: 0 })
  if (nav.page !== page) {
    const a = TAB_ORDER.indexOf(nav.page)
    const b = TAB_ORDER.indexOf(page)
    setNav({ page, dir: a < 0 || b < 0 ? 0 : b > a ? 1 : -1 })
  }
  const pageIn = { opacity: 0, x: nav.dir * PAGE_SHIFT }
  const pageTr = { x: SPRING.screen, opacity: FADE } as const
  const body =
    page === 'verify' ? <SeedVerify /> :
    page === 'admin' ? <AdminPage /> :
    page === 'report' ? <ReportTab query={query} /> :
    page === 'me' ? <MeTab query={query} /> :
    page === 'alerts' ? <AlertsTab query={query} /> :
    page === 'home' ? <HomePage /> :
    null
  const tabs = page !== 'verify' && page !== 'admin'
  // 처음 온 사람(로그인 전·초기 설정 전)에게는 초기 설정 화면이 앱을 덮는다. 행정·개발 화면은 건너뛴다.
  return (
    <OnboardingGate>
      <div className="app">
        <div className="app-page">
          {keep.on && (
            <m.div
              className="app-keep"
              hidden={!onMap}
              aria-hidden={!onMap}
              initial={false}
              variants={{ on: { opacity: [0, 1], x: [nav.dir * PAGE_SHIFT, 0], transition: pageTr }, off: { opacity: 0, transition: { duration: 0 } } }}
              animate={onMap ? 'on' : 'off'}
            >
              <MapSlot n={keep.n} intent={keep.q} active={onMap} />
            </m.div>
          )}
          {body && (
            <m.div className="app-view" key={page} initial={pageIn} animate={{ opacity: 1, x: 0 }} transition={pageTr}>
              <Suspense fallback={null}>{body}</Suspense>
            </m.div>
          )}
        </div>
        {tabs && <TabBar page={page} />}
      </div>
      {page === 'verify' && <ViewSettings floating />}
      <RewardToasts />
      <UsageGuide />
      <CityConsent />
      <UiLayer />
      <DevBadge />
    </OnboardingGate>
  )
}
