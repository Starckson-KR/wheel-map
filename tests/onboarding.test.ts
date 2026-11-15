// 실행: node --import ./scripts/registerTs.mjs --test tests/onboarding.test.ts
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  afterAuth, authMessage, cleanName, dotIndex, isSkipHash, mobilityToWheelchair, nameOk, parsePreview, parseProfile, startScreen, toBenefitPrefs,
} from '../src/components/onboarding/flow.ts'
import { effectiveLang, parseLang } from '../src/lib/i18n/index.ts'

test('시작 화면: 로그인 안 됨 → 언어, 로그인만 → 이동 방식, 둘 다 → 앱', () => {
  assert.equal(startScreen({ loggedIn: false, onboarded: false }), 'lang')
  assert.equal(startScreen({ loggedIn: false, onboarded: true }), 'lang')
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
})

test('언어: 영어는 번역이 없어 한국어로 안내', () => {
  assert.equal(parseLang('en'), 'en')
  assert.equal(parseLang('fr'), null)
  assert.equal(effectiveLang('en'), 'ko')
  assert.equal(effectiveLang(null), 'ko')
})
