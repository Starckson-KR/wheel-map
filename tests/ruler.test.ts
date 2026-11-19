import test from 'node:test'
import assert from 'node:assert/strict'
import { CURB_RULER, WIDTH_RULER, clampTo, crossedLine, formatValue, parseValue, ratioOf, stepValue, valueFromX } from '../src/lib/ruler.ts'
import { metersBetween, pinMoved } from '../src/lib/pinLift.ts'

test('폭 판정: 1.2m 미만 X, 2m 미만 △, 그 이상 ○', () => {
  assert.equal(WIDTH_RULER.tierOf(0.9), 'x')
  assert.equal(WIDTH_RULER.tierOf(1.19), 'x')
  assert.equal(WIDTH_RULER.tierOf(1.2), 't')
  assert.equal(WIDTH_RULER.tierOf(1.99), 't')
  assert.equal(WIDTH_RULER.tierOf(2), 'o')
})

test('턱 판정: 2cm 이하 ○, 넘으면 △(어려움으로 단정하지 않음)', () => {
  assert.equal(CURB_RULER.tierOf(2), 'o')
  assert.equal(CURB_RULER.tierOf(2.5), 't')
  assert.equal(CURB_RULER.tierOf(9), 't')
})

test('막대 위치 → 값: 한 칸 단위로 맞추고 범위 안으로 자른다', () => {
  assert.equal(valueFromX(WIDTH_RULER, 0, 300), 0)
  assert.equal(valueFromX(WIDTH_RULER, 300, 300), 3)
  assert.equal(valueFromX(WIDTH_RULER, 150, 300), 1.5)
  assert.equal(valueFromX(WIDTH_RULER, -40, 300), 0)
  assert.equal(valueFromX(WIDTH_RULER, 999, 300), 3)
  assert.equal(valueFromX(WIDTH_RULER, 10, 0), 0)
  assert.equal(valueFromX(CURB_RULER, 31, 100), 3)
})

test('선을 지날 때만 알린다', () => {
  assert.equal(crossedLine(WIDTH_RULER, 1.1, 1.2), true)
  assert.equal(crossedLine(WIDTH_RULER, 1.2, 1.9), false)
  assert.equal(crossedLine(WIDTH_RULER, 1.9, 2.1), true)
  assert.equal(crossedLine(WIDTH_RULER, 0.5, 2.5), true)
  assert.equal(crossedLine(CURB_RULER, 1, 2), false)
  assert.equal(crossedLine(CURB_RULER, 2, 2.5), true)
})

test('한 칸 이동·부동소수점 오차 없음', () => {
  assert.equal(stepValue(WIDTH_RULER, 1.1, 1), 1.2)
  assert.equal(stepValue(WIDTH_RULER, 0.7, 1), 0.8)
  assert.equal(stepValue(WIDTH_RULER, 0.1, -1, true), 0)
  assert.equal(stepValue(WIDTH_RULER, 2.9, 1, true), 3)
  assert.equal(stepValue(CURB_RULER, 2, 1), 2.5)
  assert.equal(stepValue(WIDTH_RULER, undefined, 1), 0.1)
})

test('문자열 값 변환', () => {
  assert.equal(parseValue(''), undefined)
  assert.equal(parseValue('  '), undefined)
  assert.equal(parseValue('abc'), undefined)
  assert.equal(parseValue('1.35'), 1.35)
  assert.equal(formatValue(WIDTH_RULER, 1.2), '1.2')
  assert.equal(formatValue(WIDTH_RULER, 1.234), '1.23')
  assert.equal(clampTo(CURB_RULER, 55), 10)
  assert.equal(ratioOf(WIDTH_RULER, 6), 1)
  assert.equal(ratioOf(WIDTH_RULER, 1.5), 0.5)
})

test('중앙 핀: 1m 넘게 옮겨졌을 때만 내려앉는 반응', () => {
  const a = { lat: 35.1747, lng: 126.912 }
  assert.ok(Math.abs(metersBetween(a, { lat: a.lat + 0.0001, lng: a.lng }) - 11.13) < 0.2)
  assert.equal(pinMoved(a, a), false)
  assert.equal(pinMoved(a, { lat: a.lat + 0.000005, lng: a.lng }), false)
  assert.equal(pinMoved(a, { lat: a.lat + 0.0001, lng: a.lng }), true)
  assert.equal(pinMoved(null, a), true)
})
