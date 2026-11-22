import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseCityConsent, shouldAskCityConsent } from '../src/lib/account/cityConsent.ts'
import { SYNCED_PREF_KEYS } from '../src/lib/account/keys.ts'

const ready = { loggedIn: true, onboarded: true, pulled: true, value: null } as const

test('동의 카드: 조건이 모두 맞고 값이 없을 때만 묻는다', () => {
  assert.equal(shouldAskCityConsent(ready), true)
  assert.equal(shouldAskCityConsent({ ...ready, loggedIn: false }), false)
  assert.equal(shouldAskCityConsent({ ...ready, onboarded: false }), false) // 온보딩 위에 겹치지 않는다
  assert.equal(shouldAskCityConsent({ ...ready, pulled: false }), false) // 서버 설정을 받기 전에는 묻지 않는다
})

test('동의 카드: 한 번 답하면(yes·no) 다시 묻지 않는다', () => {
  assert.equal(shouldAskCityConsent({ ...ready, value: 'yes' }), false)
  assert.equal(shouldAskCityConsent({ ...ready, value: 'no' }), false)
})

test('저장값 읽기: yes·no 말고는 아직 안 물은 것으로 본다', () => {
  assert.equal(parseCityConsent('yes'), 'yes')
  assert.equal(parseCityConsent('no'), 'no')
  assert.equal(parseCityConsent(null), null)
  assert.equal(parseCityConsent('maybe'), null)
})

test('설정 동기화 대상에 들어 있다', () => {
  assert.ok((SYNCED_PREF_KEYS as readonly string[]).includes('wheelmap.cityConsent'))
})
