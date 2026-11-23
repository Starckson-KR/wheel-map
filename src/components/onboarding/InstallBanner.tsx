// 홈 맨 위 한 줄 띠: 「홈 화면에 추가하기」. 누르면 기기·설치 안내(OnboardingGate의 device/install 화면)가 열린다.
// 이미 홈 화면 앱으로 열렸거나 한 번 닫았으면 뜨지 않는다.
import { useState } from 'react'
import '../../styles/onboarding.css'
import Icon from '../Icon'
import { INSTALL_EVENT, INSTALL_HINT_KEY } from './flow'
import { isStandalone } from './installEnv'

export const openInstallGuide = () => window.dispatchEvent(new Event(INSTALL_EVENT))

export const installedAsApp = () =>
  isStandalone({ navStandalone: (navigator as Navigator & { standalone?: boolean }).standalone, matchMedia: (q) => window.matchMedia(q) })

const closedBefore = () => {
  try {
    return localStorage.getItem(INSTALL_HINT_KEY) === '1'
  } catch {
    return false
  }
}

export default function InstallBanner() {
  const [show, setShow] = useState(() => !installedAsApp() && !closedBefore())
  if (!show) return null
  const dismiss = () => {
    try {
      localStorage.setItem(INSTALL_HINT_KEY, '1')
    } catch {
      /* 저장이 막혀도 이번 화면에서는 닫힌다 */
    }
    setShow(false)
  }
  return (
    <div className="ob-strip">
      <button type="button" className="ob-strip-go" onClick={openInstallGuide}>
        홈 화면에 추가하기
        <Icon name="chev" size={16} />
      </button>
      <button type="button" className="ob-strip-x" aria-label="닫기" onClick={dismiss}>
        <Icon name="close" size={18} />
      </button>
    </div>
  )
}
