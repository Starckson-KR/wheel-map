// 실행: node --import ./scripts/registerTs.mjs --test tests/weather.test.ts
import test from 'node:test'
import assert from 'node:assert/strict'
import { fcstBase, latLonToGrid, ncstBase, precipCondition, skyCondition, toWeather, weatherUrl, YONGBONG_GRID } from '../worker/src/weatherCore.ts'
import { advisoryOf, cardLines, headline, iconOf, parseWeather, DEMO_VALUES } from '../src/lib/weather/model.ts'
import { keywordIntent } from '../src/lib/aiSearch/keywords.ts'

test('격자 변환: 기상청 안내 예시(서울 청운효자동 60,127 · 제주 남원읍 56,33)와 용봉동', () => {
  assert.deepEqual(latLonToGrid(37.5847, 126.9764), { nx: 60, ny: 127 }) // 청운효자동 대표 좌표 근처
  assert.deepEqual(latLonToGrid(33.2788, 126.7194), { nx: 56, ny: 33 }) // 남원읍 대표 좌표 근처
  assert.deepEqual(YONGBONG_GRID, { nx: 59, ny: 75 }) // 용봉동 중심 좌표를 위 공식으로 계산한 값(기상청 격자 목록과 대조는 사용자 확인 필요)
})

test('발표 시각: 실황은 10분 뒤부터, 예보는 45분 뒤부터(한국 시각)', () => {
  const kst = (s: string) => Date.parse(s + '+09:00')
  assert.deepEqual(ncstBase(kst('2026-11-19T14:09:00')), { date: '20261119', time: '1300' })
  assert.deepEqual(ncstBase(kst('2026-11-19T14:10:00')), { date: '20261119', time: '1400' })
  assert.deepEqual(fcstBase(kst('2026-11-19T14:44:00')), { date: '20261119', time: '1330' })
  assert.deepEqual(fcstBase(kst('2026-11-19T14:45:00')), { date: '20261119', time: '1430' })
  // 자정 직후는 전날 23시
  assert.deepEqual(ncstBase(kst('2026-11-19T00:05:00')), { date: '20261118', time: '2300' })
  assert.deepEqual(fcstBase(kst('2026-11-19T00:20:00')), { date: '20261118', time: '2330' })
})

test('요청 주소: 격자·시각이 들어가고 키는 인코딩된다', () => {
  const u = weatherUrl('getUltraSrtNcst', 'a+b/c', Date.parse('2026-11-19T14:20:00+09:00'))
  assert.match(u, /^https:\/\/apis\.data\.go\.kr\/1360000\/VilageFcstInfoService_2\.0\/getUltraSrtNcst\?/)
  assert.ok(u.includes('serviceKey=a%2Bb%2Fc') && u.includes('nx=59') && u.includes('ny=75') && u.includes('base_time=1400') && u.includes('dataType=JSON'))
})

const wrap = (item: unknown[]) => ({ response: { header: { resultCode: '00' }, body: { items: { item } } } })
const ncst = (t: string, pty: string) => wrap([
  { baseDate: '20261119', baseTime: '1400', category: 'PTY', obsrValue: pty },
  { baseDate: '20261119', baseTime: '1400', category: 'T1H', obsrValue: t },
])
const fcst = (sky: string) => wrap([
  { category: 'SKY', fcstDate: '20261119', fcstTime: '1600', fcstValue: '4' },
  { category: 'SKY', fcstDate: '20261119', fcstTime: '1500', fcstValue: sky },
])

test('응답 가공: 비·눈이 없으면 하늘은 가장 가까운 예보 시각 값', () => {
  assert.deepEqual(toWeather(ncst('17.6', '0'), fcst('1')), { tempC: 18, condition: 'clear', observedAt: '202611191400' })
  assert.equal(toWeather(ncst('9', '0'), fcst('3'))?.condition, 'cloudy')
  assert.equal(toWeather(ncst('9', '0'), fcst('4'))?.condition, 'overcast')
})
test('응답 가공: 관측된 강수가 하늘보다 우선, 예보의 강수는 쓰지 않는다', () => {
  assert.equal(toWeather(ncst('9', '1'), fcst('1'))?.condition, 'rain')
  assert.equal(toWeather(ncst('0', '3'), fcst('1'))?.condition, 'snow')
  assert.equal(toWeather(ncst('2', '2'), null)?.condition, 'sleet')
  assert.equal(precipCondition('7'), 'snow')
  assert.equal(precipCondition('0'), null)
  assert.equal(skyCondition('2'), 'clear')
})
test('응답 가공: 예보가 없으면 상태만 비우고, 실황이 없거나 이상하면 null', () => {
  assert.deepEqual(toWeather(ncst('11', '0'), null), { tempC: 11, condition: null, observedAt: '202611191400' })
  assert.equal(toWeather(null, fcst('1')), null)
  assert.equal(toWeather({ response: { header: { resultCode: '03' } } }, null), null)
  assert.equal(toWeather(ncst('-999', '0'), null), null)
  assert.equal(toWeather(wrap([{ category: 'PTY', obsrValue: '0' }]), null), null)
})

test('주의: 비·눈·기온 33℃ 이상만, 맑은 날은 없다', () => {
  assert.equal(advisoryOf({ tempC: 18, condition: 'clear' }), null)
  assert.equal(advisoryOf({ tempC: 32, condition: 'clear' }), null)
  assert.equal(advisoryOf({ tempC: 33, condition: 'clear' })?.kind, 'hot')
  assert.equal(advisoryOf({ tempC: 10, condition: 'rain' })?.kind, 'rain')
  assert.equal(advisoryOf({ tempC: 0, condition: 'sleet' })?.kind, 'snow')
  assert.equal(advisoryOf({ tempC: -3, condition: 'snow' })?.kind, 'snow')
  assert.equal(advisoryOf({ tempC: 20, condition: null }), null)
  for (const d of Object.values(DEMO_VALUES)) assert.ok(advisoryOf(d), '시연 값은 모두 주의가 뜬다')
  assert.ok(!/폭염|특보/.test(advisoryOf({ tempC: 36, condition: 'clear' })!.text), '특보 근거 없이 공식 용어를 쓰지 않는다')
})

test('머리줄 문구', () => {
  assert.deepEqual(headline({ tempC: 18, condition: 'clear' }), { main: '용봉동 18° 맑음', extra: null })
  assert.deepEqual(headline({ tempC: 14, condition: 'rain' }), { main: '용봉동 14° 비', extra: '경사로가 미끄러울 수 있어요' })
  assert.equal(headline({ tempC: 5, condition: null }).main, '용봉동 5°')
  assert.equal(cardLines({ tempC: 18, condition: 'clear' }).sub, null)
  assert.equal(iconOf('clear'), 'sun')
  assert.equal(iconOf(null), 'cloud')
})

test('중계 응답 검증', () => {
  assert.deepEqual(parseWeather({ ok: true, tempC: 12.4, condition: 'rain', observedAt: 'x' }), { tempC: 12, condition: 'rain' })
  assert.equal(parseWeather({ ok: true, tempC: 12, condition: 'alien' })?.condition, null)
  assert.equal(parseWeather({ ok: false }), null)
  assert.equal(parseWeather({ ok: true, tempC: 'x' }), null)
  assert.equal(parseWeather({ ok: true, tempC: 300 }), null)
})

test('키워드 검색: 날씨 질문은 weather, 신고 말투는 신고 그대로', () => {
  for (const q of ['오늘 날씨 어때요', '날씨 알려줘', '지금 비 와요?', '우산 챙겨야 해요', '기온이 몇 도예요']) assert.equal(keywordIntent(q).intent, 'weather', q)
  assert.equal(keywordIntent('비 와서 경사로가 막혔어요').intent, 'report_new')
  assert.notEqual(keywordIntent('경사로 신고할래요').intent, 'weather')
})
