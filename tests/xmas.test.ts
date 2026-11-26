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
  assert.deepEqual(xmasSnapshot(), { season: true, on: false, mode: false, intro: false, gift: false })
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

// ───── 크리스마스 모드(관리자가 모든 기기에 켬) ─────
const { parseCast, castStep, applyRemoteCast, setXmasCastLocal, dismissXmasIntro, dismissXmasGift, getXmasCast, CAST_NONE, XMAS_CAST_KEY } = await import('../src/lib/xmas.ts')

test('parseCast: 깨진 값·없는 값은 꺼짐, 꺼진 상태에는 연출 대기가 남지 않는다', () => {
  assert.deepEqual(parseCast(null), CAST_NONE)
  assert.deepEqual(parseCast('{'), CAST_NONE)
  assert.deepEqual(parseCast('"on"'), CAST_NONE)
  assert.deepEqual(parseCast('{"on":true,"at":5,"intro":true,"gift":true}'), { on: true, at: 5, intro: true, gift: true })
  assert.deepEqual(parseCast('{"on":false,"at":5,"intro":true,"gift":true}'), { on: false, at: 5, intro: false, gift: false })
  assert.deepEqual(parseCast('{"on":"yes","at":-1}'), CAST_NONE)
})

test('castStep: 서버 시각이 이 기기가 따른 시각과 다를 때만 바뀐다', () => {
  const none = CAST_NONE
  // 처음 연 기기, 서버도 켠 적 없음 → 그대로
  assert.deepEqual(castStep(none, { on: false, at: 0 }), { next: none, changed: false, reload: false })
  // 켜짐 신호 → 연출·선물 대기, 새로 고침
  const on = castStep(none, { on: true, at: 100 })
  assert.deepEqual(on, { next: { on: true, at: 100, intro: true, gift: true }, changed: true, reload: true })
  // 같은 시각을 다시 받으면 아무 일도 없다(새로 고침 되풀이 없음). 연출을 닫은 뒤에도 마찬가지
  assert.equal(castStep(on.next, { on: true, at: 100 }).changed, false)
  assert.equal(castStep({ ...on.next, intro: false, gift: false }, { on: true, at: 100 }).changed, false)
  // 끄기 신호 → 꺼지고 새로 고침
  assert.deepEqual(castStep(on.next, { on: false, at: 200 }), { next: { on: false, at: 200, intro: false, gift: false }, changed: true, reload: true })
  // 꺼진 기기가 「꺼짐」을 새 시각으로 받으면 기록만 하고 새로 고치지 않는다
  assert.deepEqual(castStep(none, { on: false, at: 200 }), { next: { on: false, at: 200, intro: false, gift: false }, changed: true, reload: false })
  // 켜진 채 한 번 더 누르면 연출을 다시 본다
  assert.equal(castStep({ on: true, at: 100, intro: false, gift: false }, { on: true, at: 300 }).next.intro, true)
  // 모양이 틀린 응답은 무시
  assert.equal(castStep(on.next, { on: 'true', at: 999 }).changed, false)
  assert.equal(castStep(on.next, { on: undefined, at: undefined }).changed, false)
})

test('서버 값을 따르면 모드·연출 순서가 켜지고, 「장식 끄기」도 풀린다. 12월이 아니어도 켜진다', () => {
  store.clear()
  setXmasOff(true)
  assert.deepEqual(applyRemoteCast({ on: true, at: 1000 }), { changed: true, reload: true })
  assert.equal(getXmasOff(), false)
  assert.deepEqual(JSON.parse(store.get(XMAS_CAST_KEY)!), { on: true, at: 1000, intro: true, gift: true })
  assert.equal(isXmasOn(NOV), true)
  assert.deepEqual(xmasSnapshot(), { season: true, on: true, mode: true, intro: true, gift: false })
  assert.deepEqual(applyRemoteCast({ on: true, at: 1000 }), { changed: false, reload: false })
  dismissXmasIntro()
  assert.deepEqual(xmasSnapshot(), { season: true, on: true, mode: true, intro: false, gift: true })
  dismissXmasGift()
  assert.deepEqual(xmasSnapshot(), { season: true, on: true, mode: true, intro: false, gift: false })
  // 사용자가 장식을 끄면 모드도 꺼진다
  setXmasOff(true)
  assert.equal(xmasSnapshot().mode, false)
  setXmasOff(false)
  assert.deepEqual(applyRemoteCast({ on: false, at: 2000 }), { changed: true, reload: true })
  assert.deepEqual(getXmasCast(), { on: false, at: 2000, intro: false, gift: false })
  assert.equal(isXmasOn(NOV), false)
})

test('시연 도구의 이 기기만 켜기는 서버 시각을 건드리지 않아, 서버 확인이 되돌리지 않는다', () => {
  store.clear()
  applyRemoteCast({ on: false, at: 500 })
  setXmasCastLocal(true)
  assert.deepEqual(getXmasCast(), { on: true, at: 500, intro: true, gift: true })
  assert.deepEqual(applyRemoteCast({ on: false, at: 500 }), { changed: false, reload: false })
  setXmasCastLocal(false)
  assert.equal(xmasSnapshot().mode, false)
  store.clear()
})

test('저장이 안 되는 기기는 새로 고치지 않는다(되풀이 방지)', () => {
  store.clear()
  const ls = g.localStorage as { setItem: (k: string, v: string) => void }
  const orig = ls.setItem
  ls.setItem = () => {
    throw new Error('quota')
  }
  try {
    assert.deepEqual(applyRemoteCast({ on: true, at: 7000 }), { changed: true, reload: false })
    assert.equal(xmasSnapshot().mode, true) // 이번 방문 동안은 켜진다
    assert.equal(applyRemoteCast({ on: true, at: 7000 }).changed, false)
  } finally {
    ls.setItem = orig
    setXmasCastLocal(false)
    store.clear()
  }
})

const audio = await import('../src/lib/xmasAudio.ts')
test('징글벨 악보: 16마디 64박, 모든 음이 주파수로 바뀌고 시각이 이어진다', () => {
  assert.equal(audio.JINGLE.reduce((s, n) => s + n[1], 0), 64)
  assert.equal(audio.JINGLE_BASS.length, 16)
  const t = audio.schedule(audio.JINGLE, 120)
  assert.equal(t[0].t, 0)
  for (let i = 1; i < t.length; i++) assert.ok(Math.abs(t[i].t - (t[i - 1].t + t[i - 1].dur)) < 1e-9)
  assert.ok(t.every((n) => n.freq > 200 && n.freq < 1000 && n.dur > 0))
  assert.ok(Math.abs(audio.noteFreq('A4') - 440) < 1e-9)
  assert.ok(Math.abs(audio.noteFreq('C5') - 523.25) < 0.01)
  assert.equal(audio.noteFreq('H9'), 0)
  assert.ok([...audio.JINGLE_BASS, ...audio.DING_SCALE].every((n) => audio.noteFreq(n) > 0))
  assert.ok(Math.abs(audio.songSeconds() - 64 * (60 / audio.JINGLE_BPM)) < 1e-9)
  assert.ok(audio.songSeconds() < 30) // 짧게 한 번
})

const font = await import('../src/lib/xmasFont.ts')
test('크리스마스 글꼴 주소: 주아 한 종, 문구에 쓰인 글자만(겹침·공백 없이) 담는다', () => {
  assert.equal(font.uniqueChars(['가나 가', '나다!']), '!가나다')
  const u = new URL(font.xmasFontUrl())
  assert.equal(u.origin + u.pathname, 'https://fonts.googleapis.com/css2')
  assert.equal(u.searchParams.get('family'), 'Jua')
  assert.equal(u.searchParams.get('display'), 'swap')
  const text = u.searchParams.get('text') ?? ''
  for (const ch of (font.XMAS_TITLE + font.XMAS_HINT + font.XMAS_MSG).replace(/\s/g, '')) assert.ok(text.includes(ch), ch)
  assert.equal(new Set(text).size, [...text].length)
  assert.ok(!/\s/.test(text) && [...text].length < 40)
})
