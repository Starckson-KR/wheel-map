import test from 'node:test'
import assert from 'node:assert/strict'
import { handle } from '../src/index.ts'
import { RealtimeHub, userTag, DEV_TAG } from '../src/hub.ts'
import { flagOf, XMAS_OFF } from '../src/xmas.ts'
import { fakeD1 } from './fakeD1.ts'

const ORIGIN = 'https://starckson-kr.github.io'
let clock = 1_800_000_000_000
const now = () => clock
type J = Record<string, any>

function setup(withHub = true) {
  const db = fakeD1()
  const published: { t: string; user?: string }[] = []
  const ns = {
    idFromName: (n: string) => n,
    get: () => ({
      fetch: async (_input: string | Request, init?: RequestInit) => {
        published.push(JSON.parse(String(init?.body)))
        return new Response('1')
      },
    }),
  }
  const env = { AI: { run: (async () => ({})) as never }, DB: db, ALLOWED_ORIGINS: ORIGIN, ...(withHub ? { HUB: ns } : {}) }
  let n = 0
  const call = async (method: string, path: string, o: { json?: unknown; token?: string; origin?: string | null; raw?: string } = {}) => {
    const headers: Record<string, string> = { 'cf-connecting-ip': `10.2.0.${n++ % 200}` }
    if (o.origin !== null) headers.origin = o.origin ?? ORIGIN
    if (o.token) headers.authorization = `Bearer ${o.token}`
    let body: BodyInit | undefined = o.raw
    if (o.json !== undefined) {
      headers['content-type'] = 'application/json'
      body = JSON.stringify(o.json)
    }
    const res = await handle(new Request('https://w.example' + path, { method, headers, body: method === 'GET' ? undefined : body }), env as never, { now })
    const type = res.headers.get('content-type') ?? ''
    return { status: res.status, body: (type.includes('json') ? await res.json() : null) as J }
  }
  const signup = async (name: string) => {
    const r = await call('POST', '/auth/signup', { json: { name, pin: '1234' } })
    assert.equal(r.status, 200, JSON.stringify(r.body))
    return { token: r.body.token as string, id: r.body.user.id as string }
  }
  const makeDev = (id: string) => db.raw.prepare("UPDATE users SET role = 'dev' WHERE id = ?").run(id)
  return { db, published, call, signup, makeDev }
}

test('flagOf: 줄이 없거나 모양이 다르면 꺼짐', () => {
  assert.deepEqual(flagOf(null), XMAS_OFF)
  assert.deepEqual(flagOf({ value: 'on', at: 0 }), XMAS_OFF)
  assert.deepEqual(flagOf({ value: 'on', at: 'x' }), XMAS_OFF)
  assert.deepEqual(flagOf({ value: 'on', at: 5 }), { on: true, at: 5 })
  assert.deepEqual(flagOf({ value: 'off', at: 7 }), { on: false, at: 7 })
  assert.deepEqual(flagOf({ value: 'yes', at: 7 }), { on: false, at: 7 })
})

test('GET /xmas: 처음에는 꺼짐, 로그인 없이 읽을 수 있고 허용 출처가 아니면 403', async () => {
  const { call } = setup()
  const r = await call('GET', '/xmas')
  assert.equal(r.status, 200)
  assert.deepEqual(r.body, { ok: true, on: false, at: 0 })
  assert.equal((await call('GET', '/xmas', { origin: 'https://evil.example' })).status, 403)
  assert.equal((await call('POST', '/xmas', { json: { on: true } })).status, 405)
})

test('POST /admin/xmas: 개발자만 켜고 끌 수 있고, 바꿀 때마다 모두에게 xmas 신호가 간다', async () => {
  const { call, signup, makeDev, published } = setup()
  const d = await signup('개발자')
  makeDev(d.id)
  const u = await signup('일반')
  assert.equal((await call('POST', '/admin/xmas', { json: { on: true } })).status, 401)
  assert.equal((await call('POST', '/admin/xmas', { token: u.token, json: { on: true } })).status, 403)
  assert.equal((await call('GET', '/admin/xmas', { token: u.token })).status, 403)
  assert.deepEqual((await call('GET', '/xmas')).body, { ok: true, on: false, at: 0 })
  assert.equal(published.length, 0)

  const t1 = clock
  const on = await call('POST', '/admin/xmas', { token: d.token, json: { on: true } })
  assert.deepEqual(on.body, { ok: true, on: true, at: t1 })
  assert.deepEqual(published, [{ t: 'xmas' }]) // user가 없다 = 모든 연결에
  assert.deepEqual((await call('GET', '/xmas')).body, { ok: true, on: true, at: t1 })
  assert.deepEqual((await call('GET', '/admin/xmas', { token: d.token })).body, { ok: true, on: true, at: t1 })

  clock += 60_000
  const off = await call('POST', '/admin/xmas', { token: d.token, json: { on: false } })
  assert.deepEqual(off.body, { ok: true, on: false, at: clock })
  assert.deepEqual((await call('GET', '/xmas')).body, { ok: true, on: false, at: clock })
  assert.equal(published.length, 2)

  // 같은 값으로 다시 눌러도 시각이 새로 찍힌다(모든 기기가 한 번 더 새로 고쳐짐)
  clock += 1000
  assert.equal((await call('POST', '/admin/xmas', { token: d.token, json: { on: false } })).body.at, clock)
})

test('POST /admin/xmas: 값이 불리언이 아니면 400, 저장·신호 없음', async () => {
  const { call, signup, makeDev, published } = setup()
  const d = await signup('개발자')
  makeDev(d.id)
  for (const json of [{ on: 'true' }, { on: 1 }, {}]) assert.equal((await call('POST', '/admin/xmas', { token: d.token, json })).status, 400)
  assert.equal((await call('POST', '/admin/xmas', { token: d.token, raw: 'x' })).status, 400)
  assert.equal((await call('PUT', '/admin/xmas', { token: d.token, json: { on: true } })).status, 405)
  assert.equal(published.length, 0)
  assert.deepEqual((await call('GET', '/xmas')).body, { ok: true, on: false, at: 0 })
})

test('허브가 없어도(미설정) 켜기는 저장된다', async () => {
  const { call, signup, makeDev } = setup(false)
  const d = await signup('개발자')
  makeDev(d.id)
  assert.equal((await call('POST', '/admin/xmas', { token: d.token, json: { on: true } })).status, 200)
  assert.equal((await call('GET', '/xmas')).body.on, true)
})

test('표가 아직 없으면(마이그레이션 전) GET /xmas는 꺼짐으로 답한다', async () => {
  const { call, db } = setup()
  db.raw.exec('DROP TABLE app_flags')
  assert.deepEqual((await call('GET', '/xmas')).body, { ok: true, on: false, at: 0 })
})

test('허브 /publish xmas: user가 실려 와도 모든 연결에 보낸다', async () => {
  ;(globalThis as any).WebSocketRequestResponsePair = class {}
  const mk = (tags: string[]) => ({ tags, sent: [] as string[], send(m: string) { this.sent.push(m) }, close() {} })
  const a = mk([userTag('a')])
  const b = mk([userTag('b'), DEV_TAG])
  const sockets = [a, b]
  const ctx = { getWebSockets: (tag?: string) => (tag ? sockets.filter((s) => s.tags.includes(tag)) : sockets), acceptWebSocket() {}, setWebSocketAutoResponse() {} }
  const hub = new RealtimeHub(ctx as never)
  const r = await hub.fetch(new Request('https://hub/publish', { method: 'POST', body: JSON.stringify({ t: 'xmas', user: 'a' }) }))
  assert.equal(await r.text(), '2')
  assert.deepEqual(a.sent, ['{"t":"xmas"}'])
  assert.deepEqual(b.sent, ['{"t":"xmas"}'])
})
