// 내 정보 탭에 넣는 계정 카드: 로그인한 이름, 초기 설정 다시 하기, 로그아웃.
import '../../styles/onboarding.css'
import { logOut, useGateAccount } from './accountAdapter'
import { ONBOARDING_EVENT } from './flow'

export default function AccountCard() {
  const { user } = useGateAccount()
  return (
    <section className="ob-card" aria-label="계정">
      <div className="ob-card-head">
        <span className="ob-card-avatar" aria-hidden="true">{user ? user.name.slice(0, 1) : '?'}</span>
        <div>
          <strong>{user ? `${user.name}님` : '로그인하지 않았어요'}</strong>
          <small>피드백 기간에만 쓰는 체험 계정이에요</small>
        </div>
      </div>
      <div className="ob-card-actions">
        <button type="button" className="ob-btn ob-btn-sub" onClick={() => window.dispatchEvent(new Event(ONBOARDING_EVENT))}>
          초기 설정 다시 하기
        </button>
        {user && (
          <button type="button" className="ob-btn ob-btn-sub" onClick={() => void logOut()}>
            로그아웃
          </button>
        )}
      </div>
    </section>
  )
}
