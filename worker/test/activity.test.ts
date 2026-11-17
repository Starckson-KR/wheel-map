import test from 'node:test'
import assert from 'node:assert/strict'
import { handle } from '../src/index.ts'
import { parseUa } from '../src/ua.ts'
import { MAX_DEVICES, MAX_ERRORS_PER_DAY, MAX_VISITS } from '../src/activity.ts'
import { fakeD1 } from './fakeD1.ts'

const ORIGIN = 'https://starckson-kr.github.io'
const DAY = 24 * 60 * 60 * 1000
let clock = 1_700_000_000_000
const now = () => clock
type J = Record<string, any>

const PHONE_UA = 'Mozilla/5.0 (Linux; Android 14; SM-S918N) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36'
const DEV_A = 'dtestdevice0001'
const DEV_B = 'dtestdevice0002'

// 가짜 허브: /count 요청에 사용자별 연결 수를 돌려준다.
function setup(opts: { hub?: boolean } = {}) {
  const db = fakeD1()
  const online: Record<string, number> = {}
  const hub = {
    idFromName: (n: string) => n,
    get: () => ({
      fetch: async (input: string | Request) => {
        const url = new URL(typeof input === 'string' ? input : input.url)
        if (url.pathname === '/count') return new Response(String(online[url.searchParams.get('user') ?? ''] ?? 0))
        return new Response('1')
      },
    }),
  }
  const env = { AI: { run: (async () => ({})) as never }, DB: db, ALLOWED_ORIGINS: ORIGIN, ...(opts.hub === false ? {} : { HUB: hub }) }
  const call = async (method: string, path: string, o: { json?: unknown; token?: string; ua?: string; ip?: string } = {}) => {
    const headers: Record<string, string> = { origin: ORIGIN, 'cf-connecting-ip': o.ip ?? '203.0.113.77', 'user-agent': o.ua ?? PHONE_UA }
    if (o.token) headers.authorization = `Bearer ${o.token}`
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
    const r = await call('POST', '/auth/signup', { json: { name, pin: '1234' }, ip: `10.0.0.${Math.floor(Math.random() * 200)}` })
    assert.equal(r.status, 200, JSON.stringify(r.body))
    return { token: r.body.token as string, id: r.body.user.id as string }
  }
  const makeDev = (id: string) => db.raw.prepare("UPDATE users SET role = 'dev' WHERE id = ?").run(id)
  const visit = (token: string, extra: Record<string, unknown> = {}, ua?: string) =>
    call('POST', '/activity/visit', { token, ua, json: { deviceId: DEV_A, build: 'abc1234', standalone: true, screen: { w: 390, h: 844 }, kind: 'open', ...extra } })
  const err = (token: string, extra: Record<string, unknown> = {}) =>
    call('POST', '/activity/error', { token, json: { deviceId: DEV_A, build: 'abc1234', message: '앗 오류', stack: 'Error: x\n at a (https://x/a.js:1:2)', route: '/map', ...extra } })
  const n = (table: string) => (db.raw.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as J).n as number
  return { db, call, signup, makeDev, visit, err, n, online }
}

test('UA 판별: 폰 종류·OS·브라우저', () => {
  assert.deepEqual(parseUa(PHONE_UA), { device: 'SM-S918N', os: 'Android 14', browser: 'Chrome 130' })
  assert.deepEqual(parseUa('Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1'), { device: 'iPhone', os: 'iOS 17', browser: 'Safari 17' })
  assert.equal(parseUa('Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 KAKAOTALK 11.2.0').browser, '카카오톡 앱 브라우저')
  assert.equal(parseUa('Mozilla/5.0 (Linux; Android 13; SAMSUNG SM-A546N) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/24.0 Chrome/117.0.0.0 Mobile Safari/537.36').browser, '삼성 인터넷 24')
  assert.equal(parseUa('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36 Edg/130.0.0.0').browser, 'Edge 130')
  assert.deepEqual(parseUa('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/130.0.0.0 Safari/537.36'), { device: 'Windows PC', os: 'Windows', browser: 'Chrome 130' })
  assert.equal(parseUa('Mozilla/5.0 (Linux; Android 14; K) AppleWebKit/537.36 Chrome/130.0.0.0 Mobile Safari/537.36').device, 'Android 폰')
  assert.deepEqual(parseUa(''), { device: '알 수 없음', os: '알 수 없음', browser: '알 수 없음' })
})

test('기록 보내기는 로그인이 필요하고 POST만 받는다', async () => {
  const { call, signup } = setup()
  assert.equal((await call('POST', '/activity/visit', { json: { deviceId: DEV_A, build: 'x1' } })).status, 401)
  assert.equal((await call('POST', '/activity/error', { json: { deviceId: DEV_A, build: 'x1', message: 'm' } })).status, 401)
  assert.equal((await call('POST', '/activity/visit', { token: 'f'.repeat(64), json: { deviceId: DEV_A, build: 'x1' } })).status, 401)
  const a = await signup('일반이')
  assert.equal((await call('GET', '/activity/error', { token: a.token })).status, 405)
})

test('접속 기록: 저장되고(UA 판별 포함) 같은 기기 10분 안 중복은 무시, 10분 뒤엔 기록', async () => {
  const { call, signup, visit, n, db } = setup()
  const a = await signup('일반이')
  assert.equal((await call('GET', '/activity/visit', { token: a.token })).status, 405)
  assert.equal((await visit(a.token, { kind: 'login' })).body.skipped, undefined)
  assert.equal(n('visits'), 1)
  const row = db.raw.prepare('SELECT * FROM visits').get() as J
  assert.equal(row.device, 'SM-S918N')
  assert.equal(row.os, 'Android 14')
  assert.equal(row.browser, 'Chrome 130')
  assert.equal(row.kind, 'login')
  assert.equal(row.standalone, 1)
  assert.equal(row.screen, '390x844')
  clock += 9 * 60_000
  assert.equal((await visit(a.token)).body.skipped, true)
  assert.equal(n('visits'), 1)
  // 다른 기기는 별개
  assert.equal((await visit(a.token, { deviceId: DEV_B })).body.skipped, undefined)
  assert.equal(n('visits'), 2)
  clock += 2 * 60_000 // 처음 기록에서 11분
  assert.equal((await visit(a.token)).body.skipped, undefined)
  assert.equal(n('visits'), 3)
  const dev = db.raw.prepare('SELECT * FROM user_devices WHERE device_id = ?').get(DEV_A) as J
  assert.equal(dev.count, 2)
  assert.ok(dev.last_at > dev.first_at)
})

test('접속 기록: 잘못된 입력은 400, UA 원문은 300자까지, 종류 모르면 open', async () => {
  const { call, signup, visit, db } = setup()
  const a = await signup('일반이')
  assert.equal((await call('POST', '/activity/visit', { token: a.token, json: { deviceId: '짧음', build: 'x1' } })).status, 400)
  assert.equal((await call('POST', '/activity/visit', { token: a.token, json: { deviceId: DEV_A, build: '<script>' } })).status, 400)
  assert.equal((await visit(a.token, { kind: 'hack' }, PHONE_UA + ' ' + 'z'.repeat(500))).status, 200)
  const dev = db.raw.prepare('SELECT ua FROM user_devices').get() as J
  assert.equal([...dev.ua].length, 300)
  assert.equal((db.raw.prepare('SELECT kind FROM visits').get() as J).kind, 'open')
})

test('IP는 어디에도 저장되지 않는다', async () => {
  const { db, signup, visit, err } = setup()
  const a = await signup('일반이')
  await visit(a.token)
  await err(a.token)
  const ip = '203.0.113.77'
  for (const t of ['visits', 'user_devices', 'client_errors']) {
    const all = JSON.stringify(db.raw.prepare(`SELECT * FROM ${t}`).all())
    assert.ok(!all.includes(ip), t)
  }
  const cols = (t: string) => (db.raw.prepare(`PRAGMA table_info(${t})`).all() as J[]).map((c) => String(c.name).toLowerCase())
  for (const t of ['visits', 'user_devices', 'client_errors']) assert.ok(!cols(t).some((c) => c.includes('ip')), t)
})

test('접속 기록: 30일 지난 것은 지우고, 사용자당 200건·기기 20대까지만', async () => {
  const { db, signup, visit, n } = setup()
  const a = await signup('일반이')
  db.raw.prepare("INSERT INTO visits(user_id, device_id, at, kind, build, standalone, screen, device, os, browser) VALUES('u_old','dold00001',?,'open','b',0,'1x1','d','o','b')").run(clock - 31 * DAY)
  await visit(a.token)
  assert.equal(n('visits'), 1) // 31일 전 기록(다른 사용자 것도)은 정리됨
  // 200건 상한
  const ins = db.raw.prepare("INSERT INTO visits(user_id, device_id, at, kind, build, standalone, screen, device, os, browser) VALUES(?,?,?,'open','b',0,'1x1','d','o','b')")
  for (let i = 0; i < 250; i++) ins.run(a.id, DEV_A, clock - 1000 - i)
  clock += 11 * 60_000
  await visit(a.token)
  assert.equal((db.raw.prepare('SELECT COUNT(*) AS n FROM visits WHERE user_id = ?').get(a.id) as J).n, MAX_VISITS)
  assert.equal((db.raw.prepare('SELECT MAX(at) AS m FROM visits WHERE user_id = ?').get(a.id) as J).m, clock) // 가장 최근 것은 남는다
  // 기기 20대 상한
  for (let i = 0; i < 25; i++) {
    clock += 1000
    await visit(a.token, { deviceId: `dmany${String(i).padStart(6, '0')}` })
  }
  assert.equal((db.raw.prepare('SELECT COUNT(*) AS n FROM user_devices WHERE user_id = ?').get(a.id) as J).n, MAX_DEVICES)
})

test('오류 기록: 저장·잘라내기·경로의 쿼리 제거', async () => {
  const { db, signup, err, n } = setup()
  const a = await signup('일반이')
  const r = await err(a.token, { message: 'm'.repeat(500), stack: 's'.repeat(5000), route: '/map?report=r-1&x=이름#frag' })
  assert.equal(r.status, 200)
  const row = db.raw.prepare('SELECT * FROM client_errors').get() as J
  assert.equal([...row.message].length, 300)
  assert.equal([...row.stack].length, 2000)
  assert.equal(row.route, '/map')
  assert.equal(row.user_id, a.id)
  assert.equal((await err(a.token, { message: '' })).status, 400)
  assert.equal(n('client_errors'), 1)
})

test('오류 기록: 같은 메시지+빌드는 기기당 하루 한 번, 빌드나 기기가 다르면 따로, 다음 날엔 다시', async () => {
  const { signup, err, n } = setup()
  const a = await signup('일반이')
  await err(a.token)
  assert.equal((await err(a.token)).body.skipped, true)
  assert.equal(n('client_errors'), 1)
  await err(a.token, { build: 'def5678' })
  await err(a.token, { deviceId: DEV_B })
  await err(a.token, { message: '다른 오류' })
  assert.equal(n('client_errors'), 4)
  clock += DAY
  assert.equal((await err(a.token)).body.skipped, undefined)
  assert.equal(n('client_errors'), 5)
})

test('오류 기록: 사용자당 하루 20건 상한, 쓰기 한도(DAILY_WRITE_LIMIT)와 따로 센다', async () => {
  const { db, signup, err, n } = setup()
  const a = await signup('일반이')
  for (let i = 0; i < MAX_ERRORS_PER_DAY + 5; i++) await err(a.token, { message: `오류 ${i}` })
  assert.equal(n('client_errors'), MAX_ERRORS_PER_DAY)
  assert.equal(n('write_quota'), 0) // 쓰기 한도 표를 건드리지 않는다
  const b = await signup('다른이')
  await err(b.token)
  assert.equal(n('client_errors'), MAX_ERRORS_PER_DAY + 1) // 다른 사용자는 영향 없음
  void db
})

test('오류 기록: 30일 지난 것은 지운다', async () => {
  const { db, signup, err, n } = setup()
  const a = await signup('일반이')
  db.raw.prepare("INSERT INTO client_errors(user_id, device_id, at, build, key, message, stack, route) VALUES('u_x','dxxxxxxxx1',?,'b','k','old','', '/')").run(clock - 31 * DAY)
  await err(a.token)
  assert.equal(n('client_errors'), 1)
})

test('관리자 조회: 개발자만, 기기·접속·오류와 접속 중 수', async () => {
  const { call, signup, makeDev, visit, err, online } = setup()
  const u = await signup('일반이')
  const d = await signup('개발이')
  makeDev(d.id)
  await visit(u.token, { kind: 'login' })
  clock += 11 * 60_000
  await visit(u.token, { deviceId: DEV_B, build: 'old0001', standalone: false, kind: 'open' }, 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1')
  await err(u.token)
  online[u.id] = 2

  const path = `/admin/users/${u.id}/activity`
  assert.equal((await call('GET', path)).status, 401)
  assert.equal((await call('GET', path, { token: u.token })).status, 403) // 일반 계정은 자기 것도 못 본다
  const r = await call('GET', path, { token: d.token })
  assert.equal(r.status, 200)
  assert.equal(r.body.name, '일반이')
  assert.equal(r.body.online, 2)
  assert.equal(r.body.devices.length, 2)
  assert.equal(r.body.devices[0].deviceId, DEV_B) // 마지막 접속이 최근인 순
  assert.equal(r.body.devices[0].device, 'iPhone')
  assert.equal(r.body.devices[0].standalone, false)
  assert.equal(r.body.devices[1].standalone, true)
  assert.equal(r.body.devices[1].count, 1)
  assert.equal(r.body.visits.length, 2)
  assert.equal(r.body.visits[0].deviceId, DEV_B)
  assert.equal(r.body.errors.length, 1)
  assert.equal(r.body.errors[0].message, '앗 오류')
  assert.equal(r.body.errors[0].os, 'Android 14') // 기기 표에서 합쳐 온다
  assert.equal(JSON.stringify(r.body).includes('203.0.113.77'), false)

  online[u.id] = 0
  assert.equal((await call('GET', path, { token: d.token })).body.online, 0)
  assert.equal((await call('GET', '/admin/users/u_nobody/activity', { token: d.token })).status, 404)
  assert.equal((await call('POST', path, { token: d.token })).status, 405)
})

test('관리자 조회: 최근 50건까지만, 허브가 없으면 접속 중은 알 수 없음(null)', async () => {
  const { call, signup, makeDev, db } = setup({ hub: false })
  const u = await signup('일반이')
  const d = await signup('개발이')
  makeDev(d.id)
  const ins = db.raw.prepare("INSERT INTO visits(user_id, device_id, at, kind, build, standalone, screen, device, os, browser) VALUES(?,?,?,'open','b',0,'1x1','d','o','b')")
  for (let i = 0; i < 80; i++) ins.run(u.id, DEV_A, clock - i * 1000)
  const e = db.raw.prepare("INSERT INTO client_errors(user_id, device_id, at, build, key, message, stack, route) VALUES(?,?,?,'b',?,'m','','/')")
  for (let i = 0; i < 60; i++) e.run(u.id, DEV_A, clock - i * 1000, `k${i}`)
  const r = await call('GET', `/admin/users/${u.id}/activity`, { token: d.token })
  assert.equal(r.body.visits.length, 50)
  assert.equal(r.body.errors.length, 50)
  assert.equal(r.body.online, null)
  assert.equal(r.body.visits[0].at, clock)
})

test('계정을 지우면 그 계정의 접속·기기·오류 기록도 지워진다', async () => {
  const { call, signup, makeDev, visit, err, n } = setup()
  const u = await signup('일반이')
  const d = await signup('개발이')
  makeDev(d.id)
  await visit(u.token)
  await err(u.token)
  assert.equal((await call('DELETE', `/admin/users/${u.id}`, { token: d.token })).status, 200)
  assert.equal(n('visits') + n('user_devices') + n('client_errors'), 0)
})
