import test from 'node:test'
import assert from 'node:assert/strict'
import { handle } from '../src/index.ts'
import { afterFailure, hashPin, isLocked, nameKey, normalizeName, validPin } from '../src/auth.ts'
import { mergeReport } from '../src/merge.ts'
import { fakeD1 } from './fakeD1.ts'

const ORIGIN = 'https://starckson-kr.github.io'
let clock = 1_700_000_000_000
const now = () => clock
type J = Record<string, any>

function setup(extra: Record<string, string> = {}) {
  const db = fakeD1()
  const env = { AI: { run: (async () => ({})) as never }, DB: db, ALLOWED_ORIGINS: 'https://starckson-kr.github.io,http://localhost:5173', ...extra }
  const call = async (method: string, path: string, opts: { json?: unknown; token?: string; origin?: string | null; ip?: string; raw?: Uint8Array; type?: string } = {}) => {
    const headers: Record<string, string> = { 'cf-connecting-ip': opts.ip ?? '9.9.9.9' }
    if (opts.origin !== null) headers.origin = opts.origin ?? ORIGIN
    if (opts.token) headers.authorization = `Bearer ${opts.token}`
    let body: BodyInit | undefined
    if (opts.json !== undefined) {
      headers['content-type'] = 'application/json'
      body = JSON.stringify(opts.json)
    } else if (opts.raw) {
      headers['content-type'] = opts.type ?? 'image/jpeg'
      body = opts.raw as never
    }
    const res = await handle(new Request('https://w.example' + path, { method, headers, body: method === 'GET' ? undefined : body }), env as never, { now })
    const type = res.headers.get('content-type') ?? ''
    return { res, status: res.status, body: (type.includes('json') ? await res.json() : null) as J }
  }
  const signup = async (name: string, pin = '1234', ip = '9.9.9.9') => {
    const r = await call('POST', '/auth/signup', { json: { name, pin }, ip })
    assert.equal(r.status, 200, JSON.stringify(r.body))
    return { token: r.body.token as string, id: r.body.user.id as string }
  }
  return { db, env, call, signup }
}

const report = (id: string, userId: string, extra: J = {}) => ({
  id, userId, createdAt: '2026-11-15T01:00:00.000Z', lat: 35.1, lng: 126.9, type: '경사로', category: 'fixed', photos: [], description: 'x',
  status: 'pending', verification: { votes: 0, voterIds: [] },
  history: [{ status: 'submitted', at: '2026-11-15T01:00:00.000Z', by: userId }, { status: 'pending', at: '2026-11-15T01:00:00.000Z', by: userId, memo: '검증 대기' }],
  ...extra,
})

test('이름·PIN 검증과 중복 키', () => {
  assert.equal(normalizeName('  홍길동 '), '홍길동')
  assert.equal(normalizeName('Ann Lee 2'), 'Ann Lee 2')
  assert.equal(normalizeName(''), null)
  assert.equal(normalizeName('열한글자이름이길어요요요'), null)
  assert.equal(normalizeName('a<b'), null)
  assert.equal(normalizeName('😀'), null)
  assert.equal(normalizeName(12), null)
  assert.ok(validPin('0000') && validPin('1234'))
  assert.ok(!validPin('123') && !validPin('12345') && !validPin('12a4') && !validPin(1234))
  assert.equal(nameKey('Ann  LEE'), nameKey('ann lee'))
})

test('PBKDF2 해시: 같은 입력은 같고 salt가 다르면 달라지며 평문이 아니다', async () => {
  const a = await hashPin('1234', 'aa'.repeat(16))
  assert.equal(a, await hashPin('1234', 'aa'.repeat(16)))
  assert.notEqual(a, await hashPin('1234', 'bb'.repeat(16)))
  assert.notEqual(a, await hashPin('1235', 'aa'.repeat(16)))
  assert.match(a, /^[0-9a-f]{64}$/)
})

test('잠금 규칙: 5회 실패하면 10분 잠기고 창이 지나면 다시 센다', () => {
  let t = null as ReturnType<typeof afterFailure> | null
  for (let i = 0; i < 4; i++) t = afterFailure(t, 1000 + i)
  assert.ok(!isLocked(t, 2000))
  t = afterFailure(t, 2000)
  assert.ok(isLocked(t, 2001))
  assert.ok(!isLocked(t, 2000 + 10 * 60 * 1000 + 1))
  assert.equal(afterFailure(t, 2000 + 10 * 60 * 1000 + 1).fails, 1)
})

test('가입·로그인·me·로그아웃, PIN 평문은 저장되지 않는다', async () => {
  const { db, call, signup } = setup()
  const { token, id } = await signup('홍길동', '0000')
  const me = await call('GET', '/auth/me', { token })
  assert.deepEqual(me.body, { ok: true, user: { id, name: '홍길동', role: 'user' } })
  const row = db.raw.prepare('SELECT pin_hash, salt FROM users').get() as J
  assert.notEqual(row.pin_hash, '0000')
  assert.match(row.pin_hash, /^[0-9a-f]{64}$/)
  assert.ok(!JSON.stringify(db.raw.prepare('SELECT * FROM sessions').all()).includes(token)) // 토큰도 해시만
  const login = await call('POST', '/auth/login', { json: { name: ' 홍길동 ', pin: '0000' } })
  assert.equal(login.status, 200)
  assert.equal(login.body.user.id, id)
  await call('POST', '/auth/logout', { token: login.body.token })
  assert.equal((await call('GET', '/auth/me', { token: login.body.token })).status, 401)
  assert.equal((await call('GET', '/auth/me', { token })).status, 200) // 다른 세션은 유지
})

test('같은 이름은 대소문자·공백 차이를 무시하고 중복 불가, 형식 오류는 400', async () => {
  const { call, signup } = setup()
  await signup('Ann Lee')
  const dup = await call('POST', '/auth/signup', { json: { name: 'ann  lee', pin: '1111' } })
  assert.equal(dup.status, 409)
  assert.equal(dup.body.code, 'taken')
  assert.equal((await call('POST', '/auth/signup', { json: { name: '새이름', pin: '12' } })).status, 400)
  assert.equal((await call('POST', '/auth/signup', { json: { name: '<b>', pin: '1234' } })).status, 400)
  assert.equal((await call('POST', '/auth/signup', { json: { name: '새이름', pin: 1234 } })).status, 400)
})

test('로그인 실패 문구는 이름·비밀번호 어느 쪽이 틀렸는지 드러내지 않고, 5회 실패 시 10분 잠금', async () => {
  const { call, signup } = setup()
  await signup('성춘향', '4321')
  const wrongPin = await call('POST', '/auth/login', { json: { name: '성춘향', pin: '0000' } })
  const noUser = await call('POST', '/auth/login', { json: { name: '없는사람', pin: '0000' } })
  assert.equal(wrongPin.status, 401)
  assert.equal(noUser.status, 401)
  assert.equal(wrongPin.body.message, noUser.body.message)
  for (let i = 0; i < 3; i++) assert.equal((await call('POST', '/auth/login', { json: { name: '성춘향', pin: '0000' } })).status, 401)
  const fifth = await call('POST', '/auth/login', { json: { name: '성춘향', pin: '0000' } })
  assert.equal(fifth.status, 429)
  assert.equal(fifth.body.code, 'locked')
  // 맞는 PIN이어도 잠긴 동안은 막힌다
  assert.equal((await call('POST', '/auth/login', { json: { name: '성춘향', pin: '4321' } })).status, 429)
  // 다른 IP에서는 이 이름·IP 조합이 잠기지 않았다
  assert.equal((await call('POST', '/auth/login', { json: { name: '성춘향', pin: '4321' }, ip: '8.8.8.8' })).status, 200)
  clock += 10 * 60 * 1000 + 1000
  assert.equal((await call('POST', '/auth/login', { json: { name: '성춘향', pin: '4321' } })).status, 200)
})

test('CORS: 허용 출처만, Origin 없거나 다른 출처는 403, 사전 요청에 Authorization·PUT 허용', async () => {
  const { call } = setup()
  assert.equal((await call('GET', '/reports', { origin: 'https://evil.example' })).status, 403)
  assert.equal((await call('GET', '/reports', { origin: null })).status, 403)
  assert.equal((await call('POST', '/auth/login', { origin: 'https://evil.example', json: { name: 'a', pin: '1234' } })).status, 403)
  const pre = await call('OPTIONS', '/reports/r-1', { origin: 'http://localhost:5173' })
  assert.equal(pre.status, 204)
  assert.equal(pre.res.headers.get('access-control-allow-origin'), 'http://localhost:5173')
  assert.match(pre.res.headers.get('access-control-allow-headers') ?? '', /authorization/)
  assert.match(pre.res.headers.get('access-control-allow-methods') ?? '', /PUT/)
  assert.equal((await call('OPTIONS', '/reports/r-1', { origin: 'https://evil.example' })).status, 403)
  const ok = await call('POST', '/auth/login', { json: { name: 'zz', pin: '1234' } })
  assert.equal(ok.res.headers.get('access-control-allow-origin'), ORIGIN)
})

test('로그인 없이는 설정·제보·사진에 접근할 수 없다', async () => {
  const { call } = setup()
  for (const [m, p] of [['GET', '/prefs'], ['GET', '/reports'], ['PUT', '/reports/r-1'], ['GET', '/photos/a'], ['PUT', '/prefs']]) assert.equal((await call(m, p, { json: {} })).status, 401, p)
  assert.equal((await call('GET', '/reports', { token: 'f'.repeat(64) })).status, 401)
})

test('병합: history는 항목 합집합, 투표자 합집합, 불변 필드 유지, 나머지는 새 값', () => {
  const base = report('r-1', 'u_a') as J
  const a = { ...base, description: '옛것', verification: { votes: 1, voterIds: ['u_b'] } }
  const b = {
    ...base,
    userId: '바뀌면안됨',
    description: '새것',
    verification: { votes: 1, voterIds: ['u_c'] },
    history: [...base.history, { status: 'pending', at: '2026-11-15T02:00:00.000Z', by: 'u_c', memo: 'c의 기록' }],
  }
  const m = mergeReport({ ...a, history: [...base.history, { status: 'pending', at: '2026-11-15T01:30:00.000Z', by: 'u_b', memo: 'b의 기록' }] }, b)
  assert.equal(m.userId, 'u_a')
  assert.equal(m.description, '새것')
  assert.deepEqual((m.verification as J).voterIds, ['u_b', 'u_c'])
  assert.equal((m.verification as J).votes, 2)
  assert.deepEqual((m.history as J[]).map((h) => h.memo ?? h.status), ['submitted', '검증 대기', 'b의 기록', 'c의 기록'])
  // 같은 내용을 두 번 병합해도 늘어나지 않는다(멱등)
  assert.deepEqual(mergeReport(m, m), m)
  assert.deepEqual(mergeReport(null, b), b)
})

test('제보 공유: 올리기·받기·since·다른 사람 투표 병합', async () => {
  const { call, signup } = setup()
  const a = await signup('가가가')
  const b = await signup('나나나', '2222')
  const put = await call('PUT', '/reports/r-1', { token: a.token, json: report('r-1', a.id) })
  assert.equal(put.status, 200)
  const list = await call('GET', '/reports?since=0&names=1', { token: b.token })
  assert.equal(list.body.reports.length, 1)
  assert.equal(list.body.users[a.id], '가가가')
  const cursor = list.body.serverTime
  clock += 1000
  assert.equal((await call('GET', `/reports?since=${cursor}`, { token: b.token })).body.reports.length, 0) // 변경분 없음
  // b가 확인 투표(내려받은 제보에 투표자 추가)
  const voted = { ...list.body.reports[0], verification: { votes: 1, voterIds: [b.id] } }
  assert.equal((await call('PUT', '/reports/r-1', { token: b.token, json: voted })).status, 200)
  // a는 오래된 사본(투표 없음)으로 갱신해도 b의 투표가 남는다
  clock += 1000
  const stale = { ...report('r-1', a.id), description: 'a가 고침' }
  const merged = await call('PUT', '/reports/r-1', { token: a.token, json: stale })
  assert.deepEqual(merged.body.report.verification.voterIds, [b.id])
  assert.equal(merged.body.report.description, 'a가 고침')
  const changed = await call('GET', `/reports?since=${cursor}`, { token: b.token })
  assert.equal(changed.body.reports.length, 1)
  // 남의 계정으로 새 제보를 만들 수는 없다
  assert.equal((await call('PUT', '/reports/r-2', { token: b.token, json: report('r-2', a.id) })).status, 400)
})

test('실시간 확인: 이름표는 요청할 때만, 내 설정 변경 시각(prefsAt)과 prefs ?since는 바뀐 게 없으면 내용 없이 답한다', async () => {
  const { call, signup } = setup()
  const a = await signup('가가가')
  const plain = await call('GET', '/reports?since=0', { token: a.token })
  assert.equal(plain.body.users, undefined) // D1 읽기 아끼기: 이름표 없음
  assert.equal(plain.body.prefsAt, 0)
  clock += 1000
  const put = await call('PUT', '/prefs', { token: a.token, json: { data: { 'wheelmap.textSize': 'large' } } })
  const after = await call('GET', '/reports?since=0', { token: a.token })
  assert.equal(after.body.prefsAt, put.body.updatedAt)
  const same = await call('GET', `/prefs?since=${put.body.updatedAt}`, { token: a.token })
  assert.equal(same.body.unchanged, true)
  assert.equal(same.body.data, undefined)
  const older = await call('GET', `/prefs?since=${put.body.updatedAt - 1}`, { token: a.token })
  assert.deepEqual(older.body.data, { 'wheelmap.textSize': 'large' })
})

test('두 기기가 같은 제보를 동시에 고친다: 기록·투표는 합집합, 다른 필드는 나중에 도착한 쪽이 이긴다', async () => {
  const { call, signup } = setup()
  const a = await signup('가가가')
  const b = await signup('나나나', '2222')
  await call('PUT', '/reports/r-1', { token: a.token, json: report('r-1', a.id) })
  const base = (await call('GET', '/reports?since=0', { token: a.token })).body.reports[0]
  const at = (s: number) => new Date(Date.parse('2026-11-15T02:00:00.000Z') + s * 1000).toISOString()
  // 기기1(가가가)은 설명을 고치고 기록을 하나 더하고, 기기2(나나나)는 같은 원본에서 투표하고 설명을 다르게 고친다
  const dev1 = { ...base, description: '기기1', history: [...base.history, { status: 'pending', at: at(1), by: a.id, memo: '기기1 메모' }] }
  const dev2 = { ...base, description: '기기2', verification: { votes: 1, voterIds: [b.id] }, history: [...base.history, { status: 'pending', at: at(2), by: b.id, memo: '기기2 메모' }] }
  clock += 1000
  assert.equal((await call('PUT', '/reports/r-1', { token: a.token, json: dev1 })).status, 200)
  clock += 1000
  const last = await call('PUT', '/reports/r-1', { token: b.token, json: dev2 })
  assert.equal(last.body.report.description, '기기2') // 마지막으로 쓴 쪽 승리
  assert.deepEqual(last.body.report.verification.voterIds, [b.id])
  assert.deepEqual(last.body.report.history.map((h: J) => h.memo).filter(Boolean), ['검증 대기', '기기1 메모', '기기2 메모']) // 기록은 둘 다 남는다
})

test('제보 검증: 시연 데이터 거부, 주소 id 불일치, 64KB 초과 413', async () => {
  const { call, signup } = setup()
  const a = await signup('가가가')
  assert.equal((await call('PUT', '/reports/r-d', { token: a.token, json: report('r-d', a.id, { demo: true }) })).status, 400)
  assert.equal((await call('PUT', '/reports/r-d', { token: a.token, json: report('r-d', a.id, { demoSet: 'large' }) })).status, 400)
  assert.equal((await call('PUT', '/reports/r-x', { token: a.token, json: report('r-y', a.id) })).status, 400)
  const big = await call('PUT', '/reports/r-big', { token: a.token, json: report('r-big', a.id, { description: 'x'.repeat(70 * 1024) }) })
  assert.equal(big.status, 413)
  assert.equal(big.body.code, 'too_large')
  assert.equal((await call('GET', '/reports', { token: a.token })).body.reports.length, 0)
})

test('계정당 하루 쓰기 상한, 다음 날에는 다시 쓸 수 있다', async () => {
  const { call, signup } = setup({ DAILY_WRITE_LIMIT: '3' })
  const a = await signup('가가가')
  for (let i = 0; i < 3; i++) assert.equal((await call('PUT', `/reports/r-${i}`, { token: a.token, json: report(`r-${i}`, a.id) })).status, 200)
  const over = await call('PUT', '/reports/r-9', { token: a.token, json: report('r-9', a.id) })
  assert.equal(over.status, 429)
  assert.equal(over.body.code, 'quota')
  clock += 86400000
  assert.equal((await call('PUT', '/reports/r-9', { token: a.token, json: report('r-9', a.id) })).status, 200)
})

test('사진: 올리고 받기, 400KB 초과 413, 다른 사람은 덮어쓸 수 없고, 형식 제한', async () => {
  const { call, signup } = setup()
  const a = await signup('가가가')
  const b = await signup('나나나', '2222')
  const bytes = new Uint8Array([0xff, 0xd8, 0xff, 1, 2, 3, 250, 251])
  assert.equal((await call('PUT', '/photos/r-1:0', { token: a.token, raw: bytes })).status, 200)
  const got = await call('GET', '/photos/r-1:0', { token: b.token })
  assert.equal(got.status, 200)
  assert.equal(got.res.headers.get('content-type'), 'image/jpeg')
  assert.deepEqual(new Uint8Array(await got.res.arrayBuffer()), bytes)
  assert.equal((await call('PUT', '/photos/r-1:0', { token: b.token, raw: bytes })).status, 403)
  assert.equal((await call('PUT', '/photos/big', { token: a.token, raw: new Uint8Array(401 * 1024) })).status, 413)
  assert.equal((await call('PUT', '/photos/ok', { token: a.token, raw: new Uint8Array(400 * 1024) })).status, 200)
  assert.equal((await call('PUT', '/photos/t', { token: a.token, raw: bytes, type: 'text/html' })).status, 400)
  assert.equal((await call('GET', '/photos/%EC%97%86%EC%9D%8C', { token: a.token })).status, 400)
  assert.equal((await call('GET', '/photos/none', { token: a.token })).status, 404)
})

test('개인 설정: 허용된 키만 저장되고 본인 것만 보인다', async () => {
  const { call, signup } = setup()
  const a = await signup('가가가')
  const b = await signup('나나나', '2222')
  const put = await call('PUT', '/prefs', { token: a.token, json: { data: { 'wheelmap.textSize': 'large', 'wheelmap.reports': '[]', 'wheelmap.onboarded': '1' } } })
  assert.deepEqual(put.body.data, { 'wheelmap.textSize': 'large', 'wheelmap.onboarded': '1' })
  await call('PUT', '/prefs', { token: a.token, json: { data: { 'wheelmap.textSize': null } } })
  assert.deepEqual((await call('GET', '/prefs', { token: a.token })).body.data, { 'wheelmap.onboarded': '1' })
  assert.equal((await call('GET', '/prefs', { token: b.token })).body.data, null)
  assert.equal((await call('PUT', '/prefs', { token: a.token, json: { data: 'x'.repeat(20000) } })).status, 413)
})

test('기존 AI 의도 분류 경로(POST /)는 계정 경로와 섞이지 않는다', async () => {
  const { call } = setup()
  const r = await call('POST', '/', { json: { question: '' } })
  assert.equal(r.status, 400)
  assert.equal(r.body.fallback, true)
})
