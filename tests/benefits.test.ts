// 실행: node --import ./scripts/registerTs.mjs --test tests/benefits.test.ts
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  buildView, homeCount, isExpired, matchScore, parsePrefs, periodText, validateBenefits, visibleBenefits, groupByCategory,
  type Benefit, type BenefitPrefs,
} from '../src/lib/benefits.ts'

const base = (o: Partial<Benefit>): Benefit => ({
  id: 'x', title: 't', summary: 's', category: 'welfare', target: '확인 필요', wheelchairRelevant: null, area: '북구',
  period: { type: 'always' }, agency: 'a', contact: '', sourceName: 'n', sourceUrl: 'https://example.go.kr/x',
  confirmedAt: '2026-11-12', status: '확인됨', unknowns: [], ...o,
})
const NOW = new Date(2026, 10, 12, 12).getTime() // 2026-11-12

test('기간: 종료일 당일은 보이고 다음 날부터 숨는다', () => {
  assert.equal(isExpired(base({ period: { type: 'range', end: '2026-11-12' } }), NOW), false)
  assert.equal(isExpired(base({ period: { type: 'range', end: '2026-11-11' } }), NOW), true)
  assert.equal(isExpired(base({ period: { type: 'always' } }), NOW), false)
  assert.equal(isExpired(base({ period: { type: 'unknown' } }), NOW), false)
  assert.equal(isExpired(base({ period: { type: 'range', start: '2026-12-01' } }), NOW), false)
})

test('visibleBenefits는 지난 항목만 뺀다', () => {
  const list = [base({ id: 'a' }), base({ id: 'b', period: { type: 'range', end: '2026-01-01' } })]
  assert.deepEqual(visibleBenefits(list, NOW).map((b) => b.id), ['a'])
})

test('설정이 없으면 전체를 분류 순서로 묶는다', () => {
  const list = [base({ id: 'c', category: 'culture' }), base({ id: 'm', category: 'mobility' }), base({ id: 'w', category: 'welfare' })]
  const v = buildView(list, { wheelchair: 'none', topics: [] }, NOW)
  assert.equal(v.prefsSet, false)
  assert.equal(v.matched.length, 0)
  assert.deepEqual(v.groups.map((g) => g.category), ['mobility', 'welfare', 'culture'])
})

test('관심 분야를 고르면 그 분류가 앞에 오고 나머지는 따로 묶인다', () => {
  const list = [base({ id: 'w', category: 'welfare' }), base({ id: 'd', category: 'device' }), base({ id: 'c', category: 'culture' })]
  const v = buildView(list, { wheelchair: 'none', topics: ['device'] }, NOW)
  assert.deepEqual(v.matched.map((b) => b.id), ['d'])
  assert.deepEqual(v.groups.flatMap((g) => g.items.map((b) => b.id)), ['w', 'c'])
})

test('휠체어 이용함·동행이면 관련 항목이 맞는 항목에 들어가고, 선택 안 함이면 영향이 없다', () => {
  const list = [base({ id: 'r', wheelchairRelevant: true }), base({ id: 'n', wheelchairRelevant: null }), base({ id: 'f', wheelchairRelevant: false })]
  assert.deepEqual(buildView(list, { wheelchair: 'user', topics: [] }, NOW).matched.map((b) => b.id), ['r'])
  assert.deepEqual(buildView(list, { wheelchair: 'companion', topics: [] }, NOW).matched.map((b) => b.id), ['r'])
  assert.equal(buildView(list, { wheelchair: 'none', topics: [] }, NOW).prefsSet, false)
})

test('점수 높은 순으로 정렬하고 같으면 원래 순서', () => {
  const p: BenefitPrefs = { wheelchair: 'user', topics: ['device'] }
  const a = base({ id: 'a', category: 'welfare', wheelchairRelevant: true }) // 1
  const b = base({ id: 'b', category: 'device', wheelchairRelevant: true }) // 3
  const c = base({ id: 'c', category: 'device', wheelchairRelevant: null }) // 2
  const d = base({ id: 'd', category: 'device', wheelchairRelevant: null }) // 2
  assert.equal(matchScore(b, p), 3)
  assert.deepEqual(buildView([a, c, b, d], p, NOW).matched.map((x) => x.id), ['b', 'c', 'd', 'a'])
})

test('지난 항목은 맞는 항목에서도 빠진다', () => {
  const list = [base({ id: 'old', category: 'device', period: { type: 'range', end: '2026-01-01' } }), base({ id: 'ok', category: 'device' })]
  assert.deepEqual(buildView(list, { wheelchair: 'none', topics: ['device'] }, NOW).matched.map((b) => b.id), ['ok'])
})

test('homeCount: 설정이 있으면 맞는 수, 없으면 보이는 전체 수', () => {
  const list = [base({ id: 'a', category: 'device' }), base({ id: 'b', category: 'welfare' }), base({ id: 'c', period: { type: 'range', end: '2026-01-01' } })]
  assert.deepEqual(homeCount(list, { wheelchair: 'none', topics: [] }, NOW), { count: 2, personal: false })
  assert.deepEqual(homeCount(list, { wheelchair: 'none', topics: ['device'] }, NOW), { count: 1, personal: true })
})

test('저장된 설정 읽기: 깨진 값·알 수 없는 분류는 걸러낸다', () => {
  assert.deepEqual(parsePrefs(null), { wheelchair: 'none', topics: [] })
  assert.deepEqual(parsePrefs('깨진'), { wheelchair: 'none', topics: [] })
  assert.deepEqual(parsePrefs('{"wheelchair":"user","topics":["device","device","x",3]}'), { wheelchair: 'user', topics: ['device'] })
  assert.deepEqual(parsePrefs('{"wheelchair":"zzz","topics":"a"}'), { wheelchair: 'none', topics: [] })
})

test('기간 문구', () => {
  assert.equal(periodText(base({ period: { type: 'always' } })), '상시')
  assert.equal(periodText(base({ period: { type: 'unknown' } })), '기간 확인 필요')
  assert.equal(periodText(base({ period: { type: 'range', start: '2026-11-09', end: '2026-11-27' } })), '11월 9일부터 11월 27일까지')
  assert.equal(periodText(base({ period: { type: 'range', start: '2026-12-12', end: '2026-12-12' } })), '12월 12일')
})

test('groupByCategory는 빈 분류를 뺀다', () => {
  assert.deepEqual(groupByCategory([base({ category: 'culture' })]).map((g) => g.category), ['culture'])
})

// ───── 실제 데이터 검증 ─────
const data = JSON.parse(readFileSync(new URL('../data/benefits/benefits.json', import.meta.url), 'utf8')) as { checkedAt: string; items: Benefit[] }

test('데이터: 모든 항목에 출처 URL·확인일·필수 칸이 있다', () => {
  assert.ok(data.items.length >= 10 && data.items.length <= 20, `항목 수 ${data.items.length}`)
  assert.deepEqual(validateBenefits(data.items), [])
  for (const b of data.items) {
    assert.match(b.sourceUrl, /^https:\/\//)
    assert.equal(b.confirmedAt, '2026-11-12')
  }
})

test('데이터: 검증 함수가 빈 출처·확인일을 잡아낸다', () => {
  assert.ok(validateBenefits([base({ sourceUrl: '' })]).some((e) => e.includes('출처 URL')))
  assert.ok(validateBenefits([base({ confirmedAt: '' })]).some((e) => e.includes('확인일')))
  assert.ok(validateBenefits([base({ id: 'a' }), base({ id: 'a' })]).some((e) => e.includes('중복')))
})

test('데이터: 확인 필요 칸은 unknowns에 적혀 있다', () => {
  for (const b of data.items) {
    if (b.status === '확인 필요') assert.ok(b.unknowns.length > 0, b.id)
  }
})
