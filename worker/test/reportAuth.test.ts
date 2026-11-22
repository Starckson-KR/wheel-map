import test from 'node:test'
import assert from 'node:assert/strict'
import { handle } from '../src/index.ts'
import { neighborConfirm } from '../src/merge.ts'
import { fakeD1 } from './fakeD1.ts'

const ORIGIN = 'https://starckson-kr.github.io'
let clock = 1_700_000_000_000
const now = () => clock
type J = Record<string, any>

function setup() {
  const db = fakeD1()
  const env = { AI: { run: (async () => ({})) as never }, DB: db, ALLOWED_ORIGINS: ORIGIN }
  const call = async (method: string, path: string, opts: { json?: unknown; token?: string; ip?: string } = {}) => {
    const headers: Record<string, string> = { 'cf-connecting-ip': opts.ip ?? '9.9.9.9', origin: ORIGIN }
    if (opts.token) headers.authorization = `Bearer ${opts.token}`
    let body: BodyInit | undefined
    if (opts.json !== undefined) {
      headers['content-type'] = 'application/json'
      body = JSON.stringify(opts.json)
    }
    const res = await handle(new Request('https://w.example' + path, { method, headers, body: method === 'GET' ? undefined : body }), env as never, { now })
    const type = res.headers.get('content-type') ?? ''
    return { status: res.status, body: (type.includes('json') ? await res.json() : null) as J }
  }
  const signup = async (name: string, pin = '1234') => {
    const r = await call('POST', '/auth/signup', { json: { name, pin } })
    assert.equal(r.status, 200, JSON.stringify(r.body))
    return { token: r.body.token as string, id: r.body.user.id as string }
  }
  const makeDev = (id: string) => db.raw.prepare("UPDATE users SET role = 'dev' WHERE id = ?").run(id)
  return { call, signup, makeDev }
}

const T0 = '2026-11-15T01:00:00.000Z'
const report = (id: string, userId: string, extra: J = {}) => ({
  id, userId, createdAt: T0, lat: 35.1, lng: 126.9, type: '경사로', category: 'fixed', photos: [], description: '원래 설명',
  status: 'pending', verification: { votes: 0, voterIds: [] },
  history: [{ status: 'submitted', at: T0, by: userId }, { status: 'pending', at: T0, by: userId, memo: '검증 대기' }],
  ...extra,
})
const get = async (call: ReturnType<typeof setup>['call'], token: string, id: string) =>
  ((await call('GET', '/reports?since=0', { token })).body.reports as J[]).find((r) => r.id === id) as J

test('남의 제보의 설명·상태·기록은 바꿀 수 없다(서버 값이 그대로 돌아온다)', async () => {
  const { call, signup } = setup()
  const a = await signup('가가가')
  const b = await signup('나나나', '2222')
  await call('PUT', '/reports/r-1', { token: a.token, json: report('r-1', a.id) })
  clock += 1000
  const base = await get(call, b.token, 'r-1')
  const evil = { ...base, description: '바꿈', status: 'resolved', category: 'temporary', photos: ['x'], history: [...base.history, { status: 'resolved', at: '2026-11-16T00:00:00.000Z', by: b.id, memo: '가짜 조치' }] }
  const r = await call('PUT', '/reports/r-1', { token: b.token, json: evil })
  assert.equal(r.status, 200)
  assert.equal(r.body.restricted, true)
  assert.equal(r.body.report.description, '원래 설명')
  assert.equal(r.body.report.status, 'pending')
  assert.equal(r.body.report.history.length, 2)
  assert.deepEqual(await get(call, a.token, 'r-1'), base) // 저장된 값도 그대로
})

test('남의 제보에는 자기 투표 하나만 합쳐진다', async () => {
  const { call, signup } = setup()
  const a = await signup('가가가')
  const b = await signup('나나나', '2222')
  await call('PUT', '/reports/r-1', { token: a.token, json: report('r-1', a.id) })
  clock += 1000
  const base = await get(call, b.token, 'r-1')
  const r = await call('PUT', '/reports/r-1', { token: b.token, json: { ...base, description: '몰래', verification: { votes: 1, voterIds: [b.id] } } })
  assert.deepEqual(r.body.report.verification, { votes: 1, voterIds: [b.id] })
  assert.equal(r.body.report.description, '원래 설명')
  assert.equal(r.body.report.status, 'pending') // 1명 → 아직 대기
  clock += 1000
  const again = await call('PUT', '/reports/r-1', { token: b.token, json: r.body.report })
  assert.deepEqual(again.body.report.verification.voterIds, [b.id])
})

test('남의 id로 투표하거나 기존 투표자를 빼는 요청은 무시된다', async () => {
  const { call, signup } = setup()
  const a = await signup('가가가')
  const b = await signup('나나나', '2222')
  const c = await signup('다다다', '3333')
  await call('PUT', '/reports/r-1', { token: a.token, json: report('r-1', a.id) })
  clock += 1000
  const base = await get(call, b.token, 'r-1')
  const fake = await call('PUT', '/reports/r-1', { token: b.token, json: { ...base, verification: { votes: 1, voterIds: [c.id] } } })
  assert.deepEqual(fake.body.report.verification.voterIds, [])
  const self = await call('PUT', '/reports/r-1', { token: b.token, json: { ...base, verification: { votes: 1, voterIds: [a.id] } } })
  assert.deepEqual(self.body.report.verification.voterIds, [])
  clock += 1000
  await call('PUT', '/reports/r-1', { token: b.token, json: { ...base, verification: { votes: 1, voterIds: [b.id] } } })
  clock += 1000
  const cur = await get(call, c.token, 'r-1')
  const drop = await call('PUT', '/reports/r-1', { token: c.token, json: { ...cur, verification: { votes: 1, voterIds: [c.id] } } })
  assert.deepEqual(drop.body.report.verification.voterIds, [b.id, c.id])
})

test('확인 인원이 차면 서버가 규칙대로 검증 완료로 바꾼다(들어온 기록은 믿지 않는다)', async () => {
  const { call, signup } = setup()
  const a = await signup('가가가')
  const b = await signup('나나나', '2222')
  const c = await signup('다다다', '3333')
  await call('PUT', '/reports/r-1', { token: a.token, json: report('r-1', a.id) })
  clock += 1000
  const base = await get(call, b.token, 'r-1')
  await call('PUT', '/reports/r-1', { token: b.token, json: { ...base, verification: { votes: 1, voterIds: [b.id] } } })
  clock += 1000
  const cur = await get(call, c.token, 'r-1')
  const r = await call('PUT', '/reports/r-1', {
    token: c.token,
    json: { ...cur, status: 'rechecked', verification: { votes: 2, voterIds: [b.id, c.id], rating: 'O' }, history: [...cur.history, { status: 'rechecked', at: '2026-12-01T00:00:00.000Z', by: c.id }] },
  })
  const rep = r.body.report
  assert.equal(rep.status, 'verified')
  assert.equal(rep.verification.result, 'confirmed')
  assert.equal(rep.verification.rating, undefined) // 보낸 판정은 버린다
  assert.equal(rep.history.length, 3)
  const last = rep.history[2]
  assert.equal(last.status, 'verified')
  assert.equal(last.memo, '시민 확인 2명')
  assert.equal(last.at, new Date(Date.parse(T0) + 1).toISOString())
  assert.equal(last.by, [b.id, c.id].sort().at(-1))
})

test('작성자는 그대로 고칠 수 있고 개발자 계정은 남의 제보도 고칠 수 있다', async () => {
  const { call, signup, makeDev } = setup()
  const a = await signup('가가가')
  const d = await signup('개발자', '4444')
  makeDev(d.id)
  await call('PUT', '/reports/r-1', { token: a.token, json: report('r-1', a.id) })
  clock += 1000
  const base = await get(call, a.token, 'r-1')
  const mine = await call('PUT', '/reports/r-1', { token: a.token, json: { ...base, description: '작성자가 고침' } })
  assert.equal(mine.body.report.description, '작성자가 고침')
  assert.equal(mine.body.restricted, undefined)
  clock += 1000
  const dev = await call('PUT', '/reports/r-1', { token: d.token, json: { ...mine.body.report, description: '개발자가 고침', status: 'in_progress' } })
  assert.equal(dev.body.report.description, '개발자가 고침')
  assert.equal(dev.body.report.status, 'in_progress')
  assert.equal(dev.body.report.userId, a.id) // 작성자는 바뀌지 않는다
})

test('이미 검증된 제보에 대한 늦은 투표·바뀐 게 없는 요청은 저장하지 않는다', () => {
  const ex = report('r-1', 'u-a', { status: 'verified', verification: { votes: 2, voterIds: ['u-b', 'u-c'], result: 'confirmed' } })
  assert.equal(neighborConfirm(ex, { ...ex, verification: { votes: 3, voterIds: ['u-b', 'u-c', 'u-d'] } }, 'u-d'), ex)
  const pend = report('r-2', 'u-a')
  assert.equal(neighborConfirm(pend, pend, 'u-d'), pend)
})

test('장소 값 검증: 기타는 「기타: 글(30자 이하)」만, 너무 길거나 이상한 값은 400', async () => {
  const { validateReport } = await import('../src/account.ts')
  const ok = (k: unknown) => validateReport({ ...report('r-1', 'u'), locationKind: k }, 'r-1')
  assert.equal(ok('공원'), null)
  assert.equal(ok('기타: 시장 입구'), null)
  assert.equal(validateReport(report('r-1', 'u'), 'r-1'), null) // 없어도 된다
  assert.notEqual(ok('기타: '), null)
  assert.notEqual(ok('기타' + 'x'.repeat(40)), null)
  assert.notEqual(ok('기타: ' + 'ㄱ'.repeat(31)), null)
  assert.notEqual(ok('a'.repeat(61)), null)
  assert.notEqual(ok(5), null)
  assert.notEqual(ok('공원\n'), null)
})
