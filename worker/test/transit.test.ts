import test from 'node:test'
import assert from 'node:assert/strict'
import { handle } from '../src/index.ts'
import { fakeD1 } from './fakeD1.ts'

const ORIGIN = 'https://starckson-kr.github.io'
const KEY = 'SECRET-KEY-VALUE-123'
let clock = Date.parse('2026-11-19T14:20:00+09:00')
const now = () => clock

const upstreamOk = {
  result: {
    path: [
      {
        info: { totalTime: 20, payment: 1250, busTransitCount: 1, totalWalk: 600 },
        subPath: [
          { trafficType: 3, distance: 80, sectionTime: 1 },
          { trafficType: 2, distance: 1500, sectionTime: 10, lane: [{ busNo: '419', type: 12 }], startName: 'A', startX: 126.9, startY: 35.18, endName: 'B', endX: 126.91, endY: 35.17, passStopList: { stations: [] } },
          { trafficType: 3, distance: 300, sectionTime: 4 },
        ],
      },
    ],
  },
}
const Q = '?from=35.18201,126.909703&to=35.172172,126.900534'

function setup(extra: Record<string, string> = {}, reply?: (url: string, init?: RequestInit) => Response) {
  const db = fakeD1()
  const calls: { url: string; headers: Record<string, string> }[] = []
  const f = (async (url: string, init?: RequestInit) => {
    calls.push({ url: String(url), headers: (init?.headers ?? {}) as Record<string, string> })
    return reply ? reply(String(url), init) : new Response(JSON.stringify(upstreamOk), { status: 200 })
  }) as unknown as typeof fetch
  const env = { AI: { run: (async () => ({})) as never }, DB: db, ALLOWED_ORIGINS: ORIGIN, KOREACONNECT_KEY: KEY, ...extra }
  const call = async (q = Q, opts: { ip?: string; method?: string } = {}) => {
    const res = await handle(
      new Request('https://w.example/transit' + q, { method: opts.method ?? 'GET', headers: { origin: ORIGIN, 'cf-connecting-ip': opts.ip ?? '8.8.8.8' } }),
      env as never,
      { now, fetch: f },
    )
    const text = await res.text()
    return { status: res.status, text, body: JSON.parse(text) as Record<string, any> }
  }
  return { call, calls }
}

test('버스 길찾기: 앱 형식으로 돌려주고 키는 헤더로만 나가며 응답에는 없다', async () => {
  const { call, calls } = setup()
  const r = await call()
  assert.equal(r.status, 200)
  assert.equal(r.body.ok, true)
  assert.equal(r.body.itineraries[0].legs[1].lineName, '419')
  assert.ok(!r.text.includes(KEY))
  assert.equal(calls.length, 1)
  assert.equal(calls[0].headers.api_user_key_id, KEY)
  assert.ok(!calls[0].url.includes(KEY))
})

test('버스 길찾기: 같은 구간은 캐시, 6시간 뒤에는 다시 부른다', async () => {
  const { call, calls } = setup()
  await call()
  const again = await call()
  assert.equal(again.body.cached, true)
  assert.equal(calls.length, 1)
  clock += 7 * 3_600_000
  await call()
  assert.equal(calls.length, 2)
})

test('버스 길찾기: 하루 상한에 닿으면 429, 형식이 틀리면 400, 키가 없으면 503', async () => {
  const { call, calls } = setup({ TRANSIT_DAILY_CAP: '1' })
  assert.equal((await call()).status, 200)
  assert.equal((await call('?from=35.19,126.91&to=35.17,126.90')).status, 429)
  assert.equal(calls.length, 1)
  assert.equal((await call('?from=abc&to=1,2')).status, 400)
  assert.equal((await call('?from=10,10&to=35.1,126.9')).status, 400)
  const nokey = setup({ KOREACONNECT_KEY: '' })
  assert.equal((await nokey.call('?from=35.2,126.8&to=35.1,126.9')).status, 503)
})

test('버스 길찾기: 길이 없으면 422로 알리고 1시간은 다시 부르지 않으며, 상류 오류는 502로 키 없이', async () => {
  const none = setup({}, () => new Response(JSON.stringify({ error: { code: '-98', msg: `x ${KEY}` } }), { status: 200 }))
  const r = await none.call()
  assert.equal(r.status, 422)
  assert.ok(!r.text.includes(KEY))
  await none.call()
  assert.equal(none.calls.length, 1)
  const bad = setup({}, () => new Response('<html>' + KEY, { status: 500 }))
  const b = await bad.call()
  assert.equal(b.status, 502)
  assert.ok(!b.text.includes(KEY))
})

test('버스 길찾기: POST는 405', async () => {
  const { call } = setup()
  assert.equal((await call(Q, { method: 'POST' })).status, 405)
})

test('버스 길찾기: 상류 실패는 3분 기억 — 그동안 상류도 하루 상한도 쓰지 않고 같은 502, 3분 뒤 다시 부른다', async () => {
  clock = Date.parse('2026-11-22T10:00:00+09:00')
  const fail = setup({ TRANSIT_DAILY_CAP: '3' }, () => new Response('<html>Web firewall', { status: 200 }))
  const a = await fail.call()
  assert.equal(a.status, 502)
  assert.equal(fail.calls.length, 1)
  for (let i = 0; i < 5; i++) {
    const b = await fail.call()
    assert.equal(b.status, 502)
    assert.equal(b.body.error, a.body.error)
  }
  assert.equal(fail.calls.length, 1) // 상류 호출 늘지 않음
  // 하루 상한(3)을 깎지 않았으므로 다른 구간은 429가 아니라 다시 상류를 부른다
  assert.equal((await fail.call('?from=35.19,126.91&to=35.17,126.90')).status, 502)
  assert.equal(fail.calls.length, 2)
  assert.equal((await fail.call('?from=35.19,126.91&to=35.17,126.90')).status, 502)
  assert.equal(fail.calls.length, 2)
  clock += 3 * 60_000 + 1
  assert.equal((await fail.call()).status, 502)
  assert.equal(fail.calls.length, 3) // 기억이 끝나 다시 부름
})
