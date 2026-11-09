import Icon from './Icon'
import { TO, go, type PageId } from '../lib/nav'

const TABS: { page: PageId; to: string; label: string; icon: string }[] = [
  { page: 'me', to: TO.me, label: '내 정보', icon: 'user' },
  { page: 'map', to: TO.map, label: '동행지도', icon: 'map' },
  { page: 'home', to: TO.home, label: '홈', icon: 'home' },
  { page: 'report', to: TO.report, label: '민원신고', icon: 'report' },
  { page: 'alerts', to: TO.alerts, label: '혜택알림', icon: 'bell' },
]

// 모바일은 아래 고정, PC는 위쪽 내비게이션(CSS가 정한다)
export default function TabBar({ page }: { page: PageId }) {
  return (
    <nav className="tabbar" aria-label="주요 메뉴">
      {TABS.map((t) => (
        <button key={t.page} type="button" className="tabbar-btn" aria-current={page === t.page ? 'page' : undefined} aria-label={t.label} onClick={() => go(t.to)}>
          <Icon name={t.icon} size={22} />
          <span>{t.label}</span>
        </button>
      ))}
    </nav>
  )
}
