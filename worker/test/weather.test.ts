import test from 'node:test'
import assert from 'node:assert/strict'
import { handle } from '../src/index.ts'
import { applyRules } from '../src/rules.ts'
import { fakeD1 } from './fakeD1.ts'

const ORIGIN = 'https://starckson-kr.github.io'
const KEY = 'SECRET-KEY-VALUE-123'
let clock = Date.parse('2026-11-19T14:20:00+09:00')
const now = () => clock

const wrap = (item: unknown[]) => ({ response: { header: { resultCode: '00' }, body: { items: { item } } } })
const ncstJson = wrap([
  { baseDate: '20261119', baseTime: '1400', category: 'PTY', obsrValue: '0' },
  { baseDate: '20261119', baseTime: '1400', category: 'T1H', obsrValue: '17.6' },
])
const fcstJson = wrap([{ category: 'SKY', fcstDate: '20261119', fcstTime: '1500', fcstValue: '1' }])

function setup(extra: Record<string, string> = {}, reply?: (url: string) => Response) {
  const db = fakeD1()
  const urls: string[] = []
  const f = (async (url: string) => {
    urls.push(String(url))
    if (reply) return reply(String(url))
    return new Response(JSON.stringify(String(url).includes('getUltraSrtNcst') ? ncstJson : fcstJson), { status: 200 })
  }) as unknown as typeof fetch
  const env = { AI: { run: (async () => ({})) as never }, DB: db, ALLOWED_ORIGINS: ORIGIN, DATA_GO_KR_KEY: KEY, ...extra }
  const call = async (opts: { origin?: string | null; ip?: string; method?: string } = {}) => {
    const headers: Record<string, string> = { 'cf-connecting-ip': opts.ip ?? '8.8.8.8' }
    if (opts.origin !== null) headers.origin = opts.origin ?? ORIGIN
    const res = await handle(new Request('https://w.example/weather', { method: opts.method ?? 'GET', headers }), env as never, { now, fetch: f })
    const text = await res.text()
    return { status: res.status, text, body: JSON.parse(text) as Record<string, any> }
  }
  return { call, urls }
}

test('날씨: 실황과 예보를 합쳐 돌려주고 키는 응답에 없다', async () => {
  const { call, urls } = setup()
  const r = await call()
  assert.equal(r.status, 200)
  assert.deepEqual({ ok: r.body.ok, tempC: r.body.tempC, condition: r.body.condition }, { ok: true, tempC: 18, condition: 'clear' })
  assert.ok(!r.text.includes(KEY))
  assert.equal(urls.length, 2)
  assert.ok(urls.every((u) => u.includes(encodeURIComponent(KEY)) && u.includes('nx=59') && u.includes('ny=75')))
})

test('날씨: 10분 안에는 상류를 다시 부르지 않고, 지나면 다시 부른다', async () => {
  const { call, urls } = setup()
  await call()
  clock += 9 * 60_000
  await call()
  assert.equal(urls.length, 2)
  clock += 2 * 60_000
  await call()
  assert.equal(urls.length, 4)
})

test('날씨: 상류가 실패하면 502, 키는 어디에도 없고, 2분 동안은 다시 두드리지 않는다', async () => {
  const { call, urls } = setup({}, () => new Response('{"OpenAPI_ServiceResponse":{"cmmMsgHeader":{"errMsg":"SERVICE_KEY_IS_NOT_REGISTERED_ERROR"}}}', { status: 403 }))
  const a = await call()
  assert.equal(a.status, 502)
  assert.ok(!a.text.includes(KEY) && !a.text.includes('SERVICE_KEY'))
  const n = urls.length
  clock += 60_000
  assert.equal((await call()).status, 502)
  assert.equal(urls.length, n)
  clock += 2 * 60_000
  await call()
  assert.ok(urls.length > n)
})

test('날씨: 키가 없으면 503, 출처가 다르면 403, GET만 허용', async () => {
  clock += 3_600_000
  assert.equal((await setup({ DATA_GO_KR_KEY: '' }).call()).status, 503)
  assert.equal((await setup().call({ origin: 'https://evil.example' })).status, 403)
  assert.equal((await setup().call({ method: 'POST' })).status, 405)
})

test('날씨 의도: 날씨 말은 모델이 unknown·help로 답해도 weather, 신고 말투와 딴 의도는 그대로', () => {
  const R = (intent: string) => ({ intent, slots: {}, confidence: 0.8 })
  for (const q of ['오늘 날씨 어때요', '날씨 알려줘', '지금 비 와요', '우산 가져가야 해요?', '기온이 몇 도예요']) {
    assert.equal(applyRules(q, R('unknown')).intent, 'weather', q)
    assert.equal(applyRules(q, R('help')).intent, 'weather', q)
  }
  assert.equal(applyRules('비 와서 경사로가 막혔어요', R('unknown')).intent, 'unknown') // 문제 말투는 날씨 답으로 올리지 않는다
  assert.equal(applyRules('비 와서 경사로가 막혔어요', R('report_new')).intent, 'report_new')
  assert.equal(applyRules('오늘 점심 뭐 먹지', R('weather')).intent, 'unknown') // 날씨 말이 없는데 모델이 날씨로 답하면 믿지 않는다
  assert.equal(applyRules('저상버스 언제 와요', R('bus')).intent, 'bus')
})
