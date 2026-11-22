import test from 'node:test'
import assert from 'node:assert/strict'
import { handle } from '../src/index.ts'
import { RealtimeHub, broadcast, userTag } from '../src/hub.ts'
import { fakeD1 } from './fakeD1.ts'

const ORIGIN = 'https://starckson-kr.github.io'
let clock = 1_700_000_000_000
const now = () => clock
type J = Record<string, any>

// 가짜 허브: publish 요청을 모아 두고, /rt 연결 요청은 받은 헤더만 기록한다.
function fakeHub() {
  const published: { t: string; user?: string }[] = []
  const connects: Headers[] = []
  const hints: unknown[] = []
  const ns = {
    idFromName: (n: string) => n,
    get: (_id: unknown, opts?: unknown) => {
      hints.push(opts)
      return {
        fetch: async (input: string | Request, init?: RequestInit) => {
          const url = typeof input === 'string' ? input : input.url
          if (url.endsWith('/publish')) {
            published.push(JSON.parse(String(init?.body)))
            return new Response('1')
          }
          connects.push((input as Request).headers)
          return new Response('ok', { status: 200 })
        },
      }
    },
  }
  return { ns, published, connects, hints }
}

function setup(withHub = true) {
  const db = fakeD1()
  const hub = fakeHub()
  const env = { AI: { run: (async () => ({})) as never }, DB: db, ALLOWED_ORIGINS: ORIGIN, ...(withHub ? { HUB: hub.ns } : {}) }
  const call = async (method: string, path: string, opts: { json?: unknown; token?: string; origin?: string | null; ip?: string; upgrade?: boolean } = {}) => {
    const headers: Record<string, string> = { 'cf-connecting-ip': opts.ip ?? '9.9.9.9' }
    if (opts.origin !== null) headers.origin = opts.origin ?? ORIGIN
    if (opts.token) headers.authorization = `Bearer ${opts.token}`
    if (opts.upgrade) headers.upgrade = 'websocket'
    let body: BodyInit | undefined
    if (opts.json !== undefined) {
      headers['content-type'] = 'application/json'
      body = JSON.stringify(opts.json)
    }
    const res = await handle(new Request('https://w.example' + path, { method, headers, body: method === 'GET' ? undefined : body }), env as never, { now })
    const type = res.headers.get('content-type') ?? ''
    return { status: res.status, body: (type.includes('json') ? await res.json() : null) as J }
  }
  const signup = async (name: string) => {
    const r = await call('POST', '/auth/signup', { json: { name, pin: '1234' } })
    return { token: r.body.token as string, id: r.body.user.id as string }
  }
  return { db, hub, call, signup }
}

const report = (id: string, userId: string) => ({
  id, userId, createdAt: '2026-11-15T01:00:00.000Z', lat: 35.1, lng: 126.9, type: '경사로', category: 'fixed', photos: [], description: 'x',
  status: 'pending', verification: { votes: 0, voterIds: [] },
  history: [{ status: 'submitted', at: '2026-11-15T01:00:00.000Z', by: userId }],
})

test('티켓: 로그인해야 받고, 한 번만 쓰이며, 30초 뒤에는 못 쓴다', async () => {
  const { call, signup, hub } = setup()
  assert.equal((await call('POST', '/rt/ticket')).status, 401)
  const a = await signup('가나')
  const t1 = (await call('POST', '/rt/ticket', { token: a.token })).body.ticket as string
  assert.match(t1, /^[0-9a-f]{32}$/)
  const ok = await call('GET', `/rt?ticket=${t1}`, { upgrade: true })
  assert.equal(ok.status, 200)
  assert.equal(hub.connects.length, 1)
  assert.equal(hub.connects[0].get('x-rt-user'), a.id)
  assert.equal(hub.hints[0] && (hub.hints[0] as { locationHint: string }).locationHint, 'apac')
  assert.equal((await call('GET', `/rt?ticket=${t1}`, { upgrade: true })).status, 401) // 두 번째는 실패
  const t2 = (await call('POST', '/rt/ticket', { token: a.token })).body.ticket as string
  clock += 31_000
  assert.equal((await call('GET', `/rt?ticket=${t2}`, { upgrade: true })).status, 401)
  assert.equal(hub.connects.length, 1)
})

test('연결: 출처·업그레이드·티켓 형식 확인, 밖에서 준 x-rt-user 헤더는 무시', async () => {
  const { call, signup, hub } = setup()
  const a = await signup('가나')
  const t = (await call('POST', '/rt/ticket', { token: a.token })).body.ticket as string
  assert.equal((await call('GET', `/rt?ticket=${t}`, { upgrade: true, origin: 'https://evil.example' })).status, 403)
  assert.equal((await call('GET', `/rt?ticket=${t}`, { upgrade: true, origin: null })).status, 403)
  assert.equal((await call('GET', `/rt?ticket=${t}`)).status, 426) // 업그레이드 아님
  assert.equal((await call('GET', '/rt?ticket=zzz', { upgrade: true })).status, 401)
  assert.equal((await call('GET', '/rt', { upgrade: true })).status, 401)
  assert.equal(hub.connects.length, 0)
  // 티켓은 위의 실패들에서 쓰이지 않았다 → 아직 한 번 쓸 수 있다
  assert.equal((await call('GET', `/rt?ticket=${t}`, { upgrade: true })).status, 200)
})

test('티켓 발급은 IP별 분당 제한이 있다', async () => {
  const { call, signup } = setup()
  const a = await signup('가나')
  clock += 120_000
  for (let i = 0; i < 20; i++) assert.equal((await call('POST', '/rt/ticket', { token: a.token, ip: '5.5.5.5' })).status, 200)
  assert.equal((await call('POST', '/rt/ticket', { token: a.token, ip: '5.5.5.5' })).status, 429)
})

test('허브가 없으면 503, 쓰기는 알림 없이도 그대로 된다', async () => {
  const { call, signup } = setup(false)
  const a = await signup('가나')
  assert.equal((await call('POST', '/rt/ticket', { token: a.token })).status, 503)
  assert.equal((await call('PUT', '/reports/r1', { token: a.token, json: report('r1', a.id) })).status, 200)
})

test('제보 쓰기는 모두에게(reports), 설정 저장은 그 계정에만(prefs) 신호를 보낸다', async () => {
  const { call, signup, hub } = setup()
  const a = await signup('가나')
  assert.equal((await call('PUT', '/reports/r1', { token: a.token, json: report('r1', a.id) })).status, 200)
  assert.deepEqual(hub.published, [{ t: 'reports' }])
  assert.equal((await call('PUT', '/prefs', { token: a.token, json: { data: { 'wheelmap.theme': 'dark' } } })).status, 200)
  assert.deepEqual(hub.published[1], { t: 'prefs', user: a.id })
  // 거절된 쓰기는 신호가 없다
  const n = hub.published.length
  assert.equal((await call('PUT', '/reports/r2', { token: a.token, json: { id: 'r2' } })).status, 400)
  assert.equal(hub.published.length, n)
})

test('관리자 삭제도 reports 신호를 보낸다', async () => {
  const { call, signup, hub, db } = setup()
  const dev = await signup('개발자')
  db.raw.prepare("UPDATE users SET role = 'dev' WHERE id = ?").run(dev.id)
  const a = await signup('작성자')
  await call('PUT', '/reports/r1', { token: a.token, json: report('r1', a.id) })
  hub.published.length = 0
  assert.equal((await call('DELETE', '/admin/reports/r1', { token: dev.token })).status, 200)
  assert.deepEqual(hub.published, [{ t: 'reports' }])
  assert.equal((await call('DELETE', '/admin/reports/nope', { token: dev.token })).status, 404)
  assert.equal(hub.published.length, 1)
})

test('허브가 실패해도 쓰기 응답은 성공한다(알림은 최선을 다할 뿐)', async () => {
  const { call, signup, hub } = setup()
  const a = await signup('가나')
  hub.ns.get = () => ({ fetch: async () => { throw new Error('boom') } }) as never
  const logs: string[] = []
  const orig = console.log
  console.log = (...x: unknown[]) => void logs.push(x.join(' '))
  try {
    assert.equal((await call('PUT', '/reports/r1', { token: a.token, json: report('r1', a.id) })).status, 200)
  } finally {
    console.log = orig
  }
  assert.ok(logs.some((l) => l.includes('rt_publish')))
})

// ---- 허브 클래스(WebSocket 객체는 가짜) ----
function fakeWs(log: string[], name: string, fail = false) {
  return { send: (m: string) => { if (fail) throw new Error('closed'); log.push(`${name}:${m}`) }, close: () => {} }
}
function fakeCtx(sockets: Record<string, ReturnType<typeof fakeWs>[]>) {
  const all = Object.values(sockets).flat()
  return { getWebSockets: (tag?: string) => (tag ? sockets[tag] ?? [] : all), acceptWebSocket() {}, setWebSocketAutoResponse() {} }
}

test('broadcast: 태그가 없으면 모두, 있으면 그 계정 연결에만, 끊긴 연결은 건너뛴다', () => {
  const log: string[] = []
  const ctx = fakeCtx({ [userTag('a')]: [fakeWs(log, 'a1'), fakeWs(log, 'a2')], [userTag('b')]: [fakeWs(log, 'b1'), fakeWs(log, 'bx', true)] })
  assert.equal(broadcast(ctx, 'reports'), 3)
  assert.deepEqual(log, ['a1:{"t":"reports"}', 'a2:{"t":"reports"}', 'b1:{"t":"reports"}'])
  log.length = 0
  assert.equal(broadcast(ctx, 'prefs', 'a'), 2)
  assert.deepEqual(log, ['a1:{"t":"prefs"}', 'a2:{"t":"prefs"}'])
  assert.equal(broadcast(ctx, 'prefs', 'nobody'), 0)
})

test('허브 /publish: 형식 검사 후 보내고, 알 수 없는 신호는 400', async () => {
  ;(globalThis as any).WebSocketRequestResponsePair = class {
    req: string
    res: string
    constructor(req: string, res: string) {
      this.req = req
      this.res = res
    }
  }
  const log: string[] = []
  const hub = new RealtimeHub(fakeCtx({ [userTag('a')]: [fakeWs(log, 'a1')] }) as never)
  const post = (body: unknown) => hub.fetch(new Request('https://hub/publish', { method: 'POST', body: JSON.stringify(body) }))
  assert.equal((await post({ t: 'reports' })).status, 200)
  assert.equal((await post({ t: 'prefs', user: 'a' })).status, 200)
  assert.equal((await post({ t: 'evil' })).status, 400)
  assert.deepEqual(log, ['a1:{"t":"reports"}', 'a1:{"t":"prefs"}'])
  assert.equal((await hub.fetch(new Request('https://hub/rt'))).status, 404) // 업그레이드가 아니면 연결하지 않는다
  assert.equal((await hub.fetch(new Request('https://hub/rt', { headers: { upgrade: 'websocket', 'x-rt-user': 'a b' } }))).status, 400)
})

test('허브 /close: 그 사용자의 연결만 닫고, 형식이 틀리면 400, POST만 받는다', async () => {
  const closed: string[] = []
  const ws = (name: string) => ({ send() {}, close: (code?: number, reason?: string) => void closed.push(`${name}:${code}:${reason}`) })
  const hub = new RealtimeHub(fakeCtx({ [userTag('a')]: [ws('a1'), ws('a2')], [userTag('b')]: [ws('b1')] }) as never)
  const post = (q: string, method = 'POST') => hub.fetch(new Request('https://hub/close' + q, { method }))
  const r = await post('?user=a')
  assert.equal(r.status, 200)
  assert.equal(await r.text(), '2')
  assert.deepEqual(closed, ['a1:1008:gone', 'a2:1008:gone'])
  assert.equal((await post('?user=a b')).status, 400)
  assert.equal((await post('')).status, 400)
  assert.equal((await post('?user=a', 'GET')).status, 404)
  assert.equal(closed.length, 2)
})

test('바깥에서는 허브 /close에 닿지 못한다: /close는 Worker 경로가 아니고, /rt는 WebSocket 연결만 전달한다', async () => {
  const { call, signup, hub, db } = setup()
  const a = await signup('가나')
  assert.equal((await call('POST', '/close?user=' + a.id, { token: a.token })).status, 404)
  assert.equal((await call('POST', '/rt?user=' + a.id, { token: a.token })).status, 426)
  assert.equal((await call('GET', '/rt?ticket=' + 'a'.repeat(32))).status, 426) // 업그레이드 없이는 전달 안 됨
  assert.ok(!hub.connects.length)
  assert.ok(db)
})

test('계정 삭제·PIN 다시 정하기 뒤 그 사용자의 허브 연결을 닫는다(제보 삭제는 닫지 않는다)', async () => {
  const { call, signup, hub, db } = setup()
  const closes: string[] = []
  const inner = hub.ns.get
  hub.ns.get = ((id: unknown, opts?: unknown) => {
    const s = inner(id, opts)
    return {
      fetch: async (input: string | Request, init?: RequestInit) => {
        const url = typeof input === 'string' ? input : input.url
        if (url.includes('/close')) {
          closes.push(`${init?.method}:${url}`)
          return new Response('1')
        }
        return s.fetch(input, init)
      },
    }
  }) as never
  const dev = await signup('개발자')
  db.raw.prepare("UPDATE users SET role = 'dev' WHERE id = ?").run(dev.id)
  const a = await signup('작성자')
  const b = await signup('다른이')
  await call('PUT', '/reports/r1', { token: a.token, json: report('r1', a.id) })
  assert.equal((await call('DELETE', '/admin/reports/r1', { token: dev.token })).status, 200)
  assert.deepEqual(closes, [])
  assert.equal((await call('POST', `/admin/users/${a.id}/reset-pin`, { token: dev.token })).status, 200)
  assert.deepEqual(closes, [`POST:https://hub/close?user=${a.id}`])
  assert.equal((await call('DELETE', `/admin/users/${b.id}`, { token: dev.token })).status, 200)
  assert.deepEqual(closes, [`POST:https://hub/close?user=${a.id}`, `POST:https://hub/close?user=${b.id}`])
  assert.equal((await call('DELETE', '/admin/users/nope', { token: dev.token })).status, 404)
  assert.equal(closes.length, 2)
})
