import { useEffect, useState } from 'react'
import BarrierMap from './pages/BarrierMap'
import AdminPage from './pages/AdminPage'
import SeedVerify from './pages/SeedVerify'
import ViewSettings from './components/ViewSettings'
import DevBadge from './components/DevBadge'
import RewardToasts from './components/RewardToasts'

// 개발용 확인 화면은 주소 끝이 #/verify일 때만 보여 준다(라우터 라이브러리 없음).
export default function App() {
  const [hash, setHash] = useState(() => location.hash)

  useEffect(() => {
    const onChange = () => setHash(location.hash)
    window.addEventListener('hashchange', onChange)
    return () => window.removeEventListener('hashchange', onChange)
  }, [])

  const page = hash === '#/verify' ? <SeedVerify /> : hash === '#/admin' ? <AdminPage /> : <BarrierMap />
  return (
    <>
      {page}
      {hash === '#/verify' && <ViewSettings floating />}
      <RewardToasts />
      <DevBadge />
    </>
  )
}
