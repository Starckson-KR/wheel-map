import test from 'node:test'
import assert from 'node:assert/strict'
import { handle } from '../src/index.ts'
import { fakeD1 } from './fakeD1.ts'

const ORIGIN = 'https://starckson-kr.github.io'
const now = () => 1_700_000_000_000
type J = Record<string, any>

function setup() {
  const db = fakeD1()
  const env = { AI: { run: (async () => ({})) as never }, DB: db, ALLOWED_ORIGINS: ORIGIN }
  const call = async (method: string, path: string, opts: { json?: unknown; token?: string; ip?: string } = {}) => {
    const headers: Record<string, string> = { origin: ORIGIN, 'cf-connecting-ip': opts.ip ?? '9.9.9.9' }
    if (opts.token) headers.authorization = `Bearer ${opts.token}`
    if (opts.json !== undefined) headers['content-type'] = 'application/json'
    const res = await handle(new Request('https://w.example' + path, { method, headers, body: opts.json === undefined ? undefined : JSON.stringify(opts.json) }), env as never, { now })
    return { status: res.status, body: (await res.json()) as J }
  }
  const signup = async (name: string) => {
    const r = await call('POST', '/auth/signup', { json: { name, pin: '1234' } })
    return { token: r.body.token as string, id: r.body.user.id as string }
  }
  const makeDev = (id: string) => db.raw.prepare("UPDATE users SET role = 'dev' WHERE id = ?").run(id)
  const login = (name: string, pin: string, ip = '9.9.9.9') => call('POST', '/auth/login', { json: { name, pin }, ip })
  return { db, call, signup, makeDev, login }
}

test('잠금 풀기·PIN 다시 정하기·전체 풀기: 일반 계정은 403, 로그인하지 않으면 401', async () => {
  const { call, signup, login } = setup()
  const a = await signup('일반이')
  for (const p of [`/admin/users/${a.id}/unlock`, `/admin/users/${a.id}/reset-pin`, '/admin/throttle/clear']) {
    assert.equal((await call('POST', p, { token: a.token })).status, 403, p)
    assert.equal((await call('POST', p)).status, 401, p)
  }
  assert.equal((await login('일반이', '1234')).status, 200) // PIN은 그대로
})

test('이름 기준 잠금은 계정별로 풀리고, 이름+IP 잠금은 전체 풀기로 푼다', async () => {
  const { call, signup, makeDev, login } = setup()
  const dev = await signup('개발자')
  makeDev(dev.id)
  const a = await signup('가나다')
  // 이름 하나에 IP를 바꿔 가며 30번 틀리면 이름 기준으로 잠긴다
  for (let i = 0; i < 30; i++) await login('가나다', '0000', `7.7.${i}.1`)
  assert.equal((await login('가나다', '1234', '6.6.6.6')).status, 429)
  assert.equal((await call('POST', `/admin/users/${a.id}/unlock`, { token: dev.token })).status, 200)
  assert.equal((await login('가나다', '1234', '6.6.6.6')).status, 200)

  // 같은 IP에서 5번 틀리면 이름+IP 키가 잠긴다 → 계정별 풀기로는 안 풀리고 전체 풀기로 풀린다
  for (let i = 0; i < 5; i++) await login('가나다', '0000', '5.5.5.5')
  assert.equal((await login('가나다', '1234', '5.5.5.5')).status, 429)
  await call('POST', `/admin/users/${a.id}/unlock`, { token: dev.token })
  assert.equal((await login('가나다', '1234', '5.5.5.5')).status, 429)
  assert.equal((await call('POST', '/admin/throttle/clear', { token: dev.token })).status, 200)
  assert.equal((await login('가나다', '1234', '5.5.5.5')).status, 200)
  assert.equal((await call('POST', '/admin/users/u_nobody/unlock', { token: dev.token })).status, 404)
})

test('PIN 다시 정하기: 새 PIN은 응답에만, 새 PIN으로 로그인되고 옛 PIN·옛 세션은 거부', async () => {
  const { db, call, signup, makeDev, login } = setup()
  const logs: string[] = []
  const orig = console.log
  console.log = (...a: unknown[]) => void logs.push(a.join(' '))
  try {
    const dev = await signup('개발자')
    makeDev(dev.id)
    const a = await signup('가나다')
    const old = db.raw.prepare('SELECT pin_hash, salt FROM users WHERE id = ?').get(a.id) as J
    const r = await call('POST', `/admin/users/${a.id}/reset-pin`, { token: dev.token })
    assert.equal(r.status, 200)
    assert.match(r.body.pin, /^\d{4}$/)
    assert.equal(r.body.self, false)
    const row = db.raw.prepare('SELECT pin_hash, salt FROM users WHERE id = ?').get(a.id) as J
    assert.notEqual(row.pin_hash, old.pin_hash)
    assert.notEqual(row.salt, old.salt)
    const dump = JSON.stringify(db.raw.prepare('SELECT * FROM users').all()) + JSON.stringify(db.raw.prepare('SELECT * FROM throttle').all())
    assert.ok(!dump.includes(`"${r.body.pin}"`)) // 평문 PIN은 저장되지 않는다
    assert.ok(!logs.join('\n').includes(r.body.pin)) // 로그에 새 PIN이 없다
    assert.equal((await call('GET', '/auth/me', { token: a.token })).status, 401) // 옛 세션 끊김
    assert.equal((await call('GET', '/auth/me', { token: dev.token })).status, 200) // 다른 계정 세션은 그대로
    if (r.body.pin !== '1234') assert.equal((await login('가나다', '1234')).status, 401) // 옛 PIN 거부
    assert.equal((await login('가나다', r.body.pin)).status, 200)
    assert.equal((await call('POST', '/admin/users/u_nobody/reset-pin', { token: dev.token })).status, 404)
  } finally {
    console.log = orig
  }
})

test('자기 계정 PIN 다시 정하기: self 표시, 세션이 끊기고 새 PIN으로 다시 로그인', async () => {
  const { call, signup, makeDev, login } = setup()
  const dev = await signup('개발자')
  makeDev(dev.id)
  const r = await call('POST', `/admin/users/${dev.id}/reset-pin`, { token: dev.token })
  assert.equal(r.status, 200)
  assert.equal(r.body.self, true)
  assert.equal((await call('GET', '/auth/me', { token: dev.token })).status, 401)
  const l = await login('개발자', r.body.pin)
  assert.equal(l.status, 200)
  assert.equal(l.body.user.role, 'dev')
})
