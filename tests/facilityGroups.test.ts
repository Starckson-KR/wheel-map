import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { groupFacilities, isDeletedFacility, membersOf } from '../src/lib/facilityGroups.ts'
import type { PubItem } from '../src/lib/publicLayers.ts'

const raw = (JSON.parse(fs.readFileSync(new URL('../data/public/facilities.json', import.meta.url), 'utf8')) as { items: PubItem[] }).items
const kept = raw.filter((i) => !isDeletedFacility(i))
const grouped = groupFacilities(raw)

test('묶은 뒤 id가 겹치지 않는다', () => {
  assert.equal(new Set(grouped.map((g) => g.id)).size, grouped.length)
  assert.ok(grouped.length < raw.length)
})

test('「삭제 요청」 자료가 없다', () => {
  assert.ok(raw.some(isDeletedFacility), '원본에 삭제 요청 자료가 있어야 시험이 의미 있음')
  const names = grouped.flatMap((g) => [g.name, ...membersOf(g).map((m) => m.name)])
  assert.ok(!names.some((n) => /^\(?\s*삭제\s*요청/.test(n)))
})

test('같은 id·같은 이름 중복은 하나만 남는다', () => {
  const keys = new Set(kept.map((i) => `${i.id}|${i.name}`))
  const total = grouped.reduce((n, g) => n + Math.max(1, membersOf(g).length), 0)
  assert.equal(total, keys.size)
  for (const g of grouped) {
    const m = membersOf(g)
    assert.equal(new Set(m.map((x) => x.name)).size, m.length)
  }
})

test('묶음 시설 수 합이 맞고, 묶음 안 고유 번호(key)는 겹치지 않는다', () => {
  for (const g of grouped) {
    const m = membersOf(g)
    if (m.length) assert.equal(new Set(m.map((x) => x.key)).size, m.length, g.id)
  }
  const ids = new Set(kept.map((i) => i.id))
  assert.equal(grouped.length, ids.size)
})

test('시설이 1곳인 건물은 원본 그대로(members 없음)', () => {
  const single = grouped.find((g) => membersOf(g).length === 0)
  assert.ok(single)
  assert.ok(raw.includes(single))
})
