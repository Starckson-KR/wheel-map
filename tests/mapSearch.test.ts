import { test } from 'node:test'
import assert from 'node:assert/strict'
import { searchView, makeLatest } from '../src/lib/routing/searchState.ts'
import { cardOrder, stepCard, busCardState, initialCard, settledCard } from '../src/lib/routing/cards.ts'

test('검색 화면 상태', () => {
  assert.equal(searchView('', 'idle', 0), 'recommend')
  assert.equal(searchView('북구', 'ok', 3), 'results')
  assert.equal(searchView('북구', 'empty', 0), 'empty')
  assert.equal(searchView('북구', 'error', 0), 'error')
  assert.equal(searchView('북구', 'loading', 0), 'loading')
})
test('옛 응답 버리기', () => {
  const g = makeLatest()
  const a = g.next()
  const b = g.next()
  assert.ok(!g.isCurrent(a) && g.isCurrent(b))
})
test('경로 카드', () => {
  assert.deepEqual(cardOrder(true), ['detour', 'base', 'bus'])
  assert.equal(stepCard(cardOrder(true), 'detour', 'ArrowRight'), 'base')
  assert.equal(stepCard(cardOrder(true), 'bus', 'ArrowRight'), 'bus')
  assert.equal(stepCard(cardOrder(false), 'base', 'a'), null)
  assert.equal(busCardState(false, false), 'none')
  assert.equal(initialCard(true, true, 'none'), 'detour')
  assert.equal(initialCard(false, true, 'ready'), 'bus')
})

test('settledCard: 넘기기가 멈춘 자리에서 가장 가까운 카드를 고른다', () => {
  const spots = [
    { id: 'detour' as const, center: 150 },
    { id: 'base' as const, center: 400 },
    { id: 'bus' as const, center: 650 },
  ]
  assert.equal(settledCard(160, spots), 'detour')
  assert.equal(settledCard(390, spots), 'base')
  assert.equal(settledCard(1000, spots), 'bus')
})

test('settledCard: 쓸 수 없는 카드 위에서 멈추거나 카드가 없으면 선택을 바꾸지 않는다', () => {
  const spots = [
    { id: 'base' as const, center: 150 },
    { id: 'bus' as const, center: 400, disabled: true },
  ]
  assert.equal(settledCard(380, spots), null)
  assert.equal(settledCard(100, spots), 'base')
  assert.equal(settledCard(100, []), null)
})
