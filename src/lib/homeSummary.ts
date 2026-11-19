// 홈 화면의 순수 계산: 「내 제보」 요약과 「자주 쓰는 서비스」 6번째 칸. 화면 없이 시험할 수 있게 따로 둔다.
import type { ReportStatus } from '../types'
import { TO } from './nav'

export type MineSummary = {
  total: number // 내 제보 전체(합쳐짐·반려 포함)
  active: number // 처리 중: 아직 끝나지 않은 제보(접수·검증·배정·조치)
  waiting: number // 검증 대기
  fixed: number // 고쳐짐: 조치 완료 이상
}

const ACTIVE: readonly ReportStatus[] = ['submitted', 'pending', 'verified', 'filed', 'assigned', 'in_progress']
const WAITING: readonly ReportStatus[] = ['submitted', 'pending']
const FIXED: readonly ReportStatus[] = ['resolved', 'rechecked']

/** 현재 사용자의 제보를 상태별로 센다. 다른 사용자의 제보는 세지 않는다. */
export function summarizeMine(reports: readonly { userId: string; status: ReportStatus }[], userId: string): MineSummary {
  const mine = reports.filter((r) => r.userId === userId)
  const n = (list: readonly ReportStatus[]) => mine.filter((r) => list.includes(r.status)).length
  return { total: mine.length, active: n(ACTIVE), waiting: n(WAITING), fixed: n(FIXED) }
}

/** 「내 제보」 카드 문구 */
export function mineLines(s: MineSummary): { big: string; sub: string } {
  if (s.total === 0) return { big: '아직 제보가 없어요', sub: '' }
  return { big: `${s.active}건 처리 중`, sub: `검증 대기 ${s.waiting} · 고쳐짐 ${s.fixed}` }
}

// ───── 자주 쓰는 서비스 ─────
export type HomeTile = { id: string; label: string; icon: string; to: string }

/** 고정 5칸. 길찾기는 예전 홈과 같은 주소(TO.route)로 간다. */
export const FIXED_TILES: readonly HomeTile[] = [
  { id: 'route', label: '길찾기', icon: 'route', to: TO.route },
  { id: 'alerts', label: '혜택알림', icon: 'bell', to: TO.alerts },
  { id: 'report', label: '제보', icon: 'report', to: TO.report },
  { id: 'receipt', label: '접수번호 찾기', icon: 'search', to: '#/report?section=receipt' },
  { id: 'agency', label: '담당 기관', icon: 'building', to: TO.agency },
]

/** 6번째 칸으로 고를 수 있는 화면(모두 실제로 있는 주소). to가 ''이면 이용 안내 창을 연다. */
export const EXTRA_TILES: readonly HomeTile[] = [
  { id: 'bus', label: '저상버스 도착', icon: 'bus', to: TO.bus },
  { id: 'progress', label: '개선 현황', icon: 'check', to: TO.progress },
  { id: 'verify', label: '이웃 제보 확인', icon: 'user', to: '#/report?section=verify' },
  { id: 'map', label: '동행지도', icon: 'map', to: TO.map },
  { id: 'rewards', label: '내 기여', icon: 'star', to: TO.me },
  { id: 'guide', label: '이용 안내', icon: 'help', to: '' },
]

export const HOME_EXTRA_KEY = 'wheelmap.homeExtra'

/** 저장된 값이 목록에 있는 항목일 때만 쓴다(옛 값·깨진 값은 비움). */
export function parseHomeExtra(raw: string | null | undefined): HomeTile | null {
  return EXTRA_TILES.find((t) => t.id === raw) ?? null
}
