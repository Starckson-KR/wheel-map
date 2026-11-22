import test from 'node:test'
import assert from 'node:assert/strict'
import { handle } from '../src/index.ts'
import { DEV_TAG, RealtimeHub, STALE_MS, presenceOf, userTag } from '../src/hub.ts'
import { dayStart } from '../src/activity.ts'
import { fakeD1 } from './fakeD1.ts'

const ORIGIN = 'https://starckson-kr.github.io'
let clock = 1_700_000_000_000
const now = () => clock
type J = Record<string, any>

// ---- 순수 판정 ----
test('presenceOf: 오래된 연결은 online에서 빼고 seen 후보로, 저장된 seen과 큰 값을 합친다', () => {
  const t = 1_000_000
  const r = presenceOf(
    [
      { userId: 'a', at: t - 10_000, ping: null, open: true },
      { userId: 'a', at: t - 500_000, ping: t - STALE_MS + 1, open: true }, // ping이 최근이라 살아 있음
      { userId: 'b', at: t - 200_000, ping: t - 100_000, open: true }, // 오래됨 → seen 후보 t-100_000
      { userId: 'c', at: t - 1_000, ping: null, open: false }, // 닫히는 중
    ],
    { b: t - 300_000, d: 5 },
    t,
  )
  assert.deepEqual(r.presence.online, { a: 2 })
  assert.equal(r.presence.seen.b, t - 100_000)
  assert.equal(r.presence.seen.c, t - 1_000)
  assert.equal(r.presence.seen.d, 5)
  assert.deepEqual(r.stale, [2, 3])
})

// ---- 허브 클래스(가짜 ctx) ----
type Ws = { name: string; tags: string[]; at: number; ping: Date | null; closed: string[]; sent: string[]; readyState: number; send(m: string): void; close(c?: number, r?: string): void; serializeAttachment(v: unknown): void; deserializeAttachment(): unknown }
function mkWs(name: string, tags: string[], at: number, ping: Date | null = null): Ws {
  const w: Ws = {
    name, tags, at, ping, closed: [], sent: [], readyState: 1,
    send(m) { w.sent.push(m) },
    close(c, r) { w.closed.push(`${c}:${r}`) },
    serializeAttachment(v) { w.at = (v as { at: number }).at },
    deserializeAttachment() { return { at: w.at } },
  }
  return w
}
function mkHub(sockets: Ws[]) {
  ;(globalThis as any).WebSocketRequestResponsePair = class {}
  const store = new Map<string, unknown>()
  const ctx = {
    getWebSockets: (tag?: string) => (tag ? sockets.filter((s) => s.tags.includes(tag)) : sockets),
    getTags: (ws: Ws) => ws.tags,
    getWebSocketAutoResponseTimestamp: (ws: Ws) => ws.ping,
    acceptWebSocket() {},
    setWebSocketAutoResponse() {},
    storage: {
      put: async (k: string, v: unknown) => void store.set(k, v),
      list: async ({ prefix }: { prefix: string }) => new Map([...store].filter(([k]) => k.startsWith(prefix))),
      delete: async (k: string | string[]) => void [k].flat().forEach((x) => store.delete(x)),
    },
  }
  return { hub: new RealtimeHub(ctx as never), store }
}

test('허브 /presence: 연결 수·seen만 내보내고, 오래된 연결은 닫고 seen에 반영, 90일 지난 seen은 지운다', async () => {
  const t = Date.now()
  const a1 = mkWs('a1', [userTag('a')], t - 5_000)
  const a2 = mkWs('a2', [userTag('a')], t - 3_600_000, new Date(t - 20_000))
  const b1 = mkWs('b1', [userTag('b'), DEV_TAG], t - 600_000) // 오래됨
  const { hub, store } = mkHub([a1, a2, b1])
  store.set('seen:c', t - 1000)
  store.set('seen:old', t - 91 * 24 * 3600_000)
  const res = await hub.fetch(new Request('https://hub/presence'))
  const j = (await res.json()) as { online: Record<string, number>; seen: Record<string, number> }
  assert.deepEqual(j.online, { a: 2 })
  assert.equal(j.seen.c, t - 1000)
  assert.ok(Math.abs(j.seen.b - (t - 600_000)) < 50)
  assert.ok(!('old' in j.seen))
  assert.equal(store.has('seen:old'), false)
  assert.deepEqual(b1.closed, ['1011:stale'])
  assert.deepEqual(a1.closed, [])
  assert.deepEqual(Object.keys(j).sort(), ['online', 'seen'])
})

test('허브 /publish presence는 dev 태그 연결에만, 끊김은 seen을 저장하고 dev에 알린다', async () => {
  const dev = mkWs('dev', [userTag('d'), DEV_TAG], Date.now())
  const user = mkWs('u', [userTag('u')], Date.now())
  const { hub, store } = mkHub([dev, user])
  const r = await hub.fetch(new Request('https://hub/publish', { method: 'POST', body: JSON.stringify({ t: 'presence' }) }))
  assert.equal(r.status, 200)
  assert.deepEqual(dev.sent, ['{"t":"presence"}'])
  assert.deepEqual(user.sent, [])
  await hub.webSocketClose(user as never)
  assert.equal(typeof store.get('seen:u'), 'number')
  assert.deepEqual(dev.sent, ['{"t":"presence"}', '{"t":"presence"}'])
  await hub.webSocketError(user as never)
  assert.equal(dev.sent.length, 3)
  // 기존 신호는 모두에게
  await hub.fetch(new Request('https://hub/publish', { method: 'POST', body: JSON.stringify({ t: 'reports' }) }))
  assert.ok(user.sent.join().includes('reports'))
})

// ---- Worker 연결(rt)·관리 API ----
function fakeHubNs(presenceBody: () => unknown | null) {
  const published: { t: string; user?: string }[] = []
  const connects: Headers[] = []
  const ns = {
    idFromName: (n: string) => n,
    get: () => ({
      fetch: async (input: string | Request, init?: RequestInit) => {
        const url = typeof input === 'string' ? input : input.url
        if (url.endsWith('/publish')) {
          published.push(JSON.parse(String(init?.body)))
          return new Response('1')
        }
        if (url.endsWith('/presence')) {
          const b = presenceBody()
          return b === null ? new Response('x', { status: 500 }) : new Response(JSON.stringify(b))
        }
        connects.push((input as Request).headers)
        return new Response('ok')
      },
    }),
  }
  return { ns, published, connects }
}

function setup(presenceBody: () => unknown | null = () => ({ online: {}, seen: {} }), withHub = true) {
  const db = fakeD1()
  const hub = fakeHubNs(presenceBody)
  const env = { AI: { run: (async () => ({})) as never }, DB: db, ALLOWED_ORIGINS: ORIGIN, ...(withHub ? { HUB: hub.ns } : {}) }
  let n = 0
  const call = async (method: string, path: string, o: { json?: unknown; token?: string; upgrade?: boolean; headers?: Record<string, string> } = {}) => {
    const headers: Record<string, string> = { origin: ORIGIN, 'cf-connecting-ip': `10.1.${Math.floor(n / 200)}.${n++ % 200}`, ...o.headers }
    if (o.token) headers.authorization = `Bearer ${o.token}`
    if (o.upgrade) headers.upgrade = 'websocket'
    let body: BodyInit | undefined
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
  return { db, hub, call, signup, makeDev }
}

test('rt: 개발자면 x-rt-dev를 붙이고, 일반 사용자는 밖에서 보낸 x-rt-dev도 지운다', async () => {
  const { call, signup, makeDev, hub } = setup()
  const d = await signup('개발자')
  makeDev(d.id)
  const u = await signup('일반')
  const td = (await call('POST', '/rt/ticket', { token: d.token })).body.ticket as string
  assert.equal((await call('GET', `/rt?ticket=${td}`, { upgrade: true })).status, 200)
  assert.equal(hub.connects[0].get('x-rt-dev'), '1')
  const tu = (await call('POST', '/rt/ticket', { token: u.token })).body.ticket as string
  assert.equal((await call('GET', `/rt?ticket=${tu}`, { upgrade: true, headers: { 'x-rt-dev': '1' } })).status, 200)
  assert.equal(hub.connects[1].get('x-rt-dev'), null)
  assert.equal(hub.connects[1].get('x-rt-user'), u.id)
})

const visit = (call: ReturnType<typeof setup>['call'], token: string, deviceId: string) => call('POST', '/activity/visit', { token, json: { deviceId, build: 'b1', screen: { w: 1, h: 1 } } })

test('접속 기록을 넣으면 presence 알림, 건너뛴 기록(중복)은 알리지 않는다', async () => {
  const { call, signup, hub } = setup()
  const a = await signup('가나')
  hub.published.length = 0
  assert.equal((await visit(call, a.token, 'devicepres0001')).status, 200)
  assert.deepEqual(hub.published, [{ t: 'presence' }])
  const r = await visit(call, a.token, 'devicepres0001')
  assert.equal(r.body.skipped, true)
  assert.equal(hub.published.length, 1)
})

test('/admin/users: 접속 중 먼저·최근 접속순, online·lastAt·visits30·onlineUsers·todayUsers', async () => {
  const day = 24 * 3600_000
  const ids: Record<string, string> = {}
  const { call, signup, makeDev, db } = setup(() => ({ online: { [ids.b]: 2 }, seen: { [ids.c]: clock - 5 * 60_000, [ids.d]: clock - 2 * day } }))
  const dv = await signup('개발자')
  makeDev(dv.id)
  const a = await signup('에이') // 접속 기록만(어제)
  const b = await signup('비') // 접속 중
  const c = await signup('씨') // 5분 전 끊김
  const d = await signup('디') // 이틀 전 seen
  const e = await signup('이') // 기록 없음
  Object.assign(ids, { a: a.id, b: b.id, c: c.id, d: d.id, e: e.id })
  const ins = db.raw.prepare('INSERT INTO visits(user_id, device_id, at, kind, build, standalone, screen, device, os, browser) VALUES(?,?,?,?,?,?,?,?,?,?)')
  ins.run(a.id, 'dev-a-1', clock - day, 'open', 'b', 0, '1x1', '', '', '')
  ins.run(d.id, 'dev-d-1', clock - 40 * day, 'open', 'b', 0, '1x1', '', '', '') // 30일 밖
  db.raw.prepare('INSERT INTO user_devices(user_id, device_id, first_at, last_at, count, device, os, browser, ua, build, standalone, screen) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)').run(a.id, 'dev-a-1', clock - day, clock - day, 1, '', '', '', '', 'b', 0, '1x1')
  const r = await call('GET', '/admin/users', { token: dv.token })
  assert.equal(r.status, 200)
  const by = Object.fromEntries(r.body.items.map((u: J) => [u.name, u]))
  assert.equal(r.body.items[0].name, '비') // 접속 중이 맨 앞
  assert.equal(by['비'].online, 2)
  assert.equal(by['비'].lastAt, clock)
  assert.equal(by['씨'].online, 0)
  assert.equal(by['씨'].lastAt, clock - 5 * 60_000)
  assert.equal(by['에이'].lastAt, clock - day)
  assert.equal(by['에이'].visits30, 1)
  assert.equal(by['디'].visits30, 0)
  assert.equal(by['이'].lastAt, null)
  const order = r.body.items.map((u: J) => u.name).slice(0, 4)
  assert.deepEqual(order, ['비', '씨', '에이', '디'])
  assert.equal(r.body.items.at(-1).name === '이' || r.body.items.at(-1).lastAt === null, true)
  assert.equal(r.body.onlineUsers, 1)
  assert.equal(r.body.todayUsers, 2) // 비(접속 중)·씨(오늘 seen). 어제 접속한 에이·이틀 전 디는 아님
  assert.equal(r.body.total, 6)
  assert.ok(!('pin_hash' in by['비']) && !('salt' in by['비']))
  const p = await call('GET', '/admin/users?limit=2&offset=1', { token: dv.token })
  assert.deepEqual(p.body.items.map((u: J) => u.name), ['씨', '에이'])
  assert.equal(p.body.more, true)
  assert.ok(dayStart(clock) <= clock)
})

test('허브가 없거나 실패하면 online·onlineUsers는 null, 목록은 그대로', async () => {
  for (const s of [setup(() => null), setup(undefined, false)]) {
    const dv = await s.signup('개발자')
    s.makeDev(dv.id)
    await s.signup('가나')
    const r = await s.call('GET', '/admin/users', { token: dv.token })
    assert.equal(r.status, 200)
    assert.equal(r.body.onlineUsers, null)
    assert.equal(r.body.items.length, 2)
    assert.ok(r.body.items.every((u: J) => u.online === null))
  }
})
