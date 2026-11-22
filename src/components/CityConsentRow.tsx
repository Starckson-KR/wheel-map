import { useEffect, useState } from 'react'
import { useAccount } from '../lib/account/api'
import { recordVisitNow } from '../lib/account/activity'
import { readCityConsent, writeCityConsent } from '../lib/account/cityConsent'
import { PREFS_CHANGE_EVENT } from '../lib/viewPrefs'

// 설정 시트의 「접속 지역 기록」 스위치(로그인했을 때만). 켬='yes', 끔='no'. 끄면 서버가 저장된 지역을 지운다.
export default function CityConsentRow() {
  const loggedIn = useAccount((s) => !!s.user)
  const [v, setV] = useState(readCityConsent)
  useEffect(() => {
    const f = () => setV(readCityConsent())
    window.addEventListener(PREFS_CHANGE_EVENT, f)
    return () => window.removeEventListener(PREFS_CHANGE_EVENT, f)
  }, [])
  if (!loggedIn) return null
  const on = v === 'yes'
  const toggle = () => {
    writeCityConsent(on ? 'no' : 'yes')
    setV(on ? 'no' : 'yes')
    window.dispatchEvent(new Event(PREFS_CHANGE_EVENT))
    if (!on) void recordVisitNow('open')
  }
  return (
    <li>
      <span>
        접속 지역 기록<small>대략적인 도시만 기록해요. 끄면 바로 지워져요</small>
      </span>
      <button type="button" role="switch" aria-checked={on} aria-label="접속 지역 기록" className="cr-sw" onClick={toggle} />
    </li>
  )
}
