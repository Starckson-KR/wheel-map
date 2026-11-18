// 하단 탭(모바일)·위쪽 내비(PC)의 순서와 주소. 화면 전환 방향(TAB_ORDER)도 이 순서를 따른다.
import { TO, type PageId } from './nav'

export type TabItem = { page: PageId; to: string; label: string; icon: string; fab?: boolean }

// 가운데는 큰 원형 [제보] 버튼(fab). 누르면 민원신고 화면이 열린다.
export const TAB_ITEMS: readonly TabItem[] = [
  { page: 'home', to: TO.home, label: '홈', icon: 'home' },
  { page: 'map', to: TO.map, label: '동행지도', icon: 'map' },
  { page: 'report', to: TO.report, label: '제보', icon: 'plus', fab: true },
  { page: 'alerts', to: TO.alerts, label: '혜택알림', icon: 'bell' },
  { page: 'me', to: TO.me, label: '내 정보', icon: 'user' },
]
