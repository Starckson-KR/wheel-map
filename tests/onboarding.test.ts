// 실행: node --import ./scripts/registerTs.mjs --test tests/onboarding.test.ts
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  SCREENS, afterAuth, authMessage, cleanName, dotIndex, isSkipHash, mobilityToWheelchair, nameHint, nameOk, parsePreview, parseProfile, startScreen, toBenefitPrefs,
} from '../src/components/onboarding/flow.ts'
import { GUIDE_SLIDES, clampSlide, homeAfterClose } from '../src/lib/usageGuide.ts'
import { RESET_KEYS, RESET_VERSION, RESET_VERSION_KEY, resetOnce } from '../src/lib/resetOnce.ts'
import { effectiveLang, parseLang } from '../src/lib/i18n/index.ts'

test('시작 화면: 로그인 안 됨 → 첫 화면, 로그인만 → 이동 방식, 둘 다 → 앱', () => {
  assert.equal(startScreen({ loggedIn: false, onboarded: false }), 'welcome')
  assert.equal(startScreen({ loggedIn: false, onboarded: true }), 'welcome')
  assert.equal(startScreen({ loggedIn: true, onboarded: false }), 'mobility')
  assert.equal(startScreen({ loggedIn: true, onboarded: true }), null)
})

test('인증 뒤 화면', () => {
  assert.equal(afterAuth(false), 'mobility')
  assert.equal(afterAuth(true), null)
})

test('개발·행정 화면은 건너뜀', () => {
  assert.equal(isSkipHash('#/admin', ['admin', 'verify']), true)
  assert.equal(isSkipHash('#/verify?x=1', ['admin', 'verify']), true)
  assert.equal(isSkipHash('#/map', ['admin', 'verify']), false)
  assert.equal(isSkipHash('', ['admin', 'verify']), false)
})

test('미리보기 해시', () => {
  assert.deepEqual(parsePreview('#/onboarding-preview?step=done'), { on: true, step: 'done' })
  assert.deepEqual(parsePreview('#/onboarding-preview?step=nope'), { on: true, step: 'lang' })
  assert.equal(parsePreview('#/map').on, false)
})

test('진행 점', () => {
  assert.equal(dotIndex('lang'), 0)
  assert.equal(dotIndex('confirm'), 1)
  assert.equal(dotIndex('view'), 4)
  assert.equal(dotIndex('done'), -1)
})

test('이동 방식 → 맞춤 혜택 설정', () => {
  assert.equal(mobilityToWheelchair('manual'), 'user')
  assert.equal(mobilityToWheelchair('power'), 'user')
  assert.equal(mobilityToWheelchair('companion'), 'companion')
  assert.equal(mobilityToWheelchair('none'), 'none')
  assert.equal(mobilityToWheelchair('skip'), 'none')
  assert.deepEqual(toBenefitPrefs({ mobility: 'power', interests: ['welfare', 'welfare', 'culture'] }), { wheelchair: 'user', topics: ['welfare', 'culture'] })
})

test('프로필 읽기: 잘못된 값은 기본값', () => {
  assert.deepEqual(parseProfile(null), { mobility: 'skip', interests: [] })
  assert.deepEqual(parseProfile('{"mobility":"x","interests":["bad","device"]}'), { mobility: 'skip', interests: ['device'] })
  assert.deepEqual(parseProfile('깨진'), { mobility: 'skip', interests: [] })
})

test('오류 문구와 이름 검사', () => {
  assert.equal(authMessage('taken', 'signup'), '이미 있는 이름이에요. 로그인해 주세요')
  assert.ok(authMessage('network', 'login').length > 0)
  assert.equal(cleanName('  김  재성 '), '김 재성')
  assert.equal(nameOk('  '), false)
  assert.equal(nameOk('가'.repeat(21)), false)
  assert.equal(nameOk('재성'), true)
  // 서버(worker/src/auth.ts)와 같은 규칙: 한글·영문·숫자·공백 1~10자
  assert.equal(nameOk('가'.repeat(10)), true)
  assert.equal(nameOk('가'.repeat(11)), false)
  assert.equal(nameOk('Jae 성 2'), true)
  for (const bad of ['재성🐶', '재성_1', 'jae.sung', '재성!', '♡재성']) assert.equal(nameOk(bad), false, bad)
  assert.equal(nameHint(''), null)
  assert.equal(nameHint('재성'), null)
  assert.equal(nameHint('재성🐶'), '이모지나 특수문자는 쓸 수 없어요')
  assert.equal(nameHint('가'.repeat(11)), '10자까지 쓸 수 있어요')
  assert.equal(authMessage('bad_input', 'signup'), '이름은 한글·영문·숫자로 10자까지 쓸 수 있어요')
})

test('언어: 영어는 번역이 없어 한국어로 안내', () => {
  assert.equal(parseLang('en'), 'en')
  assert.equal(parseLang('fr'), null)
  assert.equal(effectiveLang('en'), 'ko')
  assert.equal(effectiveLang(null), 'ko')
})

test('첫 화면은 단계 목록 맨 앞이고 진행 점이 없다', () => {
  assert.equal(SCREENS[0], 'welcome')
  assert.equal(dotIndex('welcome'), -1)
  assert.deepEqual(parsePreview('#/onboarding-preview?step=welcome'), { on: true, step: 'welcome' })
})

test('사용법 슬라이드: 4장, 번호는 범위 안', () => {
  assert.equal(GUIDE_SLIDES.length, 4)
  assert.equal(clampSlide(-1), 0)
  assert.equal(clampSlide(9), 3)
})

test('슬라이드를 닫으면 홈, 주소가 명시된 링크는 그대로', () => {
  assert.equal(homeAfterClose(''), '#/')
  assert.equal(homeAfterClose('#/map'), '#/')
  assert.equal(homeAfterClose('#/map?go=report'), null)
  assert.equal(homeAfterClose('#/map?report=abc'), null)
  assert.equal(homeAfterClose('#/alerts?section=benefits'), null)
  assert.equal(homeAfterClose('#/admin'), null)
  assert.equal(homeAfterClose('#/verify?x=1'), null)
})

test('한 번만 초기화: 처음엔 지정한 키만 지우고 버전 저장, 두 번째는 그대로', () => {
  const m = new Map<string, string>()
  const store = { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k) }
  for (const k of RESET_KEYS) m.set(k, 'x')
  const keep = ['wheelmap.reports', 'wheelmap.addrCache', 'wheelmap.sync.pending', 'wheelmap.motionForce', 'wheelmap.dongCache']
  for (const k of keep) m.set(k, 'data')
  assert.ok(['wheelmap.session', 'wheelmap.onboarded', 'wheelmap.theme', 'wheelmap.guideSeen', 'wheelmap.demoUser'].every((k) => RESET_KEYS.includes(k)))
  assert.equal(resetOnce(store), true)
  for (const k of RESET_KEYS) assert.equal(m.has(k), false, k)
  for (const k of keep) assert.equal(m.get(k), 'data', k)
  assert.equal(m.get(RESET_VERSION_KEY), RESET_VERSION)
  // 두 번째 실행: 다시 생긴 로그인 상태를 건드리지 않는다
  m.set('wheelmap.session', 'again')
  assert.equal(resetOnce(store), false)
  assert.equal(m.get('wheelmap.session'), 'again')
  // 다른 버전 값이면 다시 한 번
  assert.equal(resetOnce(store, 'next'), true)
  assert.equal(m.has('wheelmap.session'), false)
})

test('저장소가 막혀도 던지지 않는다', () => {
  const bad = { getItem: () => { throw new Error('x') }, setItem: () => { throw new Error('x') }, removeItem: () => { throw new Error('x') } }
  assert.equal(resetOnce(bad), false)
})
