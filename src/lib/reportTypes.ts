import type { ReportCategory } from '../types'

// 명세서 4-1(1)의 장애요소 유형(고정형 7·일시형 5)
export type ReportTypeInfo = { type: string; category: ReportCategory; icon: string; desc: string }

export const REPORT_TYPES: ReportTypeInfo[] = [
  { type: '계단·턱', category: 'fixed', icon: '🪜', desc: '계단이나 높은 턱이 있어 지나가기 어려움' },
  { type: '좁은 보도', category: 'fixed', icon: '↔️', desc: '보도 폭이 좁아 휠체어가 지나기 어려움' },
  { type: '급경사', category: 'fixed', icon: '⛰️', desc: '경사가 가팔라 오르내리기 위험함' },
  { type: '파손 노면', category: 'fixed', icon: '🕳️', desc: '깨지거나 패여 바퀴가 걸리는 노면' },
  { type: '경사로 없음', category: 'fixed', icon: '🚫', desc: '출입구에 경사로가 없음' },
  { type: '수동문', category: 'fixed', icon: '🚪', desc: '손으로 열어야 하는 문이라 혼자 열기 어려움' },
  { type: '장애인화장실 없음', category: 'fixed', icon: '🚻', desc: '이용할 수 있는 장애인화장실이 없음' },
  { type: '쓰레기', category: 'temporary', icon: '🗑️', desc: '길을 막고 있는 쓰레기·적치물' },
  { type: '킥보드·자전거', category: 'temporary', icon: '🛴', desc: '방치된 킥보드·자전거가 길을 막음' },
  { type: '입간판·노점', category: 'temporary', icon: '🪧', desc: '입간판이나 노점이 보도를 차지함' },
  { type: '공사 자재', category: 'temporary', icon: '🚧', desc: '공사 자재·장비가 보도를 막음' },
  { type: '불법 주정차', category: 'temporary', icon: '🚗', desc: '차량이 보도나 횡단보도를 막음' },
]

export const CATEGORY_LABEL: Record<ReportCategory, string> = { fixed: '고정형', temporary: '일시형' }

export const REJECT_REASONS = ['위치 불명확', '사진 불일치', '이미 조치됨', '범위 밖(시각장애 관련 등)'] as const
