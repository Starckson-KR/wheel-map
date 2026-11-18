import { test } from 'node:test'
import assert from 'node:assert/strict'
import { nextGradeRatio, ratingCounts } from '../src/lib/homeSummary.ts'
import { TAB_ITEMS } from '../src/lib/tabs.ts'
import { TAB_ORDER } from '../src/lib/motionTokens.ts'
import { TO, parseHash } from '../src/lib/nav.ts'
import type { Barrier } from '../src/types.ts'

const b = (o: Partial<Barrier> & { id: string }): Barrier => ({ name: o.id, type: 't', measurements: [], source: 'team_survey', photos: [], note: '', kind: 'point', geometry: null, ...o }) as Barrier

test('등급별 개수: 묶음 제외, 부모 등급 따름, 등급 없으면 제외', () => {
  const c = ratingCounts([
    b({ id: 'g', kind: 'group', rating: 'X' }),
    b({ id: 'a', rating: 'X' }),
    b({ id: 'c', rating: 'TRIANGLE', parentId: 'g' }),
    b({ id: 'd', parentId: 'g' }),
    b({ id: 'e', rating: 'O' }),
    b({ id: 'f' }),
  ])
  assert.deepEqual(c, { total: 4, X: 2, TRIANGLE: 1, O: 1 })
})

test('다음 칭호 진행률', () => {
  assert.equal(nextGradeRatio(null), 0)
  const p = (now: number, need: number) => ({ label: '', now, need })
  assert.equal(nextGradeRatio({ name: '', how: '', progress: [p(2, 5), p(10, 20)], anyOf: true }), 0.5)
  assert.equal(nextGradeRatio({ name: '', how: '', progress: [p(5, 5), p(0, 4)] }), 0.5)
  assert.equal(nextGradeRatio({ name: '', how: '', progress: [p(9, 5)] }), 1)
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
