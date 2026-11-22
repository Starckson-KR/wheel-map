import test from 'node:test'
import assert from 'node:assert/strict'
import { handle } from '../src/index.ts'
import { fakeD1 } from './fakeD1.ts'

const ORIGIN = 'https://starckson-kr.github.io'
let clock = Date.parse('2026-11-22T12:00:00+09:00')
const now = () => clock
type J = Record<string, any>

function setup(extra: Record<string, string> = {}) {
  const db = fakeD1()
  const env = { AI: { run: (async () => ({})) as never }, DB: db, ALLOWED_ORIGINS: ORIGIN, ...extra }
  const call = async (method: string, path: string, opts: { json?: unknown; token?: string; body?: Uint8Array; type?: string; ip?: string } = {}) => {
    const headers: Record<string, string> = { origin: ORIGIN, 'cf-connecting-ip': opts.ip ?? '9.9.9.9' }
    if (opts.token) headers.authorization = `Bearer ${opts.token}`
    let body: BodyInit | undefined
    if (opts.json !== undefined) {
      headers['content-type'] = 'application/json'
      body = JSON.stringify(opts.json)
    } else if (opts.body) {
      headers['content-type'] = opts.type ?? 'image/png'
      body = opts.body as unknown as BodyInit
    }
    const res = await handle(new Request('https://w.example' + path, { method, headers, body: method === 'GET' ? undefined : body }), env as never, { now, fetch: (async () => new Response('x', { status: 500 })) as never })
    const type = res.headers.get('content-type') ?? ''
    return { status: res.status, res, body: (type.includes('json') ? await res.json() : null) as J }
  }
  const signup = async (name: string) => {
    const r = await call('POST', '/auth/signup', { json: { name, pin: '1234' } })
    return { token: r.body.token as string, id: r.body.user.id as string }
  }
  return { db, call, signup }
}

const report = (id: string, userId: string, lat = 35.1, lng = 126.9) => ({
  id, userId, createdAt: '2026-11-15T01:00:00.000Z', lat, lng, type: '경사로', category: 'fixed', photos: [], description: 'x',
  status: 'pending', verification: { votes: 0, voterIds: [] },
  history: [{ status: 'submitted', at: '2026-11-15T01:00:00.000Z', by: userId }],
})

test('제보 좌표: 한국 범위(위도 33~39, 경도 124~132) 밖은 400', async () => {
  const { call, signup } = setup()
  const a = await signup('가나')
  assert.equal((await call('PUT', '/reports/r1', { token: a.token, json: report('r1', a.id) })).status, 200)
  assert.equal((await call('PUT', '/reports/r2', { token: a.token, json: report('r2', a.id, 40, 126.9) })).status, 400)
  assert.equal((await call('PUT', '/reports/r3', { token: a.token, json: report('r3', a.id, 35.1, 140) })).status, 400)
  assert.equal((await call('PUT', '/reports/r4', { token: a.token, json: report('r4', a.id, 0, 0) })).status, 400)
})

test('잘못된 퍼센트 부호는 500이 아니라 400', async () => {
  const { call, signup, db } = setup()
  const dev = await signup('개발자')
  db.raw.prepare("UPDATE users SET role = 'dev' WHERE id = ?").run(dev.id)
  assert.equal((await call('PUT', '/reports/%E0%A4%A', { token: dev.token, json: {} })).status, 400)
  assert.equal((await call('GET', '/photos/%', { token: dev.token })).status, 400)
  assert.equal((await call('POST', '/admin/users/%E0%A4%A/reset-pin', { token: dev.token })).status, 400)
  assert.equal((await call('DELETE', '/admin/reports/%', { token: dev.token })).status, 400)
  assert.equal((await call('GET', '/admin/users/%E0%A4%A/activity', { token: dev.token })).status, 400)
})

test('사진 응답에 nosniff', async () => {
  const { call, signup } = setup()
  const a = await signup('가나')
  const png = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 0, 0])
  assert.equal((await call('PUT', '/photos/p1', { token: a.token, body: png })).status, 200)
  const g = await call('GET', '/photos/p1', { token: a.token })
  assert.equal(g.status, 200)
  assert.equal(g.res.headers.get('x-content-type-options'), 'nosniff')
})

test('세션을 새로 만들 때 하루 지난 throttle·7일 지난 write_quota를 정리한다', async () => {
  const { call, signup, db } = setup()
  const a = await signup('가나')
  const day = 86400000
  const ins = (k: string, ws: number, lu: number) => db.raw.prepare('INSERT INTO throttle(key, fails, window_start, locked_until) VALUES(?,1,?,?)').run(k, ws, lu)
  ins('old', clock - 2 * day, 0) // 지워짐
  ins('old-locked', clock - 2 * day, clock + 60_000) // 아직 잠겨 있어 남음
  ins('fresh', clock - 1000, 0) // 남음
  const q = (d: string) => db.raw.prepare('INSERT INTO write_quota(user_id, day, n) VALUES(?,?,1)').run(a.id, d)
  q('2026-11-10') // 12일 전: 지워짐
  q('2026-11-18') // 4일 전: 남음
  const r = await call('POST', '/auth/login', { json: { name: '가나', pin: '1234' } })
  assert.equal(r.status, 200)
  const keys = (db.raw.prepare('SELECT key FROM throttle').all() as { key: string }[]).map((x) => x.key)
  assert.ok(!keys.includes('old'))
  assert.ok(keys.includes('old-locked') && keys.includes('fresh'))
  const days = (db.raw.prepare('SELECT day FROM write_quota WHERE user_id = ?').all(a.id) as { day: string }[]).map((x) => x.day)
  assert.ok(!days.includes('2026-11-10'))
  assert.ok(days.includes('2026-11-18'))
})

test('날씨 분당 한도: WEATHER_PER_MINUTE로 바꿀 수 있고, 없으면 30', async () => {
  const a = setup({ WEATHER_PER_MINUTE: '2' })
  const st = []
  for (let i = 0; i < 3; i++) st.push((await a.call('GET', '/weather')).status)
  assert.equal(st[2], 429)
  assert.notEqual(st[1], 429)
  const b = setup()
  for (let i = 0; i < 30; i++) assert.notEqual((await b.call('GET', '/weather')).status, 429)
  assert.equal((await b.call('GET', '/weather')).status, 429)
})
