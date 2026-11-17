import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { Hit, Obstacle, Pt } from '../src/lib/routing/engine.ts'
import { buildSteps, stepIndexAt, stepText, turnOf } from '../src/lib/routing/guide.ts'
import { M } from '../src/lib/routing/walkGraph.ts'

const M_LAT = 111320
const KX = M_LAT * Math.cos((35.17 * Math.PI) / 180)
// 미터 좌표(동 x, 북 y) → [위도, 경도]
const P = (x: number, y: number): Pt => [35.17 + y / M_LAT, 126.9 + x / KX]
const line = (...xy: [number, number][]) => xy.map(([x, y]) => P(x, y))

test('꺾임 각도 → 회전 종류', () => {
  assert.equal(turnOf(10), 'straight')
  assert.equal(turnOf(-40), 'slight-left')
  assert.equal(turnOf(90), 'right')
  assert.equal(turnOf(-90), 'left')
  assert.equal(turnOf(140), 'sharp-right')
  assert.equal(turnOf(180), 'uturn')
})

test('북쪽으로 100m 간 뒤 동쪽으로 100m: 출발 → 우회전 → 도착', () => {
  const c = line([0, 0], [0, 50], [0, 100], [50, 100], [100, 100])
  const s = buildSteps(c, undefined, [])
  assert.deepEqual(s.map((x) => x.kind), ['depart', 'turn', 'arrive'])
  assert.equal(s[1].turn, 'right')
  assert.equal(s[1].title, '우회전')
  assert.ok(Math.abs(s[0].distM - 100) <= 2 && Math.abs(s[1].distM - 100) <= 2)
  assert.equal(stepText(s[1]).sub, '100m 가요')
})

test('서쪽으로 꺾으면 좌회전', () => {
  const s = buildSteps(line([0, 0], [0, 100], [-100, 100]), undefined, [])
  assert.equal(s[1].turn, 'left')
})

test('완만한 굽이(작은 각도)는 직진으로 합친다', () => {
  const s = buildSteps(line([0, 0], [0, 40], [4, 80], [0, 120], [0, 200]), undefined, [])
  assert.deepEqual(s.map((x) => x.kind), ['depart', 'arrive'])
})

test('횡단보도·계단 구간은 따로 단계가 된다', () => {
  const c = line([0, 0], [0, 60], [0, 90], [0, 150])
  const seg = [0, M.CROSSING, 0]
  const s = buildSteps(c, seg, [])
  assert.deepEqual(s.map((x) => x.kind), ['depart', 'crossing', 'turn', 'arrive'])
  assert.equal(s[1].title, '횡단보도 건너기')
  const t = buildSteps(c, [0, M.STEPS, 0], [])
  assert.equal(t[1].kind, 'stairs')
})

test('피해 간 장애요소와 경로 위 장애요소가 해당 단계에 붙는다', () => {
  const c = line([0, 0], [0, 100], [100, 100])
  const o: Obstacle = { id: 'X1', name: 'X1', kind: 'point', impact: 'passage', rating: 'X', path: [P(0, 100)], origin: 'seed' }
  const hit: Hit = { o, role: 'X', distM: 3, atM: 150, anchor: P(50, 100), segIdx: 1 }
  const s = buildSteps(c, undefined, [hit], [{ ...hit, o: { ...o, id: 'AV' }, atM: 20, anchor: P(2, 20) }])
  assert.ok(s[1].notes.some((n) => n.kind === 'hit'))
  assert.ok(s[0].notes.some((n) => n.kind === 'avoid' && n.o.id === 'AV'))
})

test('진행 거리로 지금 단계 찾기', () => {
  const s = buildSteps(line([0, 0], [0, 100], [100, 100]), undefined, [])
  assert.equal(stepIndexAt(s, 10), 0)
  assert.equal(stepIndexAt(s, 150), 1)
  assert.equal(stepIndexAt(s, 999), s.length - 1)
})
