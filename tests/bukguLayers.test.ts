import { test } from 'node:test'
import assert from 'node:assert/strict'
import { airSignalStations, cleanPhone, convertFlood, dongArea, convertOverpass, convertShade, convertWelfare, convertYellowCarpet, parsePoint } from '../src/lib/bukguLayers.ts'

test('POINT는 경도 위도 순서로 읽고, 형식이 다르거나 북구 밖이면 버린다', () => {
  assert.deepEqual(parsePoint('POINT (126.9188728 35.18389596)'), { lat: 35.18389596, lng: 126.9188728 })
  assert.equal(parsePoint('POINT (35.18 126.91)'), null) // 순서가 뒤바뀐 값
  assert.equal(parsePoint('35.18,126.91'), null)
  assert.equal(parsePoint(''), null)
  assert.equal(parsePoint(undefined), null)
})

test('육교: 좌표·편의시설 여부를 파일 값 그대로 옮긴다', () => {
  const [it] = convertOverpass([
    { 순번: '1', 육교명: '청소년수련관앞육교', 도로명주소: '전남광주통합특별시 북구 천지인로173번길 10', 육교연장: '22', 육교폭: '2.4', 계단폭: '3.3', 장애인편의시설설치여부: 'N', 장애인편의시설종류: '없음', 데이터기준일자: '2023-06-30', 지오로케이션: 'POINT (126.9188728 35.18389596)' },
    { 순번: '2', 육교명: '좌표 없음', 지오로케이션: '' },
  ])
  assert.equal(it.id, 'overpass-1')
  assert.equal(it.lat, 35.18389596)
  assert.equal(it.fields['장애인편의시설설치여부'], 'N')
  assert.equal(it.fields['육교폭'], 2.4)
})

test('장애인시설: 휴대폰 번호는 지우고 기관 번호만 둔다', () => {
  assert.equal(cleanPhone('062-513-0977'), '062-513-0977')
  assert.equal(cleanPhone('010-1234-5678'), '')
  const items = convertWelfare([{ 순번: '1', 시설명: '복지관', 구분: '재활시설', 주소: '북구 어딘가', 운영기관명: '기관', 전화번호: '010-1111-2222', 지오로케이션: 'POINT (126.87 35.18)' }])
  assert.equal(items[0].fields['전화번호'], '')
})

test('옐로카펫: 가려진 칸(***)은 쓰지 않는다', () => {
  const [it] = convertYellowCarpet([{ 고유아이디: '1', 인근학교명칭: '문흥중앙초등학교', 일시: '2016-05-30', 주소: '북구 문산로 17', 시설관련사항값: '**자동차', 시설명: '*******센터', 지오로케이션: 'POINT (126.92 35.18)' }])
  assert.equal(it.name, '문흥중앙초등학교 인근 옐로카펫')
  assert.equal(JSON.stringify(it).includes('*'), false)
})

test('침수 이력: 가까운 기록은 한 핀으로 묶고 건수를 센다(핀 좌표는 첫 기록 값)', () => {
  const base = { '피해위치(지번)': '북구 각화동 346', '피해위치(도로명)': '', 발생연도: '2025' }
  const items = convertFlood([
    { ...base, 연번: '1', 위도: '35.1850957', 경도: '126.9358172', 피해내용: '상가침수' },
    { ...base, 연번: '2', 위도: '35.1851500', 경도: '126.9358500', 피해내용: '주택침수' },
    { ...base, 연번: '3', 위도: '35.1851000', 경도: '126.9359000', 피해내용: '상가침수' },
    { ...base, 연번: '4', 위도: '35.2200000', 경도: '126.9000000', 피해내용: '농경지침수' },
    { ...base, 연번: '5', 위도: '', 경도: '', 피해내용: '상가침수' }, // 좌표 없음
  ])
  assert.equal(items.length, 2)
  const a = items[0]
  assert.equal(a.lat, 35.1850957)
  assert.equal(a.fields['건수'], 3)
  assert.deepEqual(a.fields['종류별'], { 상가침수: 2, 주택침수: 1 })
  assert.equal(a.name, '침수 피해 3건')
  assert.equal(a.address, '각화동 일대') // 상세 주소·상호는 남기지 않고 동 이름만
  assert.equal(JSON.stringify(a).includes('346'), false)
  assert.equal(dongArea('광주광역시 북구 설죽로214번길 95, 1층 , 카츠앤맘 (용봉동)', ''), '용봉동 일대')
})

test('그늘막: 주소를 좌표로 바꾸고, 못 찾았거나 북구 밖이면 뺀다', async () => {
  const rows = [
    { 관리번호: '1', 종류: '스마트형', 읍면동: '용봉동', 설치장소명: '전남대후문 앞', 설치위치지번주소: '전남광주통합특별시 북구 용봉동 191-1 ', 설치일자: '2020-08-20' },
    { 관리번호: '2', 종류: '고정형', 읍면동: '우산동', 설치장소명: '말바우', 설치위치지번주소: '못찾는 주소', 설치일자: '2018-06-12' },
    { 관리번호: '3', 종류: '고정형', 읍면동: '임동', 설치장소명: '엉뚱한 곳', 설치위치지번주소: '서울 어딘가', 설치일자: '2018-06-12' },
  ]
  const asked: string[][] = []
  const { items, failed } = await convertShade(rows, async (c) => {
    asked.push(c)
    if (c[0].includes('용봉동')) return { lat: 35.1766, lng: 126.9055, matched: c[0] }
    if (c[0].includes('서울')) return { lat: 37.5, lng: 127.0, matched: c[0] }
    return null
  })
  assert.equal(items.length, 1)
  assert.equal(failed, 2)
  assert.equal(items[0].address, '전남광주통합특별시 북구 용봉동 191-1')
  assert.equal(items[0].fields['geocoded'], true)
  assert.ok(asked[0].some((q) => q.includes('광주광역시')), '새 이름을 못 찾으면 옛 이름으로도 찾아 본다')
})

test('대기질 신호등: 측정 기록이 몇 십만 줄이어도 고유한 설치 위치만 남기고 측정값은 담지 않는다', () => {
  const rec = (name: string, lat: string, lng: string, station: string) => ({ 신호등명: name, '위도(설치장소)': lat, '경도(설치장소)': lng, 설치장소: '광주 북구 우치로 77 (용봉동)', 측정소: station, 미세먼지: '39' })
  const rows = [
    rec('북구청 교차로_신호등', '35.17353314', '126.9128822', '두암동'),
    rec('북구청 교차로_신호등', '35.17353314', '126.9128822', '서석동'),
    rec('북구청 교차로_신호등', '35.17353314', '126.9128822', '두암동'),
    rec('중흥육거리_신호등', '35.16018028', '126.910833', '서석동'),
    rec('좌표없음_신호등', '', '', '서석동'),
  ]
  const st = airSignalStations(rows)
  assert.equal(st.length, 2)
  assert.deepEqual(st.map((s) => s.name), ['북구청 교차로', '중흥육거리'])
  assert.deepEqual(st[0].fields, {})
  assert.equal(JSON.stringify(st).includes('39'), false)
})

test('C-ITS 스쿨존: 주소에 북구가 있는 곳만, 주정차 구간은 판별 함수가 북구라고 한 곳만', async () => {
  const { convertSchoolZone, convertParkingZone } = await import('../src/lib/bukguLayers.ts')
  const school = convertSchoolZone([
    { zoneId: 1, name: '용주초등학교', address: '광주광역시 북구 용주로 15', latitude: '35.18', longitude: '126.89' },
    { zoneId: 2, name: '서구 학교', address: '광주광역시 서구 어딘가', latitude: '35.15', longitude: '126.85' },
    { zoneId: 3, name: '좌표 없음', address: '광주광역시 북구 어딘가', latitude: '', longitude: '' },
  ])
  assert.deepEqual(school.map((s) => s.id), ['school-1'])
  assert.equal(school[0].lat, 35.18)
  const parking = convertParkingZone(
    [{ zoneId: 'a', name: '북구청', latitude: 35.17, longitude: 126.91 }, { zoneId: 'b', name: '다른 구', latitude: 35.16, longitude: 126.85 }],
    (_la, _ln, z) => z.zoneId === 'a',
  )
  assert.deepEqual(parking.map((p) => p.name), ['북구청'])
})
