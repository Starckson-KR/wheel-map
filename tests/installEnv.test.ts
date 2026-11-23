// 실행: node --test --import ./scripts/registerTs.mjs tests/installEnv.test.ts
import test from 'node:test'
import assert from 'node:assert/strict'
import { guessAndroidBrowser, guessDevice, isInAppBrowser, isStandalone } from '../src/components/onboarding/installEnv.ts'
import { SCREENS, afterWelcome, dotIndex, installStart } from '../src/components/onboarding/flow.ts'

const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1'
const GALAXY_CHROME = 'Mozilla/5.0 (Linux; Android 14; SM-S921N) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36'
const GALAXY_SAMSUNG = 'Mozilla/5.0 (Linux; Android 14; SM-S921N) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/26.0 Chrome/122.0.0.0 Mobile Safari/537.36'
const KAKAO = GALAXY_CHROME + ' KAKAOTALK 10.8.0'
const DESKTOP = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36'

test('기기 어림', () => {
  assert.equal(guessDevice(IPHONE), 'ios')
  assert.equal(guessDevice(GALAXY_CHROME), 'android')
  assert.equal(guessDevice(DESKTOP), null)
})

test('안드로이드 브라우저 어림: 삼성 인터넷이 아니면 Chrome', () => {
  assert.equal(guessAndroidBrowser(GALAXY_SAMSUNG), 'samsung')
  assert.equal(guessAndroidBrowser(GALAXY_CHROME), 'chrome')
})

test('앱 안 브라우저 판정', () => {
  assert.equal(isInAppBrowser(KAKAO), true)
  assert.equal(isInAppBrowser(GALAXY_CHROME), false)
  assert.equal(isInAppBrowser(IPHONE), false)
})

test('홈 화면 앱 판정: display-mode 또는 iOS navigator.standalone', () => {
  assert.equal(isStandalone({ navStandalone: true }), true)
  assert.equal(isStandalone({ matchMedia: (q) => ({ matches: q.includes('standalone') }) }), true)
  assert.equal(isStandalone({ matchMedia: () => ({ matches: false }) }), false)
  assert.equal(isStandalone({}), false)
  assert.equal(isStandalone({ matchMedia: () => { throw new Error('x') } }), false)
})

test('첫 흐름에는 기기·설치 안내가 없고, 안내를 따로 열 때는 기기를 알면 바로 설치 안내', () => {
  assert.equal(afterWelcome(), 'name')
  assert.equal(installStart('ios'), 'install')
  assert.equal(installStart('android'), 'install')
  assert.equal(installStart(null), 'device')
  assert.ok(SCREENS.includes('device') && SCREENS.includes('install'))
  assert.equal(dotIndex('device'), -1)
  assert.equal(dotIndex('install'), -1)
})
