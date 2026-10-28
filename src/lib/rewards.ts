// 시민 참여 리워드 계산(명세서 4-2, 4-5). 점수·칭호는 저장하지 않고 제보 기록(reports)과 그 history에서 매번 계산한다.
// 그래서 기록과 점수가 어긋나지 않는다. 값(점수·조건)은 모두 config.ts의 REWARD_* (안)에 있다.
import type { Barrier, Report } from '../types'
import {
  REWARD_DAILY_CAP,
  REWARD_EVIDENCE_PHOTOS,
  REWARD_GRADE_RULES,
  REWARD_POINTS,
  REWARD_TYPE_EMBLEM_MIN,
} from './config'
import { shortName } from './display'
import { ROUTES, routeStats, type RouteDef } from './routeStats'

export type PointKind = 'verified' | 'evidence' | 'ledToAction' | 'voteMatch' | 'merge' | 'recheck'

export type PointEvent = {
  id: string
  userId: string
  at: string
  kind: PointKind
  base: number // 규칙상 점수
  points: number // 하루 상한을 적용한 실제 점수
  reportId: string
  label: string // 어떤 일인지 (화면 문구)
}

// ───── 엠블럼·칭호 정의 ─────
export type EmblemTone = 'green' | 'blue' | 'purple' | 'amber'
export type EmblemDef = { id: string; name: string; glyph: string; tone: EmblemTone; how: string; grade?: number }

// 등급 1~4 + 특별은 칭호이자 엠블럼이다(이름 같음). 이름은 명세서의 "안"이며 팀 회의에서 확정한다.
export const GRADE_EMBLEMS: EmblemDef[] = [
  { id: 'g1', grade: 1, name: '길 살핌이', glyph: '🌱', tone: 'green', how: '검증된 제보 1건' },
  { id: 'g2', grade: 2, name: '길 지킴이', glyph: '🌿', tone: 'green', how: '검증된 제보 5건 또는 확인 투표 20회' },
  { id: 'g3', grade: 3, name: '길 잇는 사람', glyph: '🌳', tone: 'blue', how: '검증된 제보 15건과, 조치 완료로 이어진 제보 3건' },
  { id: 'g4', grade: 4, name: '동네 무장애 파수꾼', glyph: '🏅', tone: 'amber', how: '동행 점검 3회 참여' },
]
export const SPECIAL_EMBLEM: EmblemDef = { id: 'special', name: '경로 개척자', glyph: '🧭', tone: 'purple', how: '한 경로의 장애요소를 모두 조치 완료로 이끌기' }
export const TYPE_EMBLEMS: EmblemDef[] = [
  { id: 'stop', name: '정류장 탐험가', glyph: '🚏', tone: 'blue', how: `정류장 제보 ${REWARD_TYPE_EMBLEM_MIN}건 검증` },
  { id: 'cross', name: '횡단보도 감시자', glyph: '🚸', tone: 'amber', how: `횡단보도 제보 ${REWARD_TYPE_EMBLEM_MIN}건 검증` },
  { id: 'temp', name: '일시 장애물 해결사', glyph: '🧹', tone: 'green', how: `일시적인 장애물 제보 ${REWARD_TYPE_EMBLEM_MIN}건 검증` },
]
export const ALL_EMBLEMS: EmblemDef[] = [...GRADE_EMBLEMS, SPECIAL_EMBLEM, ...TYPE_EMBLEMS]
export const EMBLEM_BY_ID = new Map(ALL_EMBLEMS.map((e) => [e.id, e]))

// ───── 기록에서 읽는 도우미 ─────
const verifiedAt = (r: Report) => r.history.find((h) => h.status === 'verified')?.at
// 재확인 통과 기록. passable 필드가 없던 예전 기록은 메모 문구로 가려낸다.
const isPassEntry = (h: Report['history'][number]) => h.status === 'rechecked' && (h.passable ?? /통과 가능/.test(h.memo ?? ''))
export const passedRecheckAt = (r: Report) => r.history.find(isPassEntry)?.at
const hasEvidence = (r: Report) => !!r.measurements && (typeof r.measurements.widthM === 'number' || typeof r.measurements.curbCm === 'number') && r.photos.length >= REWARD_EVIDENCE_PHOTOS
const dayKey = (iso: string) => new Date(iso).toLocaleDateString('sv-SE') // 사용자 기기 시간대 기준 날짜

function isVerifiedReport(r: Report): boolean {
  return r.verification.result === 'confirmed' && r.status !== 'merged' && r.status !== 'rejected' && !!verifiedAt(r)
}

const typeLabel = (r: Report) => r.type

// 모든 점수 사건을 만든다(하루 상한 적용 전). 사용자 구분 없이 한 번에 만든다.
function rawEvents(reports: Report[]): Omit<PointEvent, 'points'>[] {
  const out: Omit<PointEvent, 'points'>[] = []
  const byId = new Map(reports.map((r) => [r.id, r]))
  const add = (userId: string, at: string, kind: PointKind, base: number, r: Report, label: string, suffix = '') =>
    out.push({ id: `${r.id}:${kind}:${userId}${suffix}`, userId, at, kind, base, reportId: r.id, label })

  for (const r of reports) {
    // 제보 작성은 0점(검증 전에는 점수 없음). 반려도 0점이다(허위·악의 판정이 따로 없어 감점 −20은 적용하지 않는다).
    if (isVerifiedReport(r)) {
      const vAt = verifiedAt(r) as string
      add(r.userId, vAt, 'verified', REWARD_POINTS.verified, r, `${typeLabel(r)} 제보가 검증됐어요`)
      if (hasEvidence(r)) add(r.userId, vAt, 'evidence', REWARD_POINTS.evidence, r, `${typeLabel(r)} 제보에 실측값과 사진을 잘 남겼어요`)
      // 확인 투표: 결과가 검증과 일치(=검증 완료)한 투표만 점수가 된다.
      for (const v of r.verification.voterIds) {
        if (v !== r.userId) add(v, vAt, 'voteMatch', REWARD_POINTS.voteMatch, r, `${typeLabel(r)} 제보 확인 투표가 검증과 일치했어요`)
      }
      const pAt = passedRecheckAt(r)
      if (pAt) add(r.userId, pAt, 'ledToAction', REWARD_POINTS.ledToAction, r, `${typeLabel(r)} 제보가 조치 완료로 이어졌어요`)
    }
    // 재확인 참여: 본인 제보가 아닌 건의 재확인(통과·불통과 모두). 같은 사람이 같은 건에 반복해도 기록마다 한 번씩만 센다.
    r.history.forEach((h, i) => {
      if (h.status === 'rechecked' && h.by !== r.userId && h.by !== 'mock-api') add(h.by, h.at, 'recheck', REWARD_POINTS.recheck, r, `${typeLabel(r)} 조치 결과 재확인에 참여했어요`, `:${i}`)
    })
    // 같은 지점 중복 제보: 첫 제보자만 제보 점수를 받고, 합쳐진 제보자는 확인 점수를 받는다(대상이 검증된 뒤에).
    if (r.status === 'merged' && r.barrierId) {
      const target = byId.get(r.barrierId)
      const mergedAt = r.history.find((h) => h.status === 'merged')?.at ?? r.createdAt
      if (!target) add(r.userId, mergedAt, 'merge', REWARD_POINTS.voteMatch, r, `${typeLabel(r)} 같은 곳을 먼저 제보한 건을 확인했어요`) // 팀 조사 지점에 합친 경우
      else if (isVerifiedReport(target)) {
        const tAt = verifiedAt(target) as string
        add(r.userId, tAt > mergedAt ? tAt : mergedAt, 'merge', REWARD_POINTS.voteMatch, r, `${typeLabel(r)} 같은 곳을 먼저 제보한 건을 확인했어요`)
      }
    }
  }
  return out
}

// 하루 점수 상한을 시간 순서대로 적용한다.
function applyCap(events: Omit<PointEvent, 'points'>[]): PointEvent[] {
  const used = new Map<string, number>() // 사용자|날짜 → 이미 받은 점수
  return events
    .slice()
    .sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : a.id < b.id ? -1 : 1))
    .map((e) => {
      const k = e.userId + '|' + dayKey(e.at)
      const left = Math.max(0, REWARD_DAILY_CAP - (used.get(k) ?? 0))
      const points = e.base > 0 ? Math.min(e.base, left) : e.base
      used.set(k, (used.get(k) ?? 0) + Math.max(0, points))
      return { ...e, points }
    })
}

export type Progress = { label: string; now: number; need: number }
export type NextGrade = { name: string; how: string; progress: Progress[]; anyOf?: boolean; note?: string }

export type UserReward = {
  userId: string
  total: number
  events: PointEvent[] // 오래된 순
  counts: { verified: number; votes: number; ledToAction: number; companion: number }
  grade: number // 0이면 아직 칭호 없음
  title: string // 칭호 이름(없으면 '')
  earned: string[] // 받은 엠블럼 id
  next: NextGrade | null
}

function pioneerRoute(userId: string, reports: Report[]): RouteDef | null {
  const passedSeeds = new Set(reports.filter((r) => r.userId === userId && r.seedId && isVerifiedReport(r) && passedRecheckAt(r)).map((r) => r.seedId as string))
  return ROUTES.find((rt) => rt.barrierIds.length > 0 && rt.barrierIds.every((id) => passedSeeds.has(id))) ?? null
}

export function computeRewards(reports: Report[], userIds: string[]): Record<string, UserReward> {
  const all = applyCap(rawEvents(reports))
  const res: Record<string, UserReward> = {}
  for (const userId of userIds) {
    const events = all.filter((e) => e.userId === userId)
    const mine = reports.filter((r) => r.userId === userId)
    const verified = mine.filter(isVerifiedReport)
    const counts = {
      verified: verified.length,
      votes: events.filter((e) => e.kind === 'voteMatch').length,
      ledToAction: verified.filter((r) => passedRecheckAt(r)).length,
      companion: 0, // 동행 점검 기능이 아직 없다
    }
    const g2 = REWARD_GRADE_RULES.g2
    const g3 = REWARD_GRADE_RULES.g3
    const ok = [
      counts.verified >= 1,
      counts.verified >= g2.verified || counts.votes >= g2.votes,
      counts.verified >= g3.verified && counts.ledToAction >= g3.ledToAction,
      counts.companion >= REWARD_GRADE_RULES.g4.companion,
    ]
    let grade = 0
    ok.forEach((v, i) => {
      if (v) grade = i + 1
    })
    const earned: string[] = GRADE_EMBLEMS.filter((e) => (e.grade ?? 9) <= grade).map((e) => e.id)
    if (pioneerRoute(userId, reports)) earned.push('special')
    const nv = (f: (r: Report) => boolean) => verified.filter(f).length
    if (nv((r) => (r.locationKind ?? '').includes('정류장')) >= REWARD_TYPE_EMBLEM_MIN) earned.push('stop')
    if (nv((r) => (r.locationKind ?? '').includes('횡단보도')) >= REWARD_TYPE_EMBLEM_MIN) earned.push('cross')
    if (nv((r) => r.category === 'temporary') >= REWARD_TYPE_EMBLEM_MIN) earned.push('temp')

    let next: NextGrade | null = null
    const nextDef = GRADE_EMBLEMS[grade] // grade가 4면 undefined
    if (nextDef) {
      const progress: Progress[] =
        grade === 0
          ? [{ label: '검증된 제보', now: counts.verified, need: 1 }]
          : grade === 1
            ? [
                { label: '검증된 제보', now: counts.verified, need: g2.verified },
                { label: '일치한 확인 투표', now: counts.votes, need: g2.votes },
              ]
            : grade === 2
              ? [
                  { label: '검증된 제보', now: counts.verified, need: g3.verified },
                  { label: '조치 완료로 이어진 제보', now: counts.ledToAction, need: g3.ledToAction },
                ]
              : [{ label: '동행 점검 참여', now: counts.companion, need: REWARD_GRADE_RULES.g4.companion }]
      next = { name: nextDef.name, how: nextDef.how, progress, anyOf: grade === 1, ...(grade === 3 ? { note: '동행 점검 기능은 아직 준비 중이에요.' } : {}) }
    }
    res[userId] = {
      userId,
      total: events.reduce((s, e) => s + e.points, 0),
      events,
      counts,
      grade,
      title: grade > 0 ? GRADE_EMBLEMS[grade - 1].name : '',
      earned,
      next,
    }
  }
  return res
}

// ───── 내가 바꾼 길 ─────
export type ChangedRoad = {
  reportId: string
  place: string // 지점 이름(내부 ID 대신 표시 이름)
  at: string
  routeName?: string
  before: number | null // 경로의 통과 가능 구간 비율(내 기여가 없었다면)
  after: number | null
}

// 내 제보가 재확인을 통과해 ○가 된 지점과, 그 지점이 속한 경로의 통과 가능 비율 변화(내 기여만 뺀 값과 비교).
export function changedRoads(userId: string, reports: Report[], barriers: Barrier[]): ChangedRoad[] {
  const byId = new Map(barriers.map((b) => [b.id, b]))
  const passed = reports.filter((r) => r.userId === userId && isVerifiedReport(r) && passedRecheckAt(r))
  // 내 기여를 되돌린 기록: 재확인 전 평가는 자료(시드)의 평가다.
  const revertIds = new Set(passed.map((r) => r.id))
  const reverted = reports.map((r) => {
    if (!revertIds.has(r.id)) return r
    const b = r.seedId ? byId.get(r.seedId) : undefined
    const orig = b ? (b.rating ?? (b.parentId ? byId.get(b.parentId)?.rating : undefined)) : undefined
    const { rating: _drop, ...rest } = r.verification
    void _drop
    return { ...r, verification: { ...rest, ...(orig ? { rating: orig } : {}) } }
  })
  return passed
    .map((r) => {
      const b = r.seedId ? byId.get(r.seedId) : undefined
      const route = r.seedId ? ROUTES.find((rt) => rt.barrierIds.includes(r.seedId as string)) : undefined
      return {
        reportId: r.id,
        place: b ? shortName(b.id, b.name) : `${r.type} (${r.locationKind ?? '시민 제보'})`,
        at: passedRecheckAt(r) as string,
        ...(route ? { routeName: route.name } : {}),
        before: route ? routeStats(route, barriers, reverted).ratio : null,
        after: route ? routeStats(route, barriers, reports).ratio : null,
      }
    })
    .sort((a, b) => (a.at < b.at ? 1 : -1))
}

// ───── 알림용: 두 시점의 결과를 비교해 말해 줄 것을 뽑는다 ─────
export type RewardChange = { userId: string; points: number; newEmblems: string[]; titleChanged: boolean; reasons: string[] }

export function diffRewards(prev: UserReward | undefined, next: UserReward): RewardChange | null {
  if (!prev) return null
  const points = next.total - prev.total
  const newEmblems = next.earned.filter((id) => !prev.earned.includes(id))
  if (points <= 0 && newEmblems.length === 0) return null
  const seen = new Set(prev.events.map((e) => e.id))
  const reasons = next.events.filter((e) => !seen.has(e.id) && e.points > 0).map((e) => e.label)
  return { userId: next.userId, points: Math.max(0, points), newEmblems, titleChanged: next.grade > prev.grade, reasons }
}
