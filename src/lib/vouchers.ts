// 상품권(지역사랑상품권) 가맹점 레이어: 한국조폐공사 통합 가맹점기본정보 응답을 거르고, 장애인편의시설과 짝짓는 순수 함수들.
// 사전 수집 스크립트(scripts/prefetch.ts vouchers)와 화면이 같이 쓴다. 키·네트워크 호출은 여기 없다.
import type { PubItem } from './publicLayers'

/** 응답의 필요한 필드만(영문 이름은 2026-11-17 실제 응답으로 확인). 사업자번호·전화·우편번호는 일부러 뺀다. */
export type RawFranchise = {
  alt_text?: string
  brno?: string | null // 같은 가게의 카드·모바일 행을 합치는 데만 쓰고 저장하지 않는다
  bzmn_stts?: string // 사업자상태 01 계속, 02 휴업, 03 폐업
  frcs_reg_se?: string // 가맹점등록구분 01 신규, 02 변경, 03 해지
  frcs_nm?: string
  frcs_addr?: string
  frcs_dtl_addr?: string | null
  frcs_stlm_info_se_nm?: string // 결제유형구분명 카드·모바일·지류
  usage_rgn_cd?: string // 사용처지역코드 5자리
  ksic_cd_nm?: string // 표준산업분류코드명(대분류 수준)
  lat?: number | null
  lot?: number | null
  crtr_ymd?: string
}

/** 가맹 중인 가게만: 가맹 해지(03)와 폐업(03)은 뺀다. 휴업(02)은 일시적이라 두지 않는다(01만). */
export function isActiveFranchise(r: RawFranchise): boolean {
  return r.bzmn_stts === '01' && r.frcs_reg_se !== '03'
}

// 사용처지역코드 → 이름. 12300(북구)·12170(나주시)는 교육부 시도시군구코드표로 확인. 그 밖은 이름을 붙이지 않는다.
const REGION_NAME: Record<string, string> = { '12300': '북구', '12170': '나주시' }

/** "북구 카드", "카드(지역코드 12000)" 같은 짧은 표기 */
export function voucherLabel(r: Pick<RawFranchise, 'usage_rgn_cd' | 'frcs_stlm_info_se_nm'>): string[] {
  const kinds = String(r.frcs_stlm_info_se_nm ?? '').split(',').map((s) => s.trim()).filter(Boolean)
  const code = String(r.usage_rgn_cd ?? '')
  const region = REGION_NAME[code]
  const out = (kinds.length ? kinds : ['종류 미상']).map((k) => (region ? `${region} ${k}` : k))
  return [...new Set(out)]
}

const clean = (s: unknown) => String(s ?? '').replace(/\s+/g, ' ').trim()

export type VoucherFields = {
  category: string
  vouchers: string[]
  baseDate: string
  facility: null | { id: string; name: string; type: string; evalInfo: string | null; basis: 'address' | 'name' }
  access: 'info' | 'partial' | 'none'
}

/** 가게 단위로 합치기(같은 사업자·주소의 카드/모바일/지류 행은 한 곳으로). 가맹 중인 행만. */
export function buildStores(raw: RawFranchise[]): PubItem[] {
  const by = new Map<string, PubItem>()
  for (const r of raw) {
    if (!isActiveFranchise(r)) continue
    if (typeof r.lat !== 'number' || typeof r.lot !== 'number') continue
    const addr = clean(`${clean(r.frcs_addr)} ${clean(r.frcs_dtl_addr)}`)
    const name = clean(r.frcs_nm)
    if (!name) continue
    const key = `${r.brno ?? ''}|${name}|${addr}`
    const labels = voucherLabel(r)
    const hit = by.get(key)
    if (hit) {
      const f = hit.fields as unknown as VoucherFields
      for (const l of labels) if (!f.vouchers.includes(l)) f.vouchers.push(l)
      if ((r.crtr_ymd ?? '') > f.baseDate) f.baseDate = r.crtr_ymd ?? ''
      continue
    }
    const fields: VoucherFields = { category: clean(r.ksic_cd_nm), vouchers: [...labels], baseDate: r.crtr_ymd ?? '', facility: null, access: 'none' }
    by.set(key, { id: String(r.alt_text ?? key).slice(0, 12), name, lat: r.lat, lng: r.lot, address: addr, fields: fields as unknown as Record<string, unknown> })
  }
  return [...by.values()].sort((a, b) => a.name.localeCompare(b.name, 'ko') || a.id.localeCompare(b.id))
}

// ---------- 편의시설과 짝짓기 ----------

/** 도로명 주소에서 "도로명+건물번호"만 뽑는다. 못 뽑으면 null. 예) "광주 북구 우치로100번길 27 4층" → "우치로100번길 27" */
export function roadKey(address: string): string | null {
  const m = String(address).match(/([가-힣]+(?:\d+번?길)?(?:로|길)(?:\d+번?길)?)\s*(\d+(?:-\d+)?)(?![\d가-힣])/)
  if (!m) return null
  return `${m[1].replace(/번길/g, '길')} ${m[2]}`
}

/** 비교용 이름: 괄호·공백·기호를 지우고 소문자로 */
export function normName(s: string): string {
  return String(s).replace(/\([^)]*\)/g, '').replace(/[^0-9A-Za-z가-힣]/g, '').toLowerCase()
}

/** 시설명이 건물 대장 이름·업종 이름이라 가게 이름으로 쓸 수 없는 경우 */
export function isGenericFacilityName(name: string, type: string): boolean {
  const n = String(name).trim()
  if (!n) return true
  if (n === type) return true
  if (/근린생활시설|공동주택|^용봉동 ?\d|^공중화장실$|·/.test(n)) return true
  return false
}

export function nameSimilar(a: string, b: string): boolean {
  const x = normName(a)
  const y = normName(b)
  if (x.length < 3 || y.length < 3) return x === y && x.length > 0
  return x === y || x.includes(y) || y.includes(x)
}

// 편의시설 유형 → 어울리는 가맹점 업종(ksic 대분류 이름에 들어 있어야 함). 여기에 없는 유형(화장실·대피소·아파트·종교 등)은 짝짓지 않는다.
const TYPE_TO_KSIC: [string, string[]][] = [
  ['수퍼마켓·일용품 등의 소매점', ['소매업']],
  ['일반음식점', ['음식점']],
  ['휴게음식점·제과점', ['음식점']],
  ['병원·치과병원', ['보건업']],
  ['의원·치과의원', ['보건업']],
  ['교육원(연수원등)', ['교육 서비스업']],
  ['목욕장', ['기타 개인 서비스업']],
  ['일반숙박시설', ['숙박업']],
]
function ksicOk(facType: string, category: string): boolean {
  const row = TYPE_TO_KSIC.find(([t]) => facType.startsWith(t))
  return !!row && row[1].some((k) => category.includes(k))
}

export type FacilityLite = { id: string; name: string; lat: number | null; lng: number | null; address: string; fields: Record<string, unknown> }

const rad = (d: number) => (d * Math.PI) / 180
export function distM(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const dLat = rad(b.lat - a.lat)
  const dLng = rad(b.lng - a.lng)
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2
  return 2 * 6371000 * Math.asin(Math.sqrt(h))
}

export const NAME_MATCH_RADIUS_M = 80

/** 편의시설 한 곳과 짝이 될 가게 하나를 고른다. 확실하지 않으면 null(연결 안 함). */
export function pickStoreFor(fac: FacilityLite, stores: PubItem[]): { store: PubItem; basis: 'address' | 'name' } | null {
  const type = String(fac.fields['faclTyCd'] ?? '')
  if (!TYPE_TO_KSIC.some(([t]) => type.startsWith(t))) return null
  const ok = stores.filter((s) => ksicOk(type, String((s.fields as unknown as VoucherFields).category)))
  const fk = roadKey(fac.address)
  const generic = isGenericFacilityName(fac.name, type)

  if (fk) {
    const same = ok.filter((s) => roadKey(s.address) === fk)
    if (generic) {
      if (same.length === 1) return { store: same[0], basis: 'address' } // 같은 번지에 어울리는 가게가 하나뿐일 때만
    } else {
      const named = same.filter((s) => nameSimilar(s.name, fac.name))
      if (named.length === 1) return { store: named[0], basis: 'address' }
    }
  }
  // 주소가 달라도(표기 차이) 이름이 같고 가까우면
  if (!generic && fac.lat != null && fac.lng != null) {
    const near = ok.filter((s) => nameSimilar(s.name, fac.name) && distM({ lat: fac.lat as number, lng: fac.lng as number }, { lat: s.lat as number, lng: s.lng as number }) <= NAME_MATCH_RADIUS_M)
    if (near.length === 1) return { store: near[0], basis: 'name' }
  }
  return null
}

/** 높이차이 제거가 등록돼 있으면 "info", 짝은 있는데 그 항목이 없으면 "partial", 짝이 없으면 "none" */
export function accessLevel(evalInfo: string | null | undefined, matched: boolean): VoucherFields['access'] {
  if (!matched) return 'none'
  return typeof evalInfo === 'string' && evalInfo.includes('주출입구 높이차이 제거') ? 'info' : 'partial'
}

/** 가게마다 편의시설 짝을 붙인다. 한 가게에 시설이 둘 이상 겹치면 둘 다 취소(애매함). 원본은 바꾸지 않는다. */
export function attachFacilities(stores: PubItem[], facilities: FacilityLite[]): PubItem[] {
  const claims = new Map<string, { fac: FacilityLite; basis: 'address' | 'name' }[]>()
  for (const fac of facilities) {
    const p = pickStoreFor(fac, stores)
    if (!p) continue
    const arr = claims.get(p.store.id) ?? []
    arr.push({ fac, basis: p.basis })
    claims.set(p.store.id, arr)
  }
  return stores.map((s) => {
    const f = s.fields as unknown as VoucherFields
    const c = claims.get(s.id)
    const one = c && c.length === 1 ? c[0] : null
    const evalInfo = one ? ((one.fac.fields['evalInfo'] as string | null | undefined) ?? null) : null
    const next: VoucherFields = {
      ...f,
      vouchers: [...f.vouchers],
      facility: one ? { id: one.fac.id, name: one.fac.name, type: String(one.fac.fields['faclTyCd'] ?? ''), evalInfo, basis: one.basis } : null,
      access: accessLevel(evalInfo, !!one),
    }
    return { ...s, fields: next as unknown as Record<string, unknown> }
  })
}

export const voucherAccess = (it: PubItem): VoucherFields['access'] => ((it.fields as unknown as VoucherFields).access ?? 'none')
/** 휠체어 접근 정보가 있는 가맹점(높이차이 제거가 등록된 곳) */
export const voucherHasAccessInfo = (it: PubItem) => voucherAccess(it) === 'info'
