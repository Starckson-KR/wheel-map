// 홈 화면에 추가하는 순서 안내(아이폰 Safari / 갤럭시 삼성 인터넷·Chrome). 화면에는 눌러야 할 것만 짧게 쓴다.
// 메뉴 이름 출처(2026-11-17 확인):
//  - 아이폰 Safari: Apple 지원 "홈 화면에 웹사이트 아이콘 추가하기" https://support.apple.com/ko-kr/guide/iphone/iph42ab2f3a7/ios (iOS 27 안내서)
//  - 안드로이드 Chrome: Google Chrome 고객센터 "웹사이트를 앱으로 설치" https://support.google.com/chrome/answer/9658361?hl=ko
//  - 삼성 인터넷: 공식 자료를 찾지 못함(삼성 도움말·개발자 문서에 없음). 여러 사용 안내 글이 같은 순서로 적고 있어 그대로 쓰되 확인이 필요하다.
import { useState, type ReactNode } from 'react'
import { PressButton, SegBg } from '../motionKit'
import { guessAndroidBrowser, isInAppBrowser, type AndroidBrowser, type Device } from './installEnv'
import { useInstallPrompt } from './installPrompt'

const svg = (children: ReactNode) => (
  <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
    {children}
  </svg>
)
// 직접 그린 단순 아이콘
const IC = {
  share: svg(<><path d="M12 14.5V4" /><path d="M8.5 7.5L12 4l3.5 3.5" /><path d="M8 10H7a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-6a2 2 0 0 0-2-2h-1" /></>),
  addBox: svg(<><rect x="4" y="4" width="16" height="16" rx="4" /><path d="M12 8.5v7M8.5 12h7" /></>),
  dotsH: svg(<><circle cx="6" cy="12" r="1.2" fill="currentColor" /><circle cx="12" cy="12" r="1.2" fill="currentColor" /><circle cx="18" cy="12" r="1.2" fill="currentColor" /></>),
  dotsV: svg(<><circle cx="12" cy="6" r="1.2" fill="currentColor" /><circle cx="12" cy="12" r="1.2" fill="currentColor" /><circle cx="12" cy="18" r="1.2" fill="currentColor" /></>),
  menu: svg(<path d="M5 7h14M5 12h14M5 17h14" />),
}

type Step = { text: ReactNode; icon?: ReactNode }

function Steps({ steps }: { steps: Step[] }) {
  return (
    <ol className="ob-steps">
      {steps.map((s, i) => (
        <li key={i} className="ob-step">
          <span className="ob-step-n" aria-hidden="true">{i + 1}</span>
          <span className="ob-step-t">{s.text}</span>
          {s.icon && <span className="ob-step-ic" aria-hidden="true">{s.icon}</span>}
        </li>
      ))}
    </ol>
  )
}

const b = (t: string) => <strong>{t}</strong>

const IOS_STEPS: Step[] = [
  { text: <>{b('Safari')}에서 열어요</> },
  { text: <>{b('공유')} 버튼을 눌러요. 안 보이면 {b('⋯')} 안에 있어요</>, icon: IC.share },
  { text: <>아래로 밀어 {b('홈 화면에 추가')}를 눌러요</>, icon: IC.addBox },
  { text: <>{b('웹 앱으로 열기')}가 켜진 채로 {b('추가')}를 눌러요</> },
]
const SAMSUNG_STEPS: Step[] = [
  { text: <>오른쪽 아래 {b('메뉴')}를 눌러요</>, icon: IC.menu },
  { text: <>{b('현재 페이지 추가')}를 눌러요</> },
  { text: <>{b('홈 화면')}을 골라 {b('추가')}를 눌러요</> },
]
const CHROME_STEPS: Step[] = [
  { text: <>주소창 오른쪽 {b('더보기')}를 눌러요</>, icon: IC.dotsV },
  { text: <>{b('설치 및 바로가기 만들기')}를 눌러요</> },
  { text: <>{b('설치')}를 눌러요</> },
]

export default function InstallGuide({ device }: { device: Device }) {
  const ua = navigator.userAgent
  const [browser, setBrowser] = useState<AndroidBrowser>(() => guessAndroidBrowser(ua))
  const { available, installed, install } = useInstallPrompt()
  const inApp = isInAppBrowser(ua)
  const showInstall = device === 'android' && browser === 'chrome' && available

  return (
    <>
      <h1 className="ob-title" tabIndex={-1} ref={(el) => el?.focus({ preventScroll: true })}>홈 화면에 추가해요</h1>
      <p className="ob-sub">앱처럼 바로 열 수 있어요.</p>
      {inApp && <p className="ob-note" role="note">지금은 앱 안 화면이에요. {device === 'ios' ? 'Safari' : '인터넷 앱'}에서 다시 열어 주세요.</p>}
      {device === 'android' && (
        <div className="ob-setrow">
          <div className="ob-seg" role="radiogroup" aria-label="쓰는 브라우저">
            {([['samsung', '삼성 인터넷'], ['chrome', 'Chrome']] as const).map(([id, label]) => (
              <PressButton key={id} type="button" role="radio" aria-checked={browser === id} className={browser === id ? 'is-on' : ''} onClick={() => setBrowser(id)}>
                {browser === id && <SegBg group="seg-ob-install" />}
                {label}
              </PressButton>
            ))}
          </div>
        </div>
      )}
      {showInstall && (
        <PressButton type="button" className="ob-btn ob-btn-primary ob-install" onClick={() => void install()}>
          앱 설치
        </PressButton>
      )}
      {installed && <p className="ob-note" role="status">설치됐어요. 홈 화면에서 열어 주세요.</p>}
      <Steps steps={device === 'ios' ? IOS_STEPS : browser === 'samsung' ? SAMSUNG_STEPS : CHROME_STEPS} />
    </>
  )
}
