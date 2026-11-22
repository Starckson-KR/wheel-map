import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { useAccount } from '../lib/account/api'
import { recordVisitNow } from '../lib/account/activity'
import { CITY_CONSENT_BODY, readCityConsent, shouldAskCityConsent, writeCityConsent } from '../lib/account/cityConsent'
import { getPulledFor, subscribePulled } from '../lib/account/prefsSync'
import { ONBOARDED_KEY } from './onboarding/flow'
import { ONBOARDED_EVENT } from '../lib/usageGuide'
import { PREFS_CHANGE_EVENT } from '../lib/viewPrefs'
import { confirmSheet } from '../lib/uiStore'

// 접속 지역(도시) 기록 동의 카드. 로그인 뒤 서버 설정을 한 번 받아 온 다음, 초기 설정이 끝났고 아직 답이 없을 때 한 번만 묻는다.
// 「동의」는 'yes', 「괜찮아요」·바깥 누름·Esc는 'no'. 화면에는 아무것도 그리지 않는다(확인 시트를 부른다).
const isOnboarded = () => {
  try {
    return localStorage.getItem(ONBOARDED_KEY) === '1'
  } catch {
    return false
  }
}

export default function CityConsent() {
  const userId = useAccount((s) => s.user?.id ?? null)
  const pulled = useSyncExternalStore(subscribePulled, getPulledFor) === userId && userId !== null
  const [tick, setTick] = useState(0) // 초기 설정이 끝나거나 설정 값이 바뀌면 다시 판단
  const asked = useRef<string | null>(null)
  useEffect(() => {
    const f = () => setTick((n) => n + 1)
    window.addEventListener(ONBOARDED_EVENT, f)
    window.addEventListener(PREFS_CHANGE_EVENT, f)
    return () => {
      window.removeEventListener(ONBOARDED_EVENT, f)
      window.removeEventListener(PREFS_CHANGE_EVENT, f)
    }
  }, [])
  useEffect(() => {
    if (!userId || asked.current === userId) return
    if (!shouldAskCityConsent({ loggedIn: true, onboarded: isOnboarded(), pulled, value: readCityConsent() })) return
    asked.current = userId
    void confirmSheet({ title: '접속 지역 기록', body: CITY_CONSENT_BODY, confirmLabel: '동의', cancelLabel: '괜찮아요' }).then((ok) => {
      writeCityConsent(ok ? 'yes' : 'no')
      window.dispatchEvent(new Event(PREFS_CHANGE_EVENT))
      if (ok) void recordVisitNow('open') // 도시가 바로 보이게
    })
  }, [userId, pulled, tick])
  return null
}
