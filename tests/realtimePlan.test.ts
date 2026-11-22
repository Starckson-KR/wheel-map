import test from 'node:test'
import assert from 'node:assert/strict'
import { RECONNECT_MAX_MS, parseSignal, reconnectDelay, wsUrl } from '../src/lib/account/realtimePlan.ts'
import { POLL_ACTIVE_MS, POLL_IDLE_MS, POLL_LIVE_MS, nextDelay } from '../src/lib/account/pollPlan.ts'

test('재연결 간격: 1초에서 시작해 두 배씩 늘고 30초에서 멈춘다(±20%)', () => {
  assert.equal(reconnectDelay(0, 0.5), 1000)
  assert.equal(reconnectDelay(1, 0.5), 2000)
  assert.equal(reconnectDelay(3, 0.5), 8000)
  assert.equal(reconnectDelay(20, 0.5), RECONNECT_MAX_MS)
  assert.equal(reconnectDelay(0, 0), 800)
  assert.equal(reconnectDelay(0, 1), 1200)
})

test('웹소켓 주소: http→ws, https→wss, 뒤 슬래시 제거, 티켓은 주소 인코딩', () => {
  assert.equal(wsUrl('https://a.workers.dev', 'abc'), 'wss://a.workers.dev/rt?ticket=abc')
  assert.equal(wsUrl('http://localhost:8787/', 'a b'), 'ws://localhost:8787/rt?ticket=a%20b')
})

test('신호 읽기: reports·prefs·presence만, pong·깨진 값·엉뚱한 값은 무시', () => {
  assert.equal(parseSignal('{"t":"reports"}'), 'reports')
  assert.equal(parseSignal('{"t":"prefs"}'), 'prefs')
  assert.equal(parseSignal('{"t":"presence"}'), 'presence')
  assert.equal(parseSignal('pong'), null)
  assert.equal(parseSignal('{"t":"admin"}'), null)
  assert.equal(parseSignal('{'), null)
  assert.equal(parseSignal(new ArrayBuffer(2)), null)
  assert.equal(parseSignal('{"t":"reports","x":"' + 'a'.repeat(300) + '"}'), null)
})

test('확인 주기: 실시간 연결이 있으면 30초 안전망, 없으면 4초/15초 그대로, 실패하면 늘린다', () => {
  assert.equal(nextDelay(0, 0, 0.5), POLL_ACTIVE_MS)
  assert.equal(nextDelay(0, 120_000, 0.5), POLL_IDLE_MS)
  assert.equal(nextDelay(0, 0, 0.5, true), POLL_LIVE_MS)
  assert.equal(nextDelay(0, 120_000, 0.5, true), POLL_LIVE_MS)
  assert.ok(nextDelay(2, 0, 0.5, true) > POLL_LIVE_MS)
})
