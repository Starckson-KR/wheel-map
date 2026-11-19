import test from 'node:test'
import assert from 'node:assert/strict'
import { odsayUrl, parseOdsay } from '../src/lib/transit/odsay.ts'
import { nextLow, sameLine } from '../src/lib/bus/types.ts'

const FROM: [number, number] = [35.18201, 126.909703]
const TO: [number, number] = [35.172172, 126.900534]
const bus = (no: string, type: number, a: string, z: string) => ({
  trafficType: 2,
  distance: 1500,
  sectionTime: 10,
  lane: [{ busNo: no, type }],
  startName: a,
  startX: 126.909134,
  startY: 35.182239,
  endName: z,
  endX: 126.905299,
  endY: 35.168531,
  passStopList: {
    stations: [
      { stationID: 1, stationName: a, x: '126.909134', y: '35.182239' },
      { stationID: 2, stationName: '중간', x: '126.907', y: '35.175' },
      { stationID: 3, stationName: z, x: '126.905299', y: '35.168531' },
    ],
  },
})
const ok = {
  result: {
    path: [
      { pathType: 2, info: { totalTime: 22, payment: 1250, totalWalk: 651, busTransitCount: 1 }, subPath: [{ trafficType: 3, distance: 58, sectionTime: 1 }, bus('07', 11, '가', '나'), { trafficType: 3, distance: 593, sectionTime: 9 }] },
      { pathType: 3, info: { totalTime: 30 }, subPath: [{ trafficType: 1, distance: 100, sectionTime: 5 }] }, // 버스 없음 → 제외
      { pathType: 2, info: { totalTime: 39, payment: 2500, busTransitCount: 2 }, subPath: [bus('54', 11, '가', '나'), { trafficType: 3, distance: 0, sectionTime: 0 }, bus('1001', 15, '나', '다')] },
    ],
  },
}

test('ODsay 응답 → 앱 경로: 분은 초로, 도보 양 끝은 출발·도착과 정류장으로', () => {
  const p = parseOdsay(ok, FROM, TO)
  assert.ok(p.ok)
  if (!p.ok) return
  assert.equal(p.itineraries.length, 2)
  const a = p.itineraries[0]
  assert.equal(a.time, 22 * 60)
  assert.equal(a.fare, 1250)
  assert.equal(a.transfers, 0)
  assert.deepEqual(a.legs.map((l) => l.mode), ['WALK', 'BUS', 'WALK'])
  assert.equal(a.legs[0].from.name, '출발지')
  assert.deepEqual([a.legs[0].from.lat, a.legs[0].from.lng], FROM)
  assert.equal(a.legs[0].to.name, '가')
  assert.equal(a.legs[2].to.name, '도착지')
  assert.deepEqual([a.legs[2].to.lat, a.legs[2].to.lng], TO)
  assert.equal(a.walkTime, 10 * 60)
  const b = a.legs[1]
  assert.equal(b.lineName, '07')
  assert.equal(b.route, '간선:07')
  assert.equal(b.time, 600)
  assert.equal(b.stations?.length, 3)
  assert.deepEqual(b.coords[1], [35.175, 126.907]) // 위도, 경도 순서
})

test('ODsay: 환승 0m 걷기는 빠지고 환승 수와 급행 종류가 맞다', () => {
  const p = parseOdsay(ok, FROM, TO)
  assert.ok(p.ok)
  if (!p.ok) return
  const c = p.itineraries[1]
  assert.deepEqual(c.legs.map((l) => l.mode), ['BUS', 'BUS'])
  assert.equal(c.transfers, 1)
  assert.equal(c.legs[1].route, '급행:1001')
})

test('ODsay: 오류 코드는 쉬운 문구로, 원문은 내보내지 않는다', () => {
  const near = parseOdsay({ error: { code: '-98', msg: 'raw apiKey=SECRET' } }, FROM, TO)
  assert.ok(!near.ok && near.code === '-98' && !near.message.includes('SECRET'))
  const arr = parseOdsay({ error: [{ code: '-99', message: 'x' }] }, FROM, TO)
  assert.ok(!arr.ok && arr.code === '-99')
  assert.ok(!parseOdsay(null, FROM, TO).ok)
  const unknownType = parseOdsay({ result: { path: [{ info: {}, subPath: [bus('9', 99, 'a', 'b')] }] } }, FROM, TO)
  assert.ok(unknownType.ok && unknownType.itineraries[0].legs[0].route === undefined)
})

test('ODsay 주소: 경도·위도 순서이고 키는 주소에 없다', () => {
  const u = odsayUrl(FROM, TO)
  assert.ok(u.includes('SX=126.909703&SY=35.182010&EX=126.900534&EY=35.172172'))
  assert.ok(!/key/i.test(u.split('?')[1]))
})

test('노선 번호만(07)이어도 BIS 이름(진월07)과 같은 노선으로 본다', () => {
  assert.ok(sameLine('진월07', '07'))
  assert.ok(sameLine('419', '419'))
  assert.ok(!sameLine('1007', '07')) // 앞이 숫자면 다른 노선
  assert.ok(!sameLine('419', '19'))
  const arr = [{ lineId: '4', lineName: '진월07', remainMin: 4, remainStop: 2, low: true, kind: 1 }]
  assert.equal(nextLow(arr as never, '07')?.lineName, '진월07')
})
