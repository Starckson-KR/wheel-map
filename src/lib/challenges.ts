// 이번 주 참여 챌린지 계산(순수 함수). 점수는 새로 주지 않고, 기존 점수 사건과 제보 기록을 세어 진행 정도만 보여 준다.
import type { Barrier, Report } from '../types'
import { CHALLENGE_NEAR_RADIUS_M, CHALLENGE_WEEKLY } from './config'
import { distanceM, distanceToGeometryM } from './geo'
import { eventsInRange, type PeriodRange } from './ranking'
import type { PointEvent } from './rewards'

export type ChallengeId = 'infoGap' | 'recheck' | 'newReport'
export type Challenge = { id: ChallengeId; now: number; goal: number; done: boolean }

// 정보가 부족한 팀 조사 지점: 평가가 없거나(자료의 평가도, 상위 지점의 평가도 없음) 위치가 확정되지 않은 곳.
// 시연 중 새로 남긴 제보로 바뀌는 값은 쓰지 않는다(자료 기준이라 진행 중에 대상이 줄어들지 않는다).
export function infoGapBarriers(barriers: Barrier[]): Barrier[] {
  const byId = new Map(barriers.map((b) => [b.id, b]))
  return barriers.filter((b) => {
    const rated = b.rating ?? (b.parentId ? byId.get(b.parentId)?.rating : undefined)
    return !rated || !b.geometry
  })
}

function isNear(r: Report, b: Barrier): boolean {
  if (r.seedId === b.id) return true
  if (b.geometry) return distanceToGeometryM(r.lat, r.lng, b.geometry) <= CHALLENGE_NEAR_RADIUS_M
  if (b.provisional) return distanceM(r.lat, r.lng, b.provisional.lat, b.provisional.lng) <= CHALLENGE_NEAR_RADIUS_M
  return false // 위치가 전혀 없는 지점은 거리로 맞출 수 없다
}

export type WeeklyChallenges = {
  items: Challenge[]
  gapCount: number // 대상이 되는 지점 수
  waiting: Report[] // 재확인을 기다리는 건(내 제보 제외: 본인 제보 재확인은 참여로 세지 않는다)
}

export function weeklyChallenges(reports: Report[], userId: string, barriers: Barrier[], events: PointEvent[], range: PeriodRange): WeeklyChallenges {
  const mine = eventsInRange(events, reports, range, true).filter((e) => e.userId === userId)
  const byId = new Map(reports.map((r) => [r.id, r]))
  const gaps = infoGapBarriers(barriers)
  const verified = mine.filter((e) => e.kind === 'verified')
  const gapN = verified.filter((e) => {
    const r = byId.get(e.reportId)
    return !!r && gaps.some((b) => isNear(r, b))
  }).length
  const recheckN = mine.filter((e) => e.kind === 'recheck').length
  const G = CHALLENGE_WEEKLY
  const mk = (id: ChallengeId, now: number, goal: number): Challenge => ({ id, now, goal, done: now >= goal })
  return {
    items: [mk('infoGap', gapN, G.infoGap), mk('recheck', recheckN, G.recheck), mk('newReport', verified.length, G.newReport)],
    gapCount: gaps.length,
    waiting: reports.filter((r) => r.status === 'resolved' && r.userId !== userId),
  }
}
