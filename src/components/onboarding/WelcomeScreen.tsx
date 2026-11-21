// 첫 화면: 앱 아이콘, 이름, "시작하기" 버튼만 둔다. 뒤에는 흐린 동네 지도 위로 파란 길이 그려지고 끝에 핀이 꽂힌다(장식, 1.8초 안에 끝).
import { PressButton } from '../motionKit'
import { Wordmark } from '../Wordmark'
import { WelcomeMap } from './WelcomeMap'

export default function WelcomeScreen({ onStart }: { onStart: () => void }) {
  return (
    <>
      <div className="ob-welcome-bg" aria-hidden="true">
        <WelcomeMap />
      </div>
      <div className="ob-body ob-welcome">
        <img className="ob-welcome-icon" src={`${import.meta.env.BASE_URL}icons/icon-512.png`} alt="" width={160} height={160} />
        <h1 className="ob-welcome-name" aria-label="이의있음!">
          <Wordmark decorative />
        </h1>
      </div>
      <div className="ob-foot ob-welcome-foot">
        <PressButton type="button" className="ob-btn ob-btn-primary" onClick={onStart}>
          시작하기
        </PressButton>
      </div>
    </>
  )
}
