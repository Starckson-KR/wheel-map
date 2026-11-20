import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { fetchTransit, hasStoredTransit, storedTransitSummary } from '../src/lib/transit/provider.ts'

// 시연 쌍 이름이 바뀌면 transit.json 키가 어긋나 배포판에서 저장본을 못 찾는다(11/20 전수점검 E-1). 그걸 바로 드러낸다.
const read = (p: string) => JSON.parse(fs.readFileSync(new URL(p, import.meta.url), 'utf8'))
const demo = read('../data/routes/demoPairs.json') as { pairs: { id: string }[] }
const stored = read('../data/routes/transit.json') as { pairs: Record<string, { itineraries: unknown[]; noRoute?: string }> }
const P = { lat: 35.18, lng: 126.9 }

test('demoPairs.json의 모든 쌍에 transit.json 저장본(경로 1개 이상 또는 noRoute)이 있다', () => {
  assert.ok(demo.pairs.length > 0)
  for (const p of demo.pairs) {
    const s = stored.pairs[p.id]
    assert.ok(hasStoredTransit(p.id), `transit.json에 ${p.id} 저장본 없음`)
    assert.ok(s.itineraries.length >= 1 || !!s.noRoute, `${p.id}: 경로도 noRoute도 없음`)
  }
})

test('noRoute 저장본은 relay 없이 그 문구를 돌려주고, 요약은 null이다', async () => {
  const id = Object.keys(stored.pairs).find((k) => stored.pairs[k].noRoute)
  assert.ok(id, 'noRoute 저장본이 하나는 있어야 함')
  const r = await fetchTransit(id, P, P, true)
  assert.deepEqual(r, { ok: false, message: stored.pairs[id].noRoute })
  assert.equal(storedTransitSummary(id), null)
})
