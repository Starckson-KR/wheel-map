import { test } from 'node:test'
import assert from 'node:assert/strict'
import { summarizeMine, mineLines, parseHomeExtra, EXTRA_TILES, FIXED_TILES } from '../src/lib/homeSummary.ts'
import { TAB_ITEMS } from '../src/lib/tabs.ts'
import { TAB_ORDER } from '../src/lib/motionTokens.ts'
import { TO, parseHash } from '../src/lib/nav.ts'

const R = (userId: string, status: string) => ({ userId, status }) as { userId: string; status: never }

test('내 제보 요약: 제보가 없으면 모두 0, 문구는 "아직 제보가 없어요"', () => {
  const s = summarizeMine([], 'u1')
  assert.deepEqual(s, { total: 0, active: 0, waiting: 0, fixed: 0 })
  assert.equal(mineLines(s).big, '아직 제보가 없어요')
})

test('내 제보 요약: 상태별 집계와 다른 사용자 제보 제외', () => {
  const list = [
    R('u1', 'pending'),
    R('u1', 'pending'),
    R('u1', 'verified'),
    R('u1', 'in_progress'),
    R('u1', 'resolved'),
    R('u1', 'rechecked'),
    R('u1', 'rejected'),
    R('u1', 'merged'),
    R('u2', 'pending'),
    R('u2', 'resolved'),
  ]
  const s = summarizeMine(list, 'u1')
  assert.deepEqual(s, { total: 8, active: 4, waiting: 2, fixed: 2 })
  assert.deepEqual(mineLines(s), { big: '4건 처리 중', sub: '확인 대기 2 · 고쳐짐 2' })
  assert.deepEqual(summarizeMine(list, 'u3'), { total: 0, active: 0, waiting: 0, fixed: 0 })
})

test('내 제보 요약: 처리 중이 없어도 제보가 있으면 숫자를 보인다', () => {
  const s = summarizeMine([R('u1', 'rechecked')], 'u1')
  assert.deepEqual(mineLines(s), { big: '0건 처리 중', sub: '확인 대기 0 · 고쳐짐 1' })
})

test('자주 쓰는 서비스: 고정 5칸, 6번째 후보는 중복 없이 고정 칸과 겹치지 않는다', () => {
  assert.equal(FIXED_TILES.length, 5)
  const ids = [...FIXED_TILES, ...EXTRA_TILES].map((t) => t.id)
  assert.equal(new Set(ids).size, ids.length)
  assert.equal(FIXED_TILES.find((t) => t.id === 'receipt')?.to, '#/report?section=receipt')
  assert.equal(FIXED_TILES.find((t) => t.id === 'route')?.to, TO.route)
})

test('6번째 칸 저장값: 목록에 있는 것만 인정', () => {
  assert.equal(parseHomeExtra('progress')?.label, '개선 현황')
  assert.equal(parseHomeExtra('bus'), null) // 지운 「저상버스 도착」 칸: 예전에 골랐어도 비워진다
  assert.equal(parseHomeExtra('route'), null)
  assert.equal(parseHomeExtra('없는값'), null)
  assert.equal(parseHomeExtra(null), null)
  assert.equal(parseHomeExtra(''), null)
})

test('하단 탭 순서: 홈 · 동행지도 · 제보 · 혜택알림 · 내 정보', () => {
  assert.deepEqual(TAB_ITEMS.map((t) => t.label), ['홈', '동행지도', '제보', '혜택알림', '내 정보'])
  assert.deepEqual(TAB_ITEMS.map((t) => t.page), [...TAB_ORDER])
  assert.equal(TAB_ITEMS.filter((t) => t.fab).length, 1)
  assert.equal(TAB_ITEMS[2].fab, true)
})

test('탭 주소는 기존 해시 그대로 이어진다', () => {
  for (const t of TAB_ITEMS) assert.equal(parseHash(t.to).page, t.page)
  assert.equal(TO.report, '#/report')
  assert.equal(TAB_ITEMS[2].to, TO.report)
})

import { shouldReduceMotion } from '../src/lib/viewPrefs.ts'
test('움직임: 기기 줄이기 켬 + 앱 설정 꺼짐 → 움직임 켬, 앱 설정 켬 → 줄임', () => {
  assert.equal(shouldReduceMotion(true, false), false)
  assert.equal(shouldReduceMotion(false, false), false)
  assert.equal(shouldReduceMotion(true, true), true)
  assert.equal(shouldReduceMotion(false, true), true)
})
