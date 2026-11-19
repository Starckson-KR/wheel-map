// 확인 투표 카드(D1)·칭호 승급(E1)·전후 비교(D2)의 순수 판정(화면·DOM 없음).
import { COMMIT_RATIO } from './motionTokens'
import type { Report } from '../types'

/**
 * 사용자 결정 대기: 사진·위치를 먼저 보여 준 뒤에야 투표 버튼·넘기기를 켤지.
 * false(지금): 카드에 사진·위치가 처음부터 보이고 바로 투표할 수 있다.
 * true: 카드의 「사진·위치 보기」를 누른 뒤에야 투표·넘기기가 켜진다.
 */
export const REQUIRE_VIEW_BEFORE_VOTE = false

/** 카드가 손가락을 따라 기울어지는 최대 각도(도) */
export const TILT_MAX_DEG = 12

/** 끈 거리 dx(px)·카드 폭에 따른 기울기(도). 폭이 0이면 0. */
export function cardTilt(dx: number, width: number): number {
  if (width <= 0) return 0
  const t = (dx / width) * TILT_MAX_DEG * 2
  return Math.max(-TILT_MAX_DEG, Math.min(TILT_MAX_DEG, Math.round(t * 10) / 10))
}

/** 도장 진하기 0~1: 끈 거리가 확정 기준(폭의 35%)에 가까울수록 진해진다. 시작 10%까지는 0. */
export function stampLevel(dx: number, width: number, ratio = COMMIT_RATIO): number {
  if (width <= 0) return 0
  const t = Math.abs(dx) / (width * ratio)
  if (t <= 0.28) return 0
  return Math.min(1, (t - 0.28) / 0.72)
}

export type DeckSide = 'yes' | 'skip' | null
export const stampSide = (dx: number): DeckSide => (dx > 0 ? 'yes' : dx < 0 ? 'skip' : null)

type Me = { id: string; role: string }

/** 내가 확인할 수 있는 제보(검증 대기, 남의 것, 아직 안 누른 것). 오래된 것부터 보여 준다. */
export function deckReports(reports: Report[], me: Me, skipped: ReadonlySet<string>): Report[] {
  if (me.role !== 'citizen') return []
  return reports
    .filter((r) => r.status === 'pending' && r.userId !== me.id && !r.verification.voterIds.includes(me.id) && !skipped.has(r.id))
    .sort((a, b) => (a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : a.id < b.id ? -1 : 1))
}

/** 투표·넘기기를 켜도 되는지 */
export const deckEnabled = (viewed: boolean, requireView = REQUIRE_VIEW_BEFORE_VOTE): boolean => !requireView || viewed

// ───── E1 칭호 승급 ─────
type EmblemLike = { id: string; grade?: number; name: string; glyph?: string }

/** 새로 받은 엠블럼 중 크게 알릴 것(칭호 등급 또는 특별 엠블럼) 하나. 등급이 높은 쪽을 우선, 없으면 null. */
export function pickPromotion<T extends EmblemLike>(newIds: string[], lookup: (id: string) => T | undefined): T | null {
  let best: T | null = null
  for (const id of newIds) {
    const e = lookup(id)
    if (!e) continue
    if (!e.grade && id !== 'special') continue
    if (!best || (e.grade ?? 99) > (best.grade ?? 99)) best = e
  }
  return best
}
