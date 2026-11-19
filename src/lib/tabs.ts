// 하단 탭(모바일)·위쪽 내비(PC)의 순서와 주소. 화면 전환 방향(TAB_ORDER)도 이 순서를 따른다.
import { TO, type PageId } from './nav'

export type TabItem = { page: PageId; to: string; label: string; icon: string; fab?: boolean }

// 가운데는 큰 원형 [제보] 버튼(fab). 누르면 제보 화면이 열린다.
export const TAB_ITEMS: readonly TabItem[] = [
  { page: 'home', to: TO.home, label: '홈', icon: 'home' },
  { page: 'map', to: TO.map, label: '동행지도', icon: 'map' },
  { page: 'report', to: TO.report, label: '제보', icon: 'plus', fab: true },
  { page: 'alerts', to: TO.alerts, label: '혜택알림', icon: 'bell' },
  { page: 'me', to: TO.me, label: '내 정보', icon: 'user' },
]

// 가운데 [제보] 길게 누르면 펼쳐지는 유형 부채꼴(왼쪽→오른쪽). type이 없는 항목은 「더보기」(제보 화면에서 나머지 유형 고르기).
export type FanItem = { label: string; type?: string }
export const FAN_ITEMS: readonly FanItem[] = [
  { label: '계단·턱', type: '계단·턱' },
  { label: '불법 주정차', type: '불법 주정차' },
  { label: '파손 노면', type: '파손 노면' },
  { label: '쓰레기', type: '쓰레기' },
  { label: '더보기' },
]

/** 부채꼴 항목을 골랐을 때 가는 주소: 유형을 이미 골랐으니 2단계(위치)부터 여는 제보 화면, 더보기는 유형 목록이 처음부터 보이는 제보 화면 */
export function fanTarget(item: FanItem): string {
  return item.type ? `${TO.newReport}&type=${encodeURIComponent(item.type)}&step=where` : TO.newReport
}
