// 실행: node --test --import ./scripts/registerTs.mjs tests/knowledge.test.ts
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { facilityTitle, usableName } from '../src/lib/facilityName.ts'
import { askKnowledge, goFor, candidateTopics, dataNeeds, distanceText, guessTopics, placeWords, stripJosa, wantsNearby } from '../src/lib/aiSearch/knowledge.ts'
import type { KnowledgeData } from '../src/lib/aiSearch/knowledge.ts'
import { BENEFITS } from '../src/lib/benefitsData.ts'
import { guardIntent } from '../src/lib/aiSearch/keywords.ts'
import { verifyResponse, verifySlots } from '../src/lib/aiSearch/validate.ts'
import { understand, clearAiCache } from '../src/lib/aiSearch/client.ts'
import type { PubDataset } from '../src/lib/publicLayers.ts'

const read = (f: string) => JSON.parse(readFileSync(new URL(`../data/${f}`, import.meta.url), 'utf8')) as PubDataset
const data: KnowledgeData = {
  benefits: BENEFITS,
  toilets: read('public/toilets.json'),
  facilities: read('public/facilities.json'),
  vouchers: read('public/vouchers.json'),
  busStops: read('public/bus-stops.json'),
}
const NOW = Date.parse('2026-11-18')
const ask = (q: string, topic?: string, extra: { origin?: { lat: number; lng: number } } = {}) => askKnowledge(q, { topic, data, now: NOW, ...extra })
const text = (a: ReturnType<typeof ask>) => a.cards.map((c) => `${c.title} ${c.answer} ${c.meta ?? ''} ${c.source}`).join('\n')

test('혜택: 휠체어 택시 → 교통약자 이동지원(새빛콜) 카드, 답은 자료의 요약 그대로, 출처 링크 있음', () => {
  const a = ask('휠체어 택시 어디서 불러요?', 'benefit')
  assert.equal(a.found, true)
  assert.equal(a.cards[0].id, 'mob-saebitcall')
  const b = BENEFITS.find((x) => x.id === 'mob-saebitcall')!
  assert.equal(a.cards[0].answer, b.summary) // 자료에서 그대로
  assert.equal(a.cards[0].sourceUrl, b.sourceUrl)
  assert.ok(a.go.some((g) => g.hash === '#/alerts?section=benefits'))
})

test('혜택: 말투·오타·줄임말이 달라도 같은 항목을 찾는다', () => {
  const want: [string, string][] = [
    ['장애인 콜택시 부르는법 알려줘', 'mob-saebitcall'],
    ['새빛콜 이용하려면 어케 해야돼', 'mob-saebitcall'],
    ['장애인 연금 얼마나 받아여', 'wel-pension'],
    ['활동지원사 신청하고싶은데 어디로 가야해', 'wel-activity'],
    ['휠체어 수리비 지원되나', 'dev-nhis-aid'],
    ['전동휠체어 충전할 수 있는데 있나여', 'dev-charger-bukgu'],
    ['집에 문턱 없애는 공사도 지원해줘?', 'wel-house'],
    ['문화누리카드가 뭐야', 'cul-munhwanuri'],
    ['장애인 주차 스티커 발급 어디서 함', 'mob-vehicle-mark'],
    ['장애인 운동 강좌 지원받을수있어요?', 'cul-sports-voucher'],
    ['휠체어타고 갈만한 여행지 추천해줘', 'cul-open-tour'],
  ]
  for (const [q, id] of want) assert.ok(ask(q).cards.some((c) => c.id === id), `${q} → ${ask(q).cards.map((c) => c.id)}`)
})

test('혜택: 확인 필요 칸은 화면 문구로 쓰지 않는다', () => {
  for (const c of ask('휠체어 택시', 'benefit').cards) assert.ok(!`${c.answer} ${c.meta ?? ''}`.includes('확인 필요'))
})

test('종료일이 지난 혜택은 나오지 않는다', () => {
  const old = { ...BENEFITS[0], id: 'old-x', title: '지난 행사 전용어', summary: '지난 행사 전용어를 해요', period: { type: 'range', end: '2026-01-01' } } as (typeof BENEFITS)[number]
  const a = askKnowledge('지난 행사 전용어', { topic: 'benefit', data: { benefits: [old, ...BENEFITS] }, now: NOW })
  assert.ok(!a.cards.some((c) => c.id === 'old-x'))
})

test('화장실: 경사로 있는 화장실은 편의시설 자료의 출입 항목이 있는 곳만, 중복 항목은 한 번씩', () => {
  const a = ask('근처 경사로 있는 화장실', 'toilet')
  assert.equal(a.found, true)
  assert.ok(a.cards.length <= 3)
  for (const c of a.cards) {
    assert.ok(c.answer.includes('주출입구 높이차이 제거'), c.answer)
    assert.ok(c.answer.includes('장애인사용가능화장실'), c.answer)
    const parts = c.answer.split(' · ')[1].split(', ')
    assert.equal(new Set(parts).size, parts.length) // 중복 없음
  }
})

test('화장실: 기저귀 교환대·24시간 조건은 공중화장실 자료의 값으로 거른다', () => {
  const a = ask('기저귀 교환대 있는 화장실 어디야', 'toilet')
  assert.ok(a.found && a.cards.every((c) => c.answer.includes('기저귀 교환대 있음')))
  const b = ask('24시간 쓸수있는 장애인 화장실 있음?', 'toilet')
  assert.ok(b.found && b.cards.every((c) => c.answer.includes('상시 개방')))
})

test('화장실: 위치를 알면 가까운 순서로 정렬하고 거리를 보여 준다', () => {
  const origin = { lat: 35.1771, lng: 126.9035 } // 전남대 근처
  const a = ask('화장실 어디 있어', 'toilet', { origin })
  assert.equal(a.found, true)
  const ds = a.cards.map((c) => Number(/약 ([\d.]+)(km|m)/.exec(c.meta ?? '')?.[1]) * (/km/.test(c.meta ?? '') ? 1000 : 1))
  assert.ok(ds.every((d) => d > 0))
  assert.deepEqual([...ds].sort((x, y) => x - y), ds)
})

test('상품권 가맹점: 휠체어 조건이면 출입 정보가 있는 곳만, 가게·상품권 같은 흔한 말은 이름 찾기에 쓰지 않는다', () => {
  const a = ask('휠체어로 갈 수 있는 상품권 가맹점 있어?', 'voucher')
  assert.ok(a.found && a.cards.length === 3)
  for (const c of a.cards) assert.ok(c.answer.includes('출입 정보'), c.answer)
  const g = ask('상품권 쓸 수 있는 가게', 'voucher')
  assert.ok(g.found && g.total > 1000) // 이름이 「가게」인 곳 한두 곳으로 좁혀지지 않는다
  const n = ask('파리바게뜨 상품권 되나요', 'voucher')
  assert.ok(n.cards.every((c) => c.title.includes('파리바게뜨')))
})

test('편의시설: 종류와 조건을 함께 거른다(식당=음식점, 병원+승강기)', () => {
  const a = ask('경사로 있는 식당 추천해줘', 'facility')
  assert.ok(a.found)
  for (const c of a.cards) {
    assert.ok(/음식점/.test(c.answer))
    assert.ok(c.answer.includes('높이차이 제거'))
  }
  const h = ask('엘베 있는 병원 알려줘요', 'facility')
  assert.ok(h.found && h.cards.every((c) => c.answer.includes('승강기') && /병원|의원/.test(c.answer)))
  const m = ask('휠체어 탄채로 들어갈수있는 편의점 있나요', 'facility')
  assert.ok(!/전시장/.test(text(m))) // 「시장」이 「전시장」에 걸리지 않는다
})

test('자료에 없는 장소나 낯선 말은 지어내지 않고 못 찾았다고 한다', () => {
  const a = ask('전남대 후문 근처 휠체어 가는 식당', 'facility')
  assert.equal(a.found, false)
  assert.equal(a.cards.length, 0)
  const w = ask('오늘 날씨 어때요')
  assert.equal(w.found, false)
  assert.equal(w.topic, null)
  assert.equal(ask('경사로 있는 곳', 'facility').found, false) // 종류도 장소도 없으면 아무 시설이나 보여 주지 않는다
})

test('신고 방법: 접수 창구와 신고 안내를 앱 안내에서 그대로', () => {
  const a = ask('불편한거 신고는 어디에 해요?', 'howto')
  assert.ok(a.found)
  assert.ok(text(a).includes('안전신문고'))
  assert.ok(a.cards.every((c) => c.source === '앱 안내'))
})

test('담당 기관: 확인된 기관만 보여 주고 전화번호는 내지 않는다', () => {
  const a = ask('계단 턱 신고는 어느 기관 담당이야?', 'agency')
  assert.ok(a.found)
  assert.ok(!/\d{2,4}-\d{3,4}-\d{4}/.test(text(a)))
})

test('정류장: 장소가 있으면 그 동네 정류장, 없으면 고정 안내 카드', () => {
  const a = ask('용봉동 버스정류장 어디있어?', 'bus')
  assert.ok(a.found && a.cards.every((c) => c.answer.includes('용봉동')))
  const b = ask('저상버스 몇 대 다녀?', 'bus')
  assert.equal(b.cards[0].id, 'bus-screen')
})

test('주제 짐작: 단서가 분명한 주제를 먼저, 모델 주제는 그 뒤', () => {
  assert.deepEqual(candidateTopics('상품권 되는 가게중에 문턱 없는 곳', 'facility').slice(0, 2), ['voucher', 'facility'])
  assert.equal(candidateTopics('화장실 있는 카페 알려줘', 'facility')[0], 'facility')
  assert.equal(candidateTopics('경사로 있는 화장실', 'toilet')[0], 'toilet')
  assert.deepEqual(candidateTopics('오늘 날씨', undefined), [])
  assert.deepEqual(candidateTopics('오늘 날씨', 'benefit'), ['benefit'])
  assert.deepEqual(candidateTopics('오늘 날씨', 'nonsense'), [])
  assert.ok(guessTopics('휠체어 택시 어디서 불러요').includes('benefit'))
})

test('필요한 자료만 불러온다', () => {
  assert.deepEqual(dataNeeds(['benefit', 'howto']), [])
  assert.deepEqual(dataNeeds(['voucher']), ['vouchers'])
  assert.deepEqual(dataNeeds(['toilet']).sort(), ['facilities', 'toilets'])
})

test('낱말 도우미: 조사 떼기, 장소 낱말, 거리 문구, 근처 판정', () => {
  assert.equal(stripJosa('용봉동에서'), '용봉동')
  assert.equal(stripJosa('경사로'), '경사로')
  assert.deepEqual(placeWords('용봉동에 승강기 있는 공중화장실'), ['용봉동'])
  assert.deepEqual(placeWords('기저귀 교환대 있는 화장실'), []) // 「교환대」는 장소가 아니다
  assert.equal(distanceText(347), '약 350m')
  assert.equal(distanceText(1530), '약 1.5km')
  assert.ok(wantsNearby('근처 화장실') && !wantsNearby('화장실 알려줘'))
})

test('앱 검증: ask 응답은 주제 목록 밖 값을 버리고, 모델의 답 문장은 받지 않는다', () => {
  const q = '휠체어 택시 어디서 불러요?'
  const v = verifyResponse({ ok: true, intent: 'ask', slots: { topic: 'benefit', query: '택시', answer: '지어낸 답' }, confidence: 0.9, fallback: false }, q)
  assert.deepEqual(v?.slots, { topic: 'benefit', query: '택시' })
  assert.deepEqual(verifySlots('ask', { topic: 'hack', query: '없는말' }, q), {})
  assert.equal(guardIntent('새빛콜 전화번호 알려줘', 'ask'), 'unknown')
  assert.equal(guardIntent(q, 'ask'), 'ask')
})

test('클라이언트: Worker가 ask를 돌려주면 그대로 이해하고, 실패하면 키워드로 넘어간다', async () => {
  clearAiCache()
  const okFetch = (async () => new Response(JSON.stringify({ ok: true, intent: 'ask', slots: { topic: 'voucher', query: '가게' }, confidence: 0.9, fallback: false }), { status: 200 })) as typeof fetch
  const r = await understand('상품권 쓸 수 있는 가게', { url: 'http://x', enabled: true, fetchImpl: okFetch })
  assert.equal(r.intent, 'ask')
  assert.equal(r.source, 'ai')
  assert.equal(r.slots.topic, 'voucher')
  clearAiCache()
  const bad = (async () => new Response('x', { status: 500 })) as typeof fetch
  const k = await understand('상품권 쓸 수 있는 가게', { url: 'http://x', enabled: true, fetchImpl: bad })
  assert.equal(k.source, 'keyword')
  assert.notEqual(k.intent, 'ask')
})

test('편의시설 이름: 지번·건축물 용도·괄호 속 이름은 숨기고, 업종과 도로명·동으로 알아볼 수 있게 한다', () => {
  const mk = (name: string, type: string, address: string) => ({ name, address, fields: { faclTyCd: type } })
  const addr = '전남광주통합특별시 북구 가상로39번길 11 (가상동)'
  assert.equal(facilityTitle(mk('가상동 578-9 제2종근린생활시설 (홍길동)', '일반음식점', addr)), '일반음식점 · 가상로39번길 11 가상동')
  assert.equal(facilityTitle(mk('휴게음식점·제과점', '휴게음식점·제과점', addr)), '휴게음식점·제과점 · 가상로39번길 11 가상동')
  assert.equal(facilityTitle(mk('가상빌딩 (임꺽정)', '일반음식점', addr)), '가상빌딩') // 상호는 남기고 괄호 속 이름만 뺀다
  assert.equal(facilityTitle(mk('가상 마트', '수퍼마켓·일용품 등의 소매점', addr)), '가상 마트')
  assert.equal(usableName('가상동 12 단독주택', '단독주택'), null)
  assert.ok(!facilityTitle(mk('가상동 578-9 제2종근린생활시설 (홍길동)', '일반음식점', addr)).includes('홍길동'))
})

test('편의시설 카드 제목에는 원본의 지번·용도·괄호 이름이 나오지 않는다', () => {
  const a = ask('경사로 있는 식당 추천해줘', 'facility')
  for (const c of a.cards) {
    assert.ok(!/제\s*\d\s*종|근린생활시설|\(/.test(c.title), c.title)
    assert.ok(c.title.length > 3)
  }
})

test('지도 버튼: 종류에 맞는 이름, 확대된 지도의 중심(근처면 내 위치, 아니면 첫 결과)을 함께 보낸다', () => {
  const v = ask('휠체어로 갈 수 있는 상품권 가맹점 있어?', 'voucher')
  assert.equal(v.go[0].label, '가맹점 지도 보기')
  const first = v.cards[0]
  assert.ok(v.go[0].hash.startsWith('#/map?layer=voucher&lat=') && v.go[0].hash.includes(`lat=${first.lat!.toFixed(5)}`))
  const f = ask('경사로 있는 식당 추천해줘', 'facility')
  assert.equal(f.go[0].label, '편의시설 지도 보기')
  assert.ok(f.go[0].hash.startsWith('#/map?layer=facility&lat='))
  const me = { lat: 35.1771, lng: 126.9035 }
  const t = askKnowledge('근처 경사로 있는 화장실', { topic: 'toilet', data, now: NOW, origin: me })
  assert.equal(t.go[0].label, '화장실 지도 보기')
  assert.ok(t.go[0].hash.includes('lat=35.17710') && t.go[0].hash.includes('lng=126.90350'))
  const noNear = askKnowledge('경사로 있는 화장실', { topic: 'toilet', data, now: NOW, origin: me })
  assert.ok(!noNear.go[0].hash.includes('lat=35.17710')) // 「근처」를 묻지 않았으면 첫 결과
  assert.deepEqual(goFor('toilet', [], undefined, false), [{ label: '화장실 지도 보기', hash: '#/map?layer=toilet' }]) // 결과가 없으면 기본 위치
  assert.deepEqual(goFor('benefit', v.cards, me, true).map((g) => g.hash), ['#/alerts?section=benefits'])
})
