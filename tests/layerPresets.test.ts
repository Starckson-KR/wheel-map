import { test } from 'node:test'
import assert from 'node:assert/strict'
import { CHIPS, LAYER_GROUPS, LAYER_KEYS, applyChip, chipOf, chipOrder, chipSummary, countNear, nearestM, pressChip, type ChipId, type LayerKey } from '../src/lib/layerPresets.ts'
import type { LayerState, PubItem } from '../src/lib/publicLayers.ts'

// publicLayers.ts는 JSON을 동적으로 불러와 시험에서 직접 쓰지 않는다. 기본값(길 가기)은 여기에 같은 모양으로 적는다.
const OFF: LayerState = { team: false, crosswalk: false, toilet: false, facility: false, bus: false, voucher: false, overpass: false, welfare: false, yellow: false, flood: false, shade: false, airSignal: false, schoolZone: false, parkingZone: false, toiletAccessibleOnly: false, voucherAccessibleOnly: true }
const onKeys = (s: LayerState) => LAYER_KEYS.filter((k) => s[k]).sort()

test('칩을 고르면 문서 표의 레이어 묶음만 켜진다', () => {
  const expected: Record<ChipId, LayerKey[]> = {
    walk: ['team', 'overpass', 'toilet'],
    bus: ['bus', 'team'],
    toilet: ['toilet'],
    rain: ['flood', 'bus', 'team'],
    child: ['schoolZone', 'yellow', 'overpass', 'parkingZone'],
    hot: ['shade', 'airSignal', 'toilet'],
  }
  for (const id of Object.keys(expected) as ChipId[]) {
    // 다른 것이 잔뜩 켜진 상태에서 골라도 그 묶음만 남는다
    const all = { ...OFF, ...Object.fromEntries(LAYER_KEYS.map((k) => [k, true])) } as LayerState
    assert.deepEqual(onKeys(applyChip(id, all)), [...expected[id]].sort(), id)
    assert.deepEqual(onKeys(applyChip(id, OFF)), [...expected[id]].sort(), id)
  }
})

test('장애인화장실이 들어간 칩은 장애인용만 보기를 켜고, 가맹점 보기 설정은 그대로 둔다', () => {
  assert.equal(applyChip('walk', OFF).toiletAccessibleOnly, true)
  assert.equal(applyChip('toilet', OFF).toiletAccessibleOnly, true)
  assert.equal(applyChip('bus', OFF).toiletAccessibleOnly, false)
  assert.equal(applyChip('bus', OFF).voucherAccessibleOnly, true)
})

test('켜진 레이어가 칩의 묶음과 같으면 그 칩이고, 하나라도 직접 바꾸면 풀린다', () => {
  for (const id of Object.keys(CHIPS) as ChipId[]) assert.equal(chipOf(applyChip(id, OFF)), id)
  const walk = applyChip('walk', OFF)
  assert.equal(chipOf({ ...walk, shade: true }), null)
  assert.equal(chipOf({ ...walk, overpass: false }), null) // 옛 기본값(장애요소+화장실)은 어느 칩도 아니다
  assert.equal(chipOf({ ...walk, toiletAccessibleOnly: false }), 'walk') // 보기 설정은 칩을 풀지 않는다
  assert.equal(chipOf(OFF), null)
})

test('칩 순서: 평소에는 길 가기가 먼저, 비·눈이면 비 오는 날이 맨 앞, 더우면 그 자리에 더운 날', () => {
  assert.deepEqual(chipOrder(null), ['walk', 'bus', 'toilet', 'rain', 'child'])
  assert.deepEqual(chipOrder({ tempC: 12, condition: 'clear' }), ['walk', 'bus', 'toilet', 'rain', 'child'])
  assert.equal(chipOrder({ tempC: 14, condition: 'rain' })[0], 'rain')
  assert.equal(chipOrder({ tempC: -1, condition: 'snow' })[0], 'rain')
  assert.equal(chipOrder({ tempC: 1, condition: 'sleet' })[0], 'rain')
  const hot = chipOrder({ tempC: 35, condition: 'clear' })
  assert.equal(hot[0], 'hot')
  assert.equal(hot.includes('rain'), false)
  // 덥고 비가 오면 비가 먼저다
  assert.equal(chipOrder({ tempC: 34, condition: 'rain' })[0], 'rain')
  assert.equal(chipOrder({ tempC: 32, condition: 'clear' }).includes('hot'), false)
})

test('직접 고르기 다섯 묶음에 패널에서 켤 수 있는 레이어가 한 번씩 들어 있다(횡단보도는 길찾기 전용이라 뺀다)', () => {
  assert.equal(LAYER_GROUPS.length, 5)
  const keys = LAYER_GROUPS.flatMap((g) => g.keys)
  assert.equal(new Set(keys).size, keys.length)
  assert.deepEqual([...keys].sort(), LAYER_KEYS.filter((k) => k !== 'crosswalk').sort())
  // 칩이 켜는 레이어는 모두 패널에서도 끌 수 있어야 한다
  for (const c of Object.values(CHIPS)) for (const k of c.on) assert.ok(keys.includes(k), `${c.id}:${k}`)
})

const item = (id: string, lat: number | null, lng: number | null): PubItem => ({ id, name: id, lat, lng, address: '', fields: {} })

test('가까운 곳 세기: 반경 안의 항목만 세고 좌표 없는 항목은 뺀다', () => {
  const c = { lat: 35.176, lng: 126.912 }
  const items = [item('a', 35.176, 126.912), item('b', 35.1769, 126.912) /* 약 100m */, item('c', 35.2, 126.912) /* 약 2.7km */, item('d', null, null)]
  assert.equal(countNear(items, c, 1500), 2)
  assert.equal(countNear(items, c, 50), 1)
  assert.equal(nearestM([items[1], items[2], items[3]], c), 100)
  assert.equal(nearestM([items[3]], c), null)
})

test('요약 한 줄: 숫자는 받은 값 그대로, 모르면 줄이 없다. 길 가기는 줄이 없다', () => {
  assert.equal(chipSummary('walk', { bus: 3, flood: 1 }), null)
  assert.equal(chipSummary('rain', {}), null)
  const rain = chipSummary('rain', { flood: 193 })
  assert.equal(`${rain?.before}${rain?.strong}${rain?.after}`, '물이 찼던 곳 193곳과 가까운 정류장을 보여 드려요')
  const bus = chipSummary('bus', { bus: 4 })
  assert.equal(`${bus?.before}${bus?.strong}${bus?.after}`, '가까운 정류장 4곳을 보여 드려요')
  assert.equal(chipSummary('child', { schoolZone: 25 })?.strong, '25곳')
  assert.equal(chipSummary('hot', { shade: 46 })?.strong, '46곳')
  // 화장실: 내 위치를 알면 거리, 모르면 개수
  assert.equal(chipSummary('toilet', { toilet: 12, toiletM: 120 })?.strong, '120m')
  assert.equal(chipSummary('toilet', { toilet: 12, toiletM: 1240 })?.strong, '1.2km')
  assert.equal(chipSummary('toilet', { toilet: 12, toiletM: null })?.strong, '12곳')
})

test('요약 문구에 「비 피할」 표현을 쓰지 않는다(정류장 지붕 자료 없음)', () => {
  for (const id of Object.keys(CHIPS) as ChipId[]) {
    const s = chipSummary(id, { bus: 1, toilet: 1, toiletM: null, flood: 1, schoolZone: 1, shade: 1 })
    assert.equal(/비\s*피할|쉘터|지붕/.test(`${s?.before}${s?.strong}${s?.after}`), false)
  }
})

test('칩은 한 번에 하나: 다른 칩을 누르면 바뀌고, 켜진 칩을 다시 누르면 장애요소만 남는다', () => {
  const rain = pressChip('rain', OFF)
  assert.equal(chipOf(rain), 'rain')
  const toilet = pressChip('toilet', rain)
  assert.equal(chipOf(toilet), 'toilet')
  assert.deepEqual(onKeys(toilet), ['toilet']) // 앞 칩(비 오는 날) 몫은 남지 않는다
  const off = pressChip('toilet', toilet)
  assert.equal(chipOf(off), null)
  assert.deepEqual(onKeys(off), ['team'])
  // 직접 고른 상태(어느 칩도 아님)에서 누르면 그 칩만 켜진다
  assert.deepEqual(onKeys(pressChip('bus', { ...rain, shade: true })), [...CHIPS.bus.on].sort())
  // 어느 칩이든 한 번 누르면 그 칩 하나만 골라진다
  for (const a of Object.keys(CHIPS) as ChipId[]) for (const b of Object.keys(CHIPS) as ChipId[]) if (a !== b) assert.equal(chipOf(pressChip(b, pressChip(a, OFF))), b)
})
