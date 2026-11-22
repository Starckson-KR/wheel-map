// 첫 화면: 앱 아이콘, 이름, "시작하기" 버튼만 둔다. 뒤에는 흐린 동네 지도 위로 파란 길이 그려지고 끝에 핀이 꽂힌다(장식, 1.8초 안에 끝).
import { PressButton } from '../motionKit'
import { Wordmark } from '../Wordmark'
import { WelcomeMap } from './WelcomeMap'
import { Sentences } from '../Sentences'
import { useXmas } from '../../lib/useXmas'
import WelcomeXmas from './WelcomeXmas'

export default function WelcomeScreen({ onStart }: { onStart: () => void }) {
  // 12월(또는 시연 도구에서 켬)에는 썰매가 길을 그리는 크리스마스 연출로 바꾼다
  const xmas = useXmas()
  if (xmas.on) return <WelcomeXmas onStart={onStart} />
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
        {/* 처음 쓰는 사람에게 서비스가 무엇인지: 이름 아래에 겹쳐 두어(absolute) 지도 길 끝 위치 계산을 바꾸지 않는다 */}
        <Sentences as="p" className="ob-welcome-about">휠체어·유모차로 다니기 불편한 곳을 제보하면 이웃이 확인해요. 계단 없는 길도 찾아 드려요.</Sentences>
      </div>
      <div className="ob-foot ob-welcome-foot">
        <PressButton type="button" className="ob-btn ob-btn-primary" onClick={onStart}>
          시작하기
        </PressButton>
      </div>
    </>
  )
}
