import test from 'node:test'
import assert from 'node:assert/strict'
import { handle } from '../src/index.ts'
import { fakeD1 } from './fakeD1.ts'

const ORIGIN = 'https://starckson-kr.github.io'
const KEY = 'SECRET-KEY-VALUE-123'
let clock = 1_700_000_000_000
const now = () => clock

const arriveJson = {
  RESPONSE: {
    RESULT: { RESULT_CODE: 'SUCCESS' },
    BUSSTOP_LIST: {
      ITEM: [
        { LINE_ID: '1', SHORT_LINE_NAME: '419', REMAIN_MIN: '9', REMAIN_STOP: '4', LOW_BUS: '0', LINE_KIND: '11' },
        { LINE_ID: '2', SHORT_LINE_NAME: '28', REMAIN_MIN: '3', REMAIN_STOP: '1', LOW_BUS: '1', LINE_KIND: '12', DIR_END: '용봉' },
      ],
    },
  },
}
const lineInfoJson = { RESPONSE: { RESULT: { RESULT_CODE: 'SUCCESS' }, LINE_LIST: { ITEM: [{ LINE_ID: '77', SHORT_LINE_NAME: '419', LINE_NAME: '419' }] } } }
const locJson = { RESPONSE: { RESULT: { RESULT_CODE: 'SUCCESS' }, BUSLOCATION_LIST: { ITEM: [{ LOW_BUS: '1' }, { LOW_BUS: '0' }, { LOW_BUS: '1' }] } } }

function setup(extra: Record<string, string> = {}, reply?: (url: string) => Response) {
  const db = fakeD1()
  const urls: string[] = []
  const f = (async (url: string) => {
    urls.push(String(url))
    if (reply) return reply(String(url))
    const u = String(url)
    const body = u.includes('/arriveInfo') ? arriveJson : u.includes('/lineInfo') ? lineInfoJson : locJson
    return new Response(JSON.stringify(body), { status: 200 })
  }) as unknown as typeof fetch
  const env = { AI: { run: (async () => ({})) as never }, DB: db, ALLOWED_ORIGINS: ORIGIN, DATA_GO_KR_KEY: KEY, ...extra }
  const call = async (path: string, opts: { origin?: string | null; ip?: string; method?: string } = {}) => {
    const headers: Record<string, string> = { 'cf-connecting-ip': opts.ip ?? '8.8.8.8' }
    if (opts.origin !== null) headers.origin = opts.origin ?? ORIGIN
    const res = await handle(new Request('https://w.example' + path, { method: opts.method ?? 'GET', headers }), env as never, { now, fetch: f })
    const text = await res.text()
    return { status: res.status, text, body: JSON.parse(text) as Record<string, any> }
  }
  return { db, call, urls }
}

test('도착 조회: 정리된 응답, 키는 상류 주소에만 있고 응답에는 없다', async () => {
  const { call, urls } = setup()
  const r = await call('/bis/arrive?station=12345')
  assert.equal(r.status, 200)
  assert.equal(r.body.stationId, '12345')
  assert.equal(r.body.cached, false)
  assert.deepEqual(
    r.body.arrivals.map((a: any) => [a.lineName, a.remainMin, a.low]),
    [['28', 3, true], ['419', 9, false]],
  )
  assert.equal(r.body.arrivals[0].dirEnd, '용봉')
  assert.equal(urls.length, 1)
  assert.ok(urls[0].includes('BUSSTOP_ID=12345'))
  assert.ok(!r.text.includes(KEY))
})

test('같은 정류소 25초 캐시, 지나면 다시 호출', async () => {
  const { call, urls } = setup()
  await call('/bis/arrive?station=1')
  clock += 10_000
  const b = await call('/bis/arrive?station=1')
  assert.equal(b.body.cached, true)
  assert.equal(urls.length, 1)
  clock += 20_000
  const c = await call('/bis/arrive?station=1')
  assert.equal(c.body.cached, false)
  assert.equal(urls.length, 2)
})

test('입력 검증: 정류소·노선 형식, 메서드', async () => {
  const { call, urls } = setup()
  assert.equal((await call('/bis/arrive?station=abc')).status, 400)
  assert.equal((await call('/bis/arrive?station=12345678')).status, 400)
  assert.equal((await call('/bis/arrive')).status, 400)
  assert.equal((await call('/bis/line?name=' + encodeURIComponent('a b'))).status, 400)
  assert.equal((await call('/bis/arrive?station=1', { method: 'POST' })).status, 405)
  assert.equal(urls.length, 0)
})

test('허용하지 않은 출처·출처 없음은 403', async () => {
  const { call } = setup()
  assert.equal((await call('/bis/arrive?station=1', { origin: 'https://evil.example' })).status, 403)
  assert.equal((await call('/bis/arrive?station=1', { origin: null })).status, 403)
})

test('하루 상류 호출 상한: 넘으면 429, 캐시는 계속 나가고 다음 날 풀린다', async () => {
  const { call, urls } = setup({ BIS_DAILY_CAP: '2' })
  clock = 1_700_100_000_000
  assert.equal((await call('/bis/arrive?station=1')).status, 200)
  assert.equal((await call('/bis/arrive?station=2')).status, 200)
  const over = await call('/bis/arrive?station=3')
  assert.equal(over.status, 429)
  assert.ok(!over.text.includes(KEY))
  assert.equal((await call('/bis/arrive?station=1')).status, 200) // 캐시
  assert.equal(urls.length, 2)
  clock += 86_400_000
  assert.equal((await call('/bis/arrive?station=3')).status, 200)
})

test('IP별 분당 제한: 다른 IP·다음 분에는 영향 없다', async () => {
  const { call } = setup({ BIS_PER_MINUTE: '3' })
  clock = 1_700_200_000_000
  for (let i = 0; i < 3; i++) assert.equal((await call('/bis/arrive?station=1', { ip: '1.1.1.1' })).status, 200)
  assert.equal((await call('/bis/arrive?station=1', { ip: '1.1.1.1' })).status, 429)
  assert.equal((await call('/bis/arrive?station=1', { ip: '2.2.2.2' })).status, 200)
  clock += 61_000
  assert.equal((await call('/bis/arrive?station=1', { ip: '1.1.1.1' })).status, 200)
})

test('키가 없으면 503(캐시가 있으면 그대로 응답)', async () => {
  const { call } = setup({ DATA_GO_KR_KEY: '' })
  const r = await call('/bis/arrive?station=1')
  assert.equal(r.status, 503)
})

test('상류 오류: 502, 오류 문구·응답에 키가 없다', async () => {
  const bad = setup({}, () => new Response('nope', { status: 500 }))
  const a = await bad.call('/bis/arrive?station=1')
  assert.equal(a.status, 502)
  assert.ok(!a.text.includes(KEY))
  const notJson = setup({}, () => new Response('<html>', { status: 200 }))
  assert.equal((await notJson.call('/bis/arrive?station=1')).status, 502)
  const code = setup({}, () => new Response(JSON.stringify({ RESPONSE: { RESULT: { RESULT_CODE: `ERR ${KEY}`, RESULT_MSG: KEY } } }), { status: 200 }))
  const c = await code.call('/bis/arrive?station=1')
  assert.equal(c.status, 502)
  assert.ok(!c.text.includes(KEY))
})

test('상류 호출이 던져도(주소에 키가 든 오류) 응답·로그에 키가 없다', async () => {
  const logs: string[] = []
  const orig = console.log
  console.log = (...a: unknown[]) => void logs.push(a.join(' '))
  try {
    const { call } = setup({}, (url) => {
      throw new Error('fetch failed ' + url)
    })
    const r = await call('/bis/arrive?station=1')
    assert.equal(r.status, 502)
    assert.ok(!r.text.includes(KEY))
    assert.ok(!logs.join('\n').includes(KEY))
  } finally {
    console.log = orig
  }
})

test('노선 저상 수: 노선 목록은 하루 한 번, 운행 버스는 10분 캐시', async () => {
  const { call, urls } = setup()
  clock = 1_700_300_000_000
  const a = await call('/bis/line?name=419')
  assert.equal(a.status, 200)
  assert.equal(a.body.lineName, '419')
  assert.equal(a.body.total, 3)
  assert.equal(a.body.low, 2)
  assert.equal(urls.length, 2) // lineInfo + busLocationInfo
  clock += 5 * 60_000
  await call('/bis/line?name=419')
  assert.equal(urls.length, 2)
  clock += 6 * 60_000
  await call('/bis/line?name=419')
  assert.equal(urls.length, 3) // lineInfo 캐시, 위치만 다시
  assert.equal((await call('/bis/line?name=999')).status, 502)
})

test('secret 끝에 줄바꿈·공백이 붙어 있어도 상류에는 깨끗한 키로 부른다(붙으면 상류가 403 등록되지 않은 서비스키)', async () => {
  const { call, urls } = setup({ DATA_GO_KR_KEY: ` ${KEY}\r\n` })
  const r = await call('/bis/arrive?station=12345')
  assert.equal(r.status, 200)
  assert.ok(urls[0].includes(`serviceKey=${encodeURIComponent(KEY)}&`))
  assert.ok(!urls[0].includes('%0A') && !urls[0].includes('%0D') && !urls[0].includes('%20'))
})
