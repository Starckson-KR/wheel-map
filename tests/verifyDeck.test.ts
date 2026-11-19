import { test } from 'node:test'
import assert from 'node:assert/strict'
import { REQUIRE_VIEW_BEFORE_VOTE, TILT_MAX_DEG, cardTilt, deckEnabled, deckReports, pickPromotion, stampLevel, stampSide } from '../src/lib/verifyDeck.ts'
import { DEMO_SWEEP, clampPos, crossed, nearerSide, posFromX, posText, stepPos } from '../src/lib/compareSlider.ts'
import { COMPARE_SCENES, sceneFor } from '../src/lib/compareScenes.ts'
import type { Report } from '../src/types.ts'

const rep = (id: string, o: Partial<Report> & { voterIds?: string[] } = {}): Report =>
  ({ id, userId: 'u2', createdAt: `2026-11-0${id.length}`, status: 'pending', verification: { votes: 0, voterIds: o.voterIds ?? [] }, ...o }) as unknown as Report

test('카드 기울기는 ±12도 안, 도장은 기준 근처에서 진해진다', () => {
  assert.equal(cardTilt(0, 300), 0)
  assert.equal(cardTilt(1000, 300), TILT_MAX_DEG)
  assert.equal(cardTilt(-1000, 300), -TILT_MAX_DEG)
  assert.equal(cardTilt(10, 0), 0)
  assert.equal(stampLevel(5, 300), 0)
  assert.equal(stampLevel(300 * 0.35, 300), 1)
  assert.ok(stampLevel(60, 300) > 0 && stampLevel(60, 300) < 1)
  assert.equal(stampSide(5), 'yes')
  assert.equal(stampSide(-5), 'skip')
  assert.equal(stampSide(0), null)
})

test('확인할 제보: 남의 검증 대기 건만, 내가 투표했거나 넘긴 것은 뺀다', () => {
  const me = { id: 'u1', role: 'citizen' }
  const list = [rep('a'), rep('bb', { userId: 'u1' }), rep('ccc', { voterIds: ['u1'] }), rep('dddd', { status: 'verified' as never }), rep('eeeee')]
  assert.deepEqual(deckReports(list, me, new Set()).map((r) => r.id), ['a', 'eeeee'])
  assert.deepEqual(deckReports(list, me, new Set(['a'])).map((r) => r.id), ['eeeee'])
  assert.deepEqual(deckReports(list, { id: 'u1', role: 'verifier' }, new Set()), [])
})

test('확인할 제보: 상한 없이 남은 건을 모두 센다(투표하면 하나씩 준다)', () => {
  const me = { id: 'u1', role: 'citizen' }
  const list = Array.from({ length: 35 }, (_, i) => rep(`r${String(i).padStart(2, '0')}`))
  assert.equal(deckReports(list, me, new Set()).length, 35)
  const voted = list.map((r, i) => (i === 0 ? rep(r.id, { voterIds: ['u1'] }) : r))
  assert.equal(deckReports(voted, me, new Set()).length, 34)
})

test('사진·위치 먼저 보기 상수: 지금은 꺼짐, 켜면 본 뒤에만 버튼이 켜진다', () => {
  assert.equal(REQUIRE_VIEW_BEFORE_VOTE, false)
  assert.equal(deckEnabled(false), true)
  assert.equal(deckEnabled(false, true), false)
  assert.equal(deckEnabled(true, true), true)
})

test('칭호 승급: 등급 칭호·특별만 크게, 높은 등급 우선', () => {
  const defs: Record<string, { id: string; name: string; grade?: number }> = {
    g1: { id: 'g1', name: 'a', grade: 1 },
    g2: { id: 'g2', name: 'b', grade: 2 },
    special: { id: 'special', name: 's' },
    stop: { id: 'stop', name: 't' },
  }
  const look = (id: string) => defs[id]
  assert.equal(pickPromotion(['stop'], look), null)
  assert.equal(pickPromotion(['g1', 'g2'], look)?.id, 'g2')
  assert.equal(pickPromotion(['stop', 'special'], look)?.id, 'special')
  assert.equal(pickPromotion(['nope'], look), null)
})

test('비교 슬라이더: 위치 계산·키보드·가운데 지남', () => {
  assert.equal(clampPos(-5), 0)
  assert.equal(clampPos(140), 100)
  assert.equal(posFromX(150, 100, 200), 25)
  assert.equal(posFromX(0, 0, 0), 50)
  assert.equal(stepPos(50, 'ArrowRight'), 55)
  assert.equal(stepPos(50, 'ArrowLeft'), 45)
  assert.equal(stepPos(98, 'ArrowRight'), 100)
  assert.equal(stepPos(50, 'Home'), 0)
  assert.equal(stepPos(50, 'End'), 100)
  assert.equal(stepPos(50, 'a'), null)
  assert.equal(crossed(40, 60), true)
  assert.equal(crossed(60, 40), true)
  assert.equal(crossed(10, 20), false)
  assert.equal(nearerSide(80), 'before')
  assert.equal(nearerSide(20), 'after')
  assert.match(posText(100), /조치 전/)
  assert.match(posText(0), /조치 후/)
  assert.ok(DEMO_SWEEP.every((p) => p >= 0 && p <= 100))
})

test('시연용 그림: 두 장면 모두 전·후가 있고 "시연용" 표시가 들어 있다', () => {
  assert.equal(sceneFor('턱'), 'curb')
  assert.equal(sceneFor('전봇대'), 'pole')
  for (const s of Object.values(COMPARE_SCENES)) {
    assert.notEqual(s.before, s.after)
    for (const u of [s.before, s.after]) {
      assert.ok(u.startsWith('data:image/svg+xml'))
      assert.ok(decodeURIComponent(u).includes('시연용'))
    }
  }
})
