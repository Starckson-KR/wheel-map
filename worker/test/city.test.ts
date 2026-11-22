import test from 'node:test'
import assert from 'node:assert/strict'
import { handle } from '../src/index.ts'
import { cityLabel } from '../src/cityLabel.ts'
import { fakeD1 } from './fakeD1.ts'

const ORIGIN = 'https://starckson-kr.github.io'
let clock = 1_700_000_000_000
const now = () => clock
type J = Record<string, any>

function setup() {
  const db = fakeD1()
  const env = { AI: { run: (async () => ({})) as never }, DB: db, ALLOWED_ORIGINS: ORIGIN }
  let n = 0
  const call = async (method: string, path: string, o: { json?: unknown; token?: string; cf?: unknown } = {}) => {
    const headers: Record<string, string> = { origin: ORIGIN, 'cf-connecting-ip': `10.2.0.${n++ % 200}` }
    if (o.token) headers.authorization = `Bearer ${o.token}`
    let body: BodyInit | undefined
    if (o.json !== undefined) {
      headers['content-type'] = 'application/json'
      body = JSON.stringify(o.json)
    }
    const req = new Request('https://w.example' + path, { method, headers, body: method === 'GET' ? undefined : body })
    if (o.cf) Object.defineProperty(req, 'cf', { value: o.cf })
    const res = await handle(req, env as never, { now })
    const type = res.headers.get('content-type') ?? ''
    return { status: res.status, body: (type.includes('json') ? await res.json() : null) as J }
  }
  const signup = async (name: string) => {
    const r = await call('POST', '/auth/signup', { json: { name, pin: '1234' } })
    return { token: r.body.token as string, id: r.body.user.id as string }
  }
  return { db, call, signup }
}
const CF = { city: 'Gwangju', regionCode: '29', country: 'KR', asn: 1 }
const visit = (s: ReturnType<typeof setup>, token: string, extra: Record<string, unknown>, cf: unknown = CF) =>
  s.call('POST', '/activity/visit', { token, cf, json: { deviceId: 'devicecity0001', build: 'b1', screen: { w: 1, h: 1 }, ...extra } })
const rows = (s: ReturnType<typeof setup>, t: string) => s.db.raw.prepare(`SELECT city, region_code AS rc, country FROM ${t}`).all().map((r) => ({ ...r })) as J[]

test('cityLabel: 한국은 시·도 한글(도는 도시 덧붙임), 그 밖에는 city, country', () => {
  assert.equal(cityLabel('Gwangju', '29', 'KR'), '광주')
  assert.equal(cityLabel('Gwangju', 'KR-29', 'KR'), '광주')
  assert.equal(cityLabel('Suwon', '41', 'KR'), '경기 Suwon')
  assert.equal(cityLabel(null, 'KR-41', 'KR'), '경기')
  assert.equal(cityLabel('Chuncheon', '51', 'KR'), '강원 Chuncheon')
  assert.equal(cityLabel('Sejong', '50', 'KR'), '세종')
  assert.equal(cityLabel('Austin', 'TX', 'US'), 'Austin, US')
  assert.equal(cityLabel(null, null, 'JP'), 'JP')
  assert.equal(cityLabel('X', '99', 'KR'), 'X, KR')
  assert.equal(cityLabel(null, null, null), null)
  for (const [c, name] of [['11', '서울'], ['26', '부산'], ['27', '대구'], ['28', '인천'], ['30', '대전'], ['31', '울산'], ['42', '강원'], ['43', '충북'], ['44', '충남'], ['45', '전북'], ['52', '전북'], ['46', '전남'], ['47', '경북'], ['48', '경남'], ['49', '제주']]) assert.ok(cityLabel(null, c, 'KR')?.startsWith(name))
})

test('cityOk가 없으면 지역을 저장하지 않고, 있으면 저장한다(60자 제한, cf 없으면 NULL)', async () => {
  const s = setup()
  const a = await s.signup('가나')
  assert.equal((await visit(s, a.token, {})).status, 200)
  assert.deepEqual(rows(s, 'visits'), [{ city: null, rc: null, country: null }])
  clock += 11 * 60_000
  await visit(s, a.token, { cityOk: true }, { ...CF, city: 'x'.repeat(100) })
  const v = rows(s, 'visits')
  assert.equal(v[1].city.length, 60)
  assert.equal(v[1].rc, '29')
  assert.equal(rows(s, 'user_devices')[0].country, 'KR')
  clock += 11 * 60_000
  await visit(s, a.token, { cityOk: true }, null) // cf 없음
  assert.equal(rows(s, 'visits')[2].city, null)
  assert.equal(rows(s, 'user_devices')[0].country, 'KR') // 기기 값은 그대로
})

test('10분 안 중복으로 건너뛸 때도 cityOk면 기기 지역만 채운다', async () => {
  const s = setup()
  const a = await s.signup('가나')
  await visit(s, a.token, {})
  clock += 60_000
  const r = await visit(s, a.token, { cityOk: true })
  assert.equal(r.body.skipped, true)
  assert.equal(rows(s, 'visits').length, 1)
  assert.equal(rows(s, 'visits')[0].city, null)
  assert.equal(rows(s, 'user_devices')[0].city, 'Gwangju')
  const r2 = await visit(s, a.token, {}, { city: 'Seoul', regionCode: '11', country: 'KR' }) // 동의 없는 건너뜀은 건드리지 않는다
  assert.equal(r2.body.skipped, true)
  assert.equal(rows(s, 'user_devices')[0].city, 'Gwangju')
})

test('prefs로 동의를 거두면(no·null) 지역이 지워지고, yes면 그대로', async () => {
  const s = setup()
  const a = await s.signup('가나')
  await visit(s, a.token, { cityOk: true })
  assert.equal((await s.call('PUT', '/prefs', { token: a.token, json: { data: { 'wheelmap.cityConsent': 'yes' } } })).status, 200)
  assert.equal(rows(s, 'user_devices')[0].city, 'Gwangju')
  assert.equal((await s.call('PUT', '/prefs', { token: a.token, json: { data: { 'wheelmap.theme': 'dark' } } })).status, 200) // 다른 키는 영향 없음
  assert.equal(rows(s, 'visits')[0].city, 'Gwangju')
  await s.call('PUT', '/prefs', { token: a.token, json: { data: { 'wheelmap.cityConsent': 'no' } } })
  assert.deepEqual(rows(s, 'visits'), [{ city: null, rc: null, country: null }])
  assert.deepEqual(rows(s, 'user_devices'), [{ city: null, rc: null, country: null }])
  clock += 11 * 60_000
  await visit(s, a.token, { cityOk: true })
  await s.call('PUT', '/prefs', { token: a.token, json: { data: { 'wheelmap.cityConsent': null } } })
  assert.equal(rows(s, 'user_devices')[0].city, null)
})

test('/admin/users·상세에 city 표시 글자가 실린다(없으면 null)', async () => {
  const s = setup()
  const dv = await s.signup('개발자')
  s.db.raw.prepare("UPDATE users SET role = 'dev' WHERE id = ?").run(dv.id)
  const a = await s.signup('가나')
  const b = await s.signup('다라')
  await visit(s, a.token, { cityOk: true }, { city: 'Suwon', regionCode: 'KR-41', country: 'KR' })
  const r = await s.call('GET', '/admin/users', { token: dv.token })
  const by = Object.fromEntries(r.body.items.map((u: J) => [u.name, u]))
  assert.equal(by['가나'].city, '경기 Suwon')
  assert.equal(by['다라'].city, null)
  void b
  const d = await s.call('GET', `/admin/users/${a.id}/activity`, { token: dv.token })
  assert.equal(d.body.devices[0].city, '경기 Suwon')
  assert.equal(d.body.visits[0].city, '경기 Suwon')
  assert.ok(!('regionCode' in d.body.devices[0]) && !('country' in d.body.visits[0]))
})
