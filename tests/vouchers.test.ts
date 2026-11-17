import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  accessLevel,
  attachFacilities,
  buildStores,
  isActiveFranchise,
  isGenericFacilityName,
  nameSimilar,
  roadKey,
  voucherHasAccessInfo,
  voucherLabel,
  type FacilityLite,
  type RawFranchise,
  type VoucherFields,
} from '../src/lib/vouchers.ts'

const raw = (o: Partial<RawFranchise>): RawFranchise => ({
  alt_text: 'id' + Math.random().toString(36).slice(2, 10),
  brno: 'B1',
  bzmn_stts: '01',
  frcs_reg_se: '01',
  frcs_nm: '가게',
  frcs_addr: '광주 북구 비엔날레로 108',
  frcs_dtl_addr: '(용봉동)',
  frcs_stlm_info_se_nm: '카드',
  usage_rgn_cd: '12300',
  ksic_cd_nm: '소매업; 자동차 제외',
  lat: 35.18,
  lot: 126.89,
  crtr_ymd: '20260101',
  ...o,
})
const fac = (o: Partial<FacilityLite> & { type?: string; evalInfo?: string | null }): FacilityLite => ({
  id: o.id ?? 'F1',
  name: o.name ?? '가게',
  lat: o.lat ?? 35.18,
  lng: o.lng ?? 126.89,
  address: o.address ?? '전남광주통합특별시 북구 비엔날레로 108 (용봉동)',
  fields: { faclTyCd: o.type ?? '수퍼마켓·일용품 등의 소매점', evalInfo: o.evalInfo === undefined ? '주출입구 높이차이 제거, 주출입구(문)' : o.evalInfo },
})

test('가맹 중 거르기: 폐업·가맹 해지는 빼고 변경은 둔다', () => {
  assert.equal(isActiveFranchise(raw({})), true)
  assert.equal(isActiveFranchise(raw({ frcs_reg_se: '02' })), true)
  assert.equal(isActiveFranchise(raw({ bzmn_stts: '03' })), false)
  assert.equal(isActiveFranchise(raw({ bzmn_stts: '02' })), false)
  assert.equal(isActiveFranchise(raw({ frcs_reg_se: '03' })), false)
})

test('상품권 표기: 확인된 지역만 이름을 붙이고, 그 밖은 결제유형만 쓴다', () => {
  assert.deepEqual(voucherLabel({ usage_rgn_cd: '12300', frcs_stlm_info_se_nm: '카드' }), ['북구 카드'])
  assert.deepEqual(voucherLabel({ usage_rgn_cd: '12300', frcs_stlm_info_se_nm: '모바일,카드' }), ['북구 모바일', '북구 카드'])
  assert.deepEqual(voucherLabel({ usage_rgn_cd: '12000', frcs_stlm_info_se_nm: '카드' }), ['카드'])
  assert.deepEqual(voucherLabel({ usage_rgn_cd: '12170', frcs_stlm_info_se_nm: '모바일' }), ['나주시 모바일'])
  assert.deepEqual(voucherLabel({ usage_rgn_cd: '11000', frcs_stlm_info_se_nm: '카드,카드' }), ['카드'])
})

test('가게 합치기: 같은 사업자·이름·주소의 카드/모바일은 한 곳, 사업자번호는 결과에 없다', () => {
  const stores = buildStores([
    raw({ alt_text: 'a1', frcs_stlm_info_se_nm: '카드', crtr_ymd: '20250101' }),
    raw({ alt_text: 'a2', frcs_stlm_info_se_nm: '모바일', crtr_ymd: '20260301' }),
    raw({ alt_text: 'a3', brno: 'B2', frcs_nm: '다른 가게' }),
    raw({ alt_text: 'a4', brno: 'B3', bzmn_stts: '03' }),
    raw({ alt_text: 'a5', brno: 'B4', lat: null }),
  ])
  assert.equal(stores.length, 2)
  const s = stores.find((x) => x.name === '가게')!
  const f = s.fields as unknown as VoucherFields
  assert.deepEqual(f.vouchers, ['북구 카드', '북구 모바일'])
  assert.equal(f.baseDate, '20260301')
  assert.equal(s.address, '광주 북구 비엔날레로 108 (용봉동)')
  assert.ok(!JSON.stringify(stores).includes('B1'))
})

test('도로명+번호 뽑기', () => {
  assert.equal(roadKey('광주 북구 우치로100번길 27 4층'), '우치로100길 27')
  assert.equal(roadKey('전남광주통합특별시 북구 우치로100번길 27'), '우치로100길 27')
  assert.equal(roadKey('전남광주통합특별시 북구 매곡로 13-1 (용봉동)'), '매곡로 13-1')
  assert.equal(roadKey('광주 북구 설죽로 173 (용봉동)'), '설죽로 173')
  assert.equal(roadKey('광주 북구 용봉동 300번지'), null)
})

test('이름 비교', () => {
  assert.equal(nameSimilar('고수닭갈비(전남대점)', '고수닭갈비'), true)
  assert.equal(nameSimilar('영암 마트 삼성점', '영암마트삼성점'), true)
  assert.equal(nameSimilar('블랙야크 광주용봉점', '다이나핏'), false)
  assert.equal(nameSimilar('가', '가나다'), false)
  assert.equal(isGenericFacilityName('일반음식점', '일반음식점'), true)
  assert.equal(isGenericFacilityName('용봉동 1354-2 제2종근린생활시설 (김삼두)', '일반음식점'), true)
  assert.equal(isGenericFacilityName('영암마트', '수퍼마켓·일용품 등의 소매점'), false)
})

test('짝짓기: 같은 주소에 이름이 같으면 연결, 접근 정보 단계가 정해진다', () => {
  const stores = buildStores([raw({ alt_text: 's1', frcs_nm: '영암마트 삼성점', frcs_addr: '광주 북구 매곡로 13-1', frcs_dtl_addr: '(용봉동)' })])
  const out = attachFacilities(stores, [fac({ name: '영암마트삼성점', address: '전남광주통합특별시 북구 매곡로 13-1 (용봉동)' })])
  const f = out[0].fields as unknown as VoucherFields
  assert.equal(f.facility?.basis, 'address')
  assert.equal(f.access, 'info')
  assert.equal(voucherHasAccessInfo(out[0]), true)
  assert.equal((stores[0].fields as unknown as VoucherFields).facility, null) // 원본은 그대로
})

test('짝짓기: 같은 주소라도 이름이 다르면 연결 안 함', () => {
  const stores = buildStores([raw({ frcs_nm: '다이나핏', frcs_addr: '광주 북구 설죽로 197' })])
  const out = attachFacilities(stores, [fac({ name: '블랙야크', address: '전남광주통합특별시 북구 설죽로 197' })])
  assert.equal((out[0].fields as unknown as VoucherFields).facility, null)
  assert.equal((out[0].fields as unknown as VoucherFields).access, 'none')
})

test('짝짓기: 업종 이름만 있는 시설은 같은 주소에 어울리는 가게가 하나뿐일 때만 연결', () => {
  const type = '수퍼마켓·일용품 등의 소매점'
  const f1 = fac({ name: type, type, address: '전남광주통합특별시 북구 저불로 7' })
  const one = attachFacilities(buildStores([raw({ frcs_nm: '광산유리', frcs_addr: '광주 북구 저불로 7' })]), [f1])
  assert.equal((one[0].fields as unknown as VoucherFields).facility?.id, 'F1')
  const two = attachFacilities(buildStores([raw({ brno: 'X', frcs_nm: '가', frcs_addr: '광주 북구 저불로 7' }), raw({ brno: 'Y', frcs_nm: '나', frcs_addr: '광주 북구 저불로 7' })]), [f1])
  assert.ok(two.every((s) => (s.fields as unknown as VoucherFields).facility === null))
  // 업종이 안 맞으면(음식점인데 소매점 시설) 연결 안 함
  const cat = attachFacilities(buildStores([raw({ frcs_nm: '밥집', frcs_addr: '광주 북구 저불로 7', ksic_cd_nm: '음식점 및 주점업' })]), [f1])
  assert.equal((cat[0].fields as unknown as VoucherFields).facility, null)
})

test('짝짓기: 화장실·대피소 같은 유형은 가게와 연결하지 않는다', () => {
  const stores = buildStores([raw({ frcs_nm: '공중화장실 옆 가게', frcs_addr: '광주 북구 저불로70번길 14' })])
  const out = attachFacilities(stores, [fac({ name: '공중화장실', type: '공중화장실', address: '전남광주통합특별시 북구 저불로70번길 14 (용봉동)' })])
  assert.equal((out[0].fields as unknown as VoucherFields).facility, null)
})

test('짝짓기: 주소 표기가 달라도 이름이 같고 80m 안이면 연결, 멀면 안 함', () => {
  const stores = buildStores([raw({ frcs_nm: '석구고기', frcs_addr: '광주 북구 용봉동 111', ksic_cd_nm: '음식점 및 주점업', lat: 35.18, lot: 126.89 })])
  const type = '일반음식점'
  const near = attachFacilities(stores, [fac({ name: '석구고기', type, address: '전남광주통합특별시 북구 우치로110번길 31', lat: 35.1803, lng: 126.8901 })])
  assert.equal((near[0].fields as unknown as VoucherFields).facility?.basis, 'name')
  const far = attachFacilities(stores, [fac({ name: '석구고기', type, address: '전남광주통합특별시 북구 우치로110번길 31', lat: 35.19, lng: 126.9 })])
  assert.equal((far[0].fields as unknown as VoucherFields).facility, null)
})

test('한 가게에 시설 두 곳이 겹치면 둘 다 취소', () => {
  const stores = buildStores([raw({ frcs_nm: '영암마트', frcs_addr: '광주 북구 비엔날레로 64' })])
  const a = fac({ id: 'A', name: '영암마트', address: '전남광주통합특별시 북구 비엔날레로 64' })
  const b = fac({ id: 'B', name: '영암마트', address: '전남광주통합특별시 북구 비엔날레로 64' })
  assert.equal((attachFacilities(stores, [a, b])[0].fields as unknown as VoucherFields).facility, null)
})

test('접근 정보 단계: 높이차이 제거 등록=정보 있음, 짝만 있으면 일부 확인, 없으면 확인 필요', () => {
  assert.equal(accessLevel('주출입구 높이차이 제거, 주출입구(문)', true), 'info')
  assert.equal(accessLevel('주출입구(문)', true), 'partial')
  assert.equal(accessLevel(null, true), 'partial') // 상세 미조회
  assert.equal(accessLevel('주출입구 높이차이 제거', false), 'none')
})
