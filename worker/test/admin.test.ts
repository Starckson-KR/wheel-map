import test from 'node:test'
import assert from 'node:assert/strict'
import { handle } from '../src/index.ts'
import { createRateLimiter } from '../src/intents.ts'
import { fakeD1 } from './fakeD1.ts'

const ORIGIN = 'https://starckson-kr.github.io'
const clock = 1_700_000_000_000
const now = () => clock
type J = Record<string, any>

function setup(extra: Record<string, string> = {}) {
  const db = fakeD1()
  const env = { AI: { run: (async () => ({ response: '{"intent":"bus","slots":{},"confidence":0.9}' })) as never }, DB: db, ALLOWED_ORIGINS: `${ORIGIN},http://localhost:5173`, ...extra }
  const call = async (method: string, path: string, opts: { json?: unknown; token?: string; origin?: string | null; ip?: string; raw?: Uint8Array; deps?: Record<string, unknown> } = {}) => {
    const headers: Record<string, string> = { 'cf-connecting-ip': opts.ip ?? '9.9.9.9' }
    if (opts.origin !== null) headers.origin = opts.origin ?? ORIGIN
    if (opts.token) headers.authorization = `Bearer ${opts.token}`
    let body: BodyInit | undefined
    if (opts.json !== undefined) {
      headers['content-type'] = 'application/json'
      body = JSON.stringify(opts.json)
    } else if (opts.raw) {
      headers['content-type'] = 'image/jpeg'
      body = opts.raw as never
    }
    const res = await handle(new Request('https://w.example' + path, { method, headers, body: method === 'GET' ? undefined : body }), env as never, { now, ...opts.deps })
    const type = res.headers.get('content-type') ?? ''
    return { status: res.status, body: (type.includes('json') ? await res.json() : null) as J }
  }
  const signup = async (name: string) => {
    const r = await call('POST', '/auth/signup', { json: { name, pin: '1234' } })
    assert.equal(r.status, 200, JSON.stringify(r.body))
    return { token: r.body.token as string, id: r.body.user.id as string }
  }
  const makeDev = (id: string) => db.raw.prepare("UPDATE users SET role = 'dev' WHERE id = ?").run(id)
  return { db, call, signup, makeDev }
}

const report = (id: string, userId: string, photos: string[] = []) => ({
  id, userId, createdAt: '2026-11-15T01:00:00.000Z', lat: 35.1, lng: 126.9, type: '경사로', category: 'fixed', photos, description: '경사로가 너무 가팔라요',
  status: 'pending', verification: { votes: 0, voterIds: [] },
  history: [{ status: 'submitted', at: '2026-11-15T01:00:00.000Z', by: userId }, { status: 'pending', at: '2026-11-15T01:00:00.000Z', by: userId, memo: '검증 대기' }],
})
const JPG = new Uint8Array([0xff, 0xd8, 0xff, 0xd9])
const count = (db: ReturnType<typeof fakeD1>, table: string) => (db.raw.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as J).n as number

test('역할은 기본이 user이고 /auth/me·로그인 응답에 role이 들어간다', async () => {
  const { call, signup, makeDev } = setup()
  const a = await signup('일반이')
  assert.equal((await call('GET', '/auth/me', { token: a.token })).body.user.role, 'user')
  makeDev(a.id)
  assert.equal((await call('GET', '/auth/me', { token: a.token })).body.user.role, 'dev')
  const login = await call('POST', '/auth/login', { json: { name: '일반이', pin: '1234' } })
  assert.equal(login.body.user.role, 'dev')
})

test('일반 계정·로그인 없음은 관리 API에 접근할 수 없다(403·401), 출처 검사도 유지', async () => {
  const { call, signup } = setup()
  const a = await signup('일반이')
  for (const [m, p] of [['GET', '/admin/summary'], ['GET', '/admin/users'], ['GET', '/admin/reports'], ['DELETE', '/admin/reports/x'], ['DELETE', '/admin/users/u_x']]) {
    const r = await call(m, p, { token: a.token })
    assert.equal(r.status, 403, `${m} ${p}`)
    assert.equal(r.body.code, 'forbidden')
    assert.equal((await call(m, p)).status, 401)
    assert.equal((await call(m, p, { token: a.token, origin: 'https://evil.example' })).status, 403)
    assert.equal((await call(m, p, { token: a.token, origin: null })).status, 403)
  }
})

test('일반 계정은 지우기 요청을 해도 아무것도 지워지지 않는다', async () => {
  const { db, call, signup } = setup()
  const a = await signup('일반이')
  const b = await signup('다른이')
  await call('PUT', '/reports/r-1', { token: b.token, json: report('r-1', b.id) })
  assert.equal((await call('DELETE', '/admin/reports/r-1', { token: a.token })).status, 403)
  assert.equal((await call('DELETE', `/admin/users/${b.id}`, { token: a.token })).status, 403)
  assert.equal(count(db, 'reports'), 1)
  assert.equal(count(db, 'users'), 2)
})

test('관리 현황·계정·신고 목록(페이지 나눔)', async () => {
  const { call, signup, makeDev } = setup()
  const dev = await signup('개발자')
  makeDev(dev.id)
  const a = await signup('가나다')
  await call('PUT', '/photos/p-1', { token: a.token, raw: JPG })
  await call('PUT', '/reports/r-1', { token: a.token, json: report('r-1', a.id, ['p-1']) })
  await call('PUT', '/reports/r-2', { token: a.token, json: report('r-2', a.id) })
  const sum = await call('GET', '/admin/summary', { token: dev.token })
  assert.deepEqual(sum.body, { ok: true, users: 2, sessions: 2, reports: 2, photos: 1 })

  const users = await call('GET', '/admin/users', { token: dev.token })
  assert.equal(users.body.total, 2)
  const row = users.body.items.find((u: J) => u.id === a.id)
  assert.equal(row.name, '가나다')
  assert.equal(row.reportCount, 2)
  assert.ok(!('pin_hash' in row) && !('salt' in row))
  const p1 = await call('GET', '/admin/users?limit=1', { token: dev.token })
  assert.equal(p1.body.items.length, 1)
  assert.equal(p1.body.more, true)
  const p2 = await call('GET', '/admin/users?limit=1&offset=1', { token: dev.token })
  assert.equal(p2.body.items.length, 1)
  assert.equal(p2.body.more, false)
  assert.notEqual(p1.body.items[0].id, p2.body.items[0].id)

  const reps = await call('GET', '/admin/reports', { token: dev.token })
  assert.equal(reps.body.total, 2)
  const r1 = reps.body.items.find((r: J) => r.id === 'r-1')
  assert.equal(r1.authorName, '가나다')
  assert.equal(r1.type, '경사로')
  assert.equal(r1.hasPhoto, true)
  assert.equal(r1.text, '경사로가 너무 가팔라요')
  assert.equal(reps.body.items.find((r: J) => r.id === 'r-2').hasPhoto, false)
})

test('신고 지우기: 사진도 함께 지워지고 다른 신고·사진은 그대로', async () => {
  const { db, call, signup, makeDev } = setup()
  const dev = await signup('개발자')
  makeDev(dev.id)
  const a = await signup('가나다')
  await call('PUT', '/photos/p-1', { token: a.token, raw: JPG })
  await call('PUT', '/photos/p-2', { token: a.token, raw: JPG })
  await call('PUT', '/reports/r-1', { token: a.token, json: report('r-1', a.id, ['p-1']) })
  await call('PUT', '/reports/r-2', { token: a.token, json: report('r-2', a.id, ['p-2']) })
  assert.equal((await call('DELETE', '/admin/reports/r-1', { token: dev.token })).status, 200)
  assert.equal(count(db, 'reports'), 1)
  assert.deepEqual((db.raw.prepare('SELECT id FROM photos').all() as J[]).map((p) => p.id), ['p-2'])
  assert.equal((await call('DELETE', '/admin/reports/r-1', { token: dev.token })).status, 404)
})

test('계정 지우기: 세션·설정·쓰기 횟수·신고·사진이 함께 지워지고 다른 계정은 그대로', async () => {
  const { db, call, signup, makeDev } = setup()
  const dev = await signup('개발자')
  makeDev(dev.id)
  const a = await signup('가나다')
  const b = await signup('라마바')
  await call('PUT', '/photos/p-1', { token: a.token, raw: JPG })
  await call('PUT', '/photos/loose', { token: a.token, raw: JPG }) // 신고에 붙지 않은 사진도 계정 것이면 지운다
  await call('PUT', '/reports/r-1', { token: a.token, json: report('r-1', a.id, ['p-1']) })
  await call('PUT', '/prefs', { token: a.token, json: { data: { 'wheelmap.theme': 'dark' } } })
  await call('PUT', '/reports/r-b', { token: b.token, json: report('r-b', b.id) })
  const del = await call('DELETE', `/admin/users/${a.id}`, { token: dev.token })
  assert.equal(del.status, 200)
  for (const [table, col] of [['sessions', 'user_id'], ['prefs', 'user_id'], ['write_quota', 'user_id'], ['users', 'id'], ['photos', 'owner_id'], ['reports', 'author_id']]) {
    assert.equal((db.raw.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE ${col} = ?`).get(a.id) as J).n, 0, table)
  }
  assert.equal(count(db, 'photos'), 0)
  assert.equal(count(db, 'reports'), 1) // b의 신고
  assert.equal((await call('GET', '/auth/me', { token: a.token })).status, 401) // 지워진 계정의 토큰은 더 이상 통하지 않는다
  assert.equal((await call('GET', '/auth/me', { token: b.token })).status, 200)
  assert.equal((await call('DELETE', `/admin/users/${a.id}`, { token: dev.token })).status, 404)
})

test('자기 자신 계정은 지울 수 없다', async () => {
  const { db, call, signup, makeDev } = setup()
  const dev = await signup('개발자')
  makeDev(dev.id)
  const r = await call('DELETE', `/admin/users/${dev.id}`, { token: dev.token })
  assert.equal(r.status, 400)
  assert.equal(r.body.code, 'self_delete')
  assert.equal(count(db, 'users'), 1)
  assert.equal((await call('GET', '/auth/me', { token: dev.token })).status, 200)
})

test('개발자는 쓰기 횟수 제한을 받지 않고 일반 계정은 그대로 받는다', async () => {
  const { call, signup, makeDev } = setup({ DAILY_WRITE_LIMIT: '2' })
  const dev = await signup('개발자')
  makeDev(dev.id)
  const a = await signup('일반이')
  for (let i = 0; i < 5; i++) assert.equal((await call('PUT', `/reports/d-${i}`, { token: dev.token, json: report(`d-${i}`, dev.id) })).status, 200)
  assert.equal((await call('PUT', '/prefs', { token: dev.token, json: { data: { 'wheelmap.theme': 'dark' } } })).status, 200)
  assert.equal((await call('PUT', '/photos/dp', { token: dev.token, raw: JPG })).status, 200)
  for (let i = 0; i < 2; i++) assert.equal((await call('PUT', `/reports/a-${i}`, { token: a.token, json: report(`a-${i}`, a.id) })).status, 200)
  assert.equal((await call('PUT', '/reports/a-9', { token: a.token, json: report('a-9', a.id) })).status, 429)
})

test('AI 검색: 개발자 토큰이 있으면 분당·하루 제한을 건너뛴다', async () => {
  const { call, signup, makeDev } = setup()
  const dev = await signup('개발자')
  makeDev(dev.id)
  const d = { limiter: createRateLimiter(1, 1), now }
  for (let i = 0; i < 4; i++) assert.equal((await call('POST', '/intent', { token: dev.token, json: { question: '가까운 저상버스' }, deps: d })).status, 200)
  // 같은 한도에서 일반 계정 토큰은 막힌다
  const a = await signup('일반이')
  const d2 = { limiter: createRateLimiter(1, 500), now }
  assert.equal((await call('POST', '/intent', { token: a.token, json: { question: '가까운 저상버스' }, deps: d2 })).status, 200)
  assert.equal((await call('POST', '/intent', { token: a.token, json: { question: '가까운 저상버스' }, deps: d2 })).status, 429)
})

test('AI 검색: 로그인하지 않은 요청과 틀린 토큰은 지금처럼 제한을 받는다', async () => {
  const { call } = setup()
  const d = { limiter: createRateLimiter(2, 500), now }
  const q = { question: '가까운 저상버스' }
  assert.equal((await call('POST', '/intent', { json: q, deps: d })).status, 200)
  assert.equal((await call('POST', '/intent', { json: q, deps: d })).status, 200)
  const over = await call('POST', '/intent', { json: q, deps: d })
  assert.equal(over.status, 429)
  assert.equal(over.body.reason, 'rate_limited')
  const bad = await call('POST', '/intent', { token: 'a'.repeat(64), json: q, deps: d })
  assert.equal(bad.status, 429) // 가짜 토큰은 면제를 받지 못한다
  const d2 = { limiter: createRateLimiter(10, 1), now }
  assert.equal((await call('POST', '/intent', { json: q, deps: d2 })).status, 200)
  assert.equal((await call('POST', '/intent', { json: q, deps: d2 })).body.reason, 'daily_limit')
})

test('로그인 시도 제한(throttle)은 개발자 계정에도 그대로 적용된다', async () => {
  const { call, signup, makeDev } = setup()
  const dev = await signup('개발자')
  makeDev(dev.id)
  for (let i = 0; i < 4; i++) assert.equal((await call('POST', '/auth/login', { json: { name: '개발자', pin: '0000' } })).status, 401)
  assert.equal((await call('POST', '/auth/login', { json: { name: '개발자', pin: '0000' } })).status, 429)
})

test('지운 제보는 삭제 표시로 남아 변경분 받기(since)에 id로 내려오고, 지운 뒤의 받기에는 다시 나오지 않는다', async () => {
  const { call, signup, makeDev, db } = setup()
  const a = await signup('작성자')
  const dev = await signup('관리자')
  makeDev(dev.id)
  await call('PUT', '/reports/r-1', { token: a.token, json: report('r-1', a.id) })
  await call('PUT', '/reports/r-2', { token: a.token, json: report('r-2', a.id) })
  const before = await call('GET', '/reports?since=0', { token: a.token })
  assert.deepEqual(before.body.deleted, [])
  const cursor = before.body.serverTime as number
  const later = clock + 5000
  assert.equal((await call('DELETE', '/admin/reports/r-1', { token: dev.token, deps: { now: () => later } })).status, 200)
  assert.equal(count(db, 'report_deletions'), 1)
  const after = await call('GET', `/reports?since=${cursor}`, { token: a.token })
  assert.deepEqual(after.body.deleted, ['r-1'])
  assert.equal(after.body.reports.length, 0)
  const full = await call('GET', '/reports?since=0', { token: dev.token })
  assert.deepEqual(full.body.reports.map((r: J) => r.id), ['r-2'])
  assert.deepEqual(full.body.deleted, ['r-1']) // 처음부터 받는 기기에도 알려 준다(이미 없으면 무해)
  assert.deepEqual((await call('GET', `/reports?since=${later}`, { token: a.token })).body.deleted, []) // 이미 받은 뒤에는 안 나온다
})

test('지워진 제보는 다시 올려 되살릴 수 없다(410), 다른 새 제보는 그대로 올라간다', async () => {
  const { call, signup, makeDev } = setup()
  const a = await signup('작성자')
  const dev = await signup('관리자')
  makeDev(dev.id)
  await call('PUT', '/reports/r-1', { token: a.token, json: report('r-1', a.id) })
  await call('DELETE', '/admin/reports/r-1', { token: dev.token })
  assert.equal((await call('PUT', '/reports/r-1', { token: a.token, json: report('r-1', a.id) })).status, 410)
  assert.equal((await call('PUT', '/reports/r-3', { token: a.token, json: report('r-3', a.id) })).status, 200)
})

test('계정을 지우면 그 계정의 제보도 삭제 표시가 남고, 30일 지난 표시는 다음 삭제 때 정리된다', async () => {
  const { call, signup, makeDev, db } = setup()
  const a = await signup('작성자')
  const dev = await signup('관리자')
  makeDev(dev.id)
  await call('PUT', '/reports/r-1', { token: a.token, json: report('r-1', a.id) })
  await call('PUT', '/reports/r-2', { token: a.token, json: report('r-2', a.id) })
  await call('DELETE', `/admin/users/${a.id}`, { token: dev.token })
  assert.equal(count(db, 'report_deletions'), 2)
  db.raw.prepare('UPDATE report_deletions SET deleted_at = ?').run(clock - 31 * 24 * 60 * 60 * 1000) // 31일 전에 지워진 것으로
  await call('PUT', '/reports/r-9', { token: dev.token, json: report('r-9', dev.id) })
  await call('DELETE', '/admin/reports/r-9', { token: dev.token })
  assert.equal(count(db, 'report_deletions'), 1) // 31일 전 표시 2개는 정리, 방금 것만 남음
})

test('서버 제보 id 전체 목록(/reports?ids=1)', async () => {
  const { call, signup } = setup()
  const a = await signup('작성자')
  await call('PUT', '/reports/r-2', { token: a.token, json: report('r-2', a.id) })
  await call('PUT', '/reports/r-1', { token: a.token, json: report('r-1', a.id) })
  const r = await call('GET', '/reports?ids=1', { token: a.token })
  assert.equal(r.body.complete, true)
  assert.deepEqual(r.body.ids, ['r-1', 'r-2'])
  assert.equal((await call('GET', '/reports?ids=1')).status, 401)
})
