import { test } from 'node:test'
import assert from 'node:assert/strict'

// 브라우저 없이 확인하려고 localStorage·window를 흉내 낸다.
const store = new Map<string, string>()
const events: string[] = []
const g = globalThis as Record<string, unknown>
g.localStorage = {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => void store.set(k, v),
  removeItem: (k: string) => void store.delete(k),
}
g.window = { dispatchEvent: (e: Event) => (events.push(e.type), true), addEventListener: () => {}, removeEventListener: () => {} }

const { isXmasOn, isXmasSeason, isMerryQuery, tapStep, getXmasOff, setXmasOff, getXmasDemo, setXmasDemo, xmasSnapshot, XMAS_KEY, XMAS_DEMO_KEY, XMAS_EVENT } = await import('../src/lib/xmas.ts')

const DEC = new Date(2026, 11, 10)
const NOV = new Date(2026, 10, 30)

test('12월이면 켜지고 11월이면 꺼진다', () => {
  assert.equal(isXmasOn(DEC, { off: false, demo: false }), true)
  assert.equal(isXmasOn(new Date(2026, 11, 1, 0, 0), { off: false, demo: false }), true)
  assert.equal(isXmasOn(new Date(2026, 11, 31, 23, 59), { off: false, demo: false }), true)
  assert.equal(isXmasOn(NOV, { off: false, demo: false }), false)
  assert.equal(isXmasOn(new Date(2027, 0, 1), { off: false, demo: false }), false)
})

test('끄기 설정이면 12월·시연 켬이어도 꺼진다', () => {
  assert.equal(isXmasOn(DEC, { off: true, demo: false }), false)
  assert.equal(isXmasOn(NOV, { off: true, demo: true }), false)
})

test('시연 켬이면 12월이 아니어도 켜지고, 끄기 스위치를 보일 기간이 된다', () => {
  assert.equal(isXmasOn(NOV, { off: false, demo: true }), true)
  assert.equal(isXmasSeason(NOV, true), true)
  assert.equal(isXmasSeason(NOV, false), false)
  assert.equal(isXmasSeason(DEC, false), true)
})

test('설정은 이 기기 저장소에 남고, 바뀌면 이벤트를 보낸다', () => {
  events.length = 0
  setXmasDemo(true)
  assert.equal(store.get(XMAS_DEMO_KEY), 'on')
  assert.equal(getXmasDemo(), true)
  assert.equal(xmasSnapshot().on, true)
  setXmasOff(true)
  assert.equal(store.get(XMAS_KEY), 'off')
  assert.equal(getXmasOff(), true)
  assert.deepEqual(xmasSnapshot(), { season: true, on: false })
  setXmasOff(false)
  assert.equal(store.has(XMAS_KEY), false)
  setXmasDemo(false)
  assert.equal(store.has(XMAS_DEMO_KEY), false)
  assert.deepEqual(events, [XMAS_EVENT, XMAS_EVENT, XMAS_EVENT, XMAS_EVENT])
})

test('같은 상태면 구독 값이 같은 객체다(다시 그리지 않게)', () => {
  assert.equal(xmasSnapshot(), xmasSnapshot())
})

test('동기화 대상 설정 키에 들어 있지 않다', async () => {
  const { SYNCED_PREF_KEYS } = await import('../src/lib/account/keys.ts')
  assert.equal((SYNCED_PREF_KEYS as readonly string[]).includes(XMAS_KEY), false)
  assert.equal((SYNCED_PREF_KEYS as readonly string[]).includes(XMAS_DEMO_KEY), false)
})

test('검색어 판정: 띄어쓰기·영문·대소문자', () => {
  assert.equal(isMerryQuery('메리 크리스마스'), true)
  assert.equal(isMerryQuery('메리크리스마스'), true)
  assert.equal(isMerryQuery('  메리  크리스마스 '), true)
  assert.equal(isMerryQuery('merry christmas'), true)
  assert.equal(isMerryQuery('Merry Christmas'), true)
  assert.equal(isMerryQuery('MERRYCHRISTMAS'), true)
  assert.equal(isMerryQuery('메리 크리스마'), false)
  assert.equal(isMerryQuery('메리 크리스마스!'), false)
  assert.equal(isMerryQuery('크리스마스'), false)
  assert.equal(isMerryQuery(''), false)
})

test('검색어 판정: 한글 조합 중에는 판정하지 않는다', () => {
  assert.equal(isMerryQuery('메리 크리스마스', true), false)
  assert.equal(isMerryQuery('메리 크리스마스', false), true)
})

test('탭 세기: 1.5초 안에 연속 5번이면 켠다', () => {
  let s = { n: 0, t: 0 }
  const fired: boolean[] = []
  for (const now of [1000, 1300, 1700, 2100, 2500]) {
    const r = tapStep(s, now)
    fired.push(r.fire)
    s = r
  }
  assert.deepEqual(fired, [false, false, false, false, true])
  assert.equal(s.n, 0)
})

test('탭 세기: 시간을 넘기면 1부터 다시 센다', () => {
  let s = { n: 0, t: 0 }
  for (const now of [1000, 1300, 1600, 1900]) s = tapStep(s, now)
  assert.equal(s.n, 4)
  const late = tapStep(s, 1900 + 1501)
  assert.equal(late.fire, false)
  assert.equal(late.n, 1)
  const edge = tapStep(s, 1900 + 1500)
  assert.equal(edge.fire, true)
})
