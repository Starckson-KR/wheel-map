import { useEffect, useState } from 'react'
import BarrierMap from './pages/BarrierMap'
import AdminPage from './pages/AdminPage'
import SeedVerify from './pages/SeedVerify'
import HomePage from './pages/HomePage'
import { AlertsTab, MeTab, ReportTab } from './pages/TabPages'
import TabBar from './components/TabBar'
import ViewSettings from './components/ViewSettings'
import DevBadge from './components/DevBadge'
import RewardToasts from './components/RewardToasts'
import { parseHash } from './lib/nav'

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

  const { page, query } = parseHash(hash)
  const onMap = page === 'map'
  const body =
    page === 'verify' ? <SeedVerify /> :
    page === 'admin' ? <AdminPage /> :
    page === 'report' ? <ReportTab query={query} /> :
    page === 'me' ? <MeTab /> :
    page === 'alerts' ? <AlertsTab /> :
    page === 'home' ? <HomePage /> :
    null
  const tabs = page !== 'verify' && page !== 'admin'
  return (
    <>
      <div className="app">
        <div className="app-page">
          {keep.on && (
            <div className="app-keep" hidden={!onMap} aria-hidden={!onMap}>
              <BarrierMap key={keep.n} intent={keep.q} active={onMap} />
            </div>
          )}
          {body && <div className="app-view" key={page}>{body}</div>}
        </div>
        {tabs && <TabBar page={page} />}
      </div>
      {page === 'verify' && <ViewSettings floating />}
      <RewardToasts />
      <DevBadge />
    </>
  )
}
