// 광주 북구 공공데이터(육교·장애인시설·옐로카펫·침수 이력·그늘막·대기질 신호등) 변환 함수.
// CSV 한 줄(헤더 이름 → 값)을 앱이 쓰는 PubItem으로 바꾼다. 파일에 없는 값은 만들지 않는다.
// 스크립트(scripts/prefetch.ts `bukgu`)와 시험이 같이 쓰는 순수 함수만 둔다.
import type { PubItem } from './publicLayers'

export type CsvObj = Record<string, string>
export type GeoHit = { lat: number; lng: number; matched: string }
export type Geocoder = (candidates: string[]) => Promise<GeoHit | null>

// 북구 전체를 넉넉히 덮는 범위. 이 밖의 좌표는 잘못 찾은 것으로 보고 뺀다.
const BOUNDS = { s: 35.1, n: 35.3, w: 126.8, e: 127.06 }
export const inBukgu = (lat: number, lng: number) => lat >= BOUNDS.s && lat <= BOUNDS.n && lng >= BOUNDS.w && lng <= BOUNDS.e

/** `POINT (경도 위도)` → 좌표. 형식이 다르거나 북구 밖이면 null */
export function parsePoint(s: string | undefined): { lat: number; lng: number } | null {
  const m = /^\s*POINT\s*\(\s*(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)\s*\)\s*$/i.exec(s ?? '')
  if (!m) return null
  const lng = Number(m[1])
  const lat = Number(m[2])
  return inBukgu(lat, lng) ? { lat, lng } : null
}

const numOrNull = (s: string | undefined): number | null => {
  if (s === undefined || s.trim() === '') return null
  const n = Number(s)
  return Number.isFinite(n) ? n : null
}

/** 개인 휴대폰 형태 번호는 지운다(기관 번호만 남김) */
export const cleanPhone = (p: string | undefined): string => (/^0?1[016789]/.test((p ?? '').replace(/\D/g, '')) ? '' : (p ?? '').trim())

/** 주소 끝의 공백 정리 */
const tidy = (s: string | undefined) => (s ?? '').replace(/\s+/g, ' ').trim()

export function convertOverpass(rows: CsvObj[]): PubItem[] {
  const out: PubItem[] = []
  for (const r of rows) {
    const p = parsePoint(r['지오로케이션'])
    if (!p) continue
    out.push({
      id: `overpass-${r['순번']}`,
      name: tidy(r['육교명']) || '육교',
      lat: p.lat,
      lng: p.lng,
      address: tidy(r['도로명주소']),
      fields: {
        장애인편의시설설치여부: r['장애인편의시설설치여부'] === 'Y' ? 'Y' : r['장애인편의시설설치여부'] === 'N' ? 'N' : '',
        장애인편의시설종류: tidy(r['장애인편의시설종류']),
        육교연장: numOrNull(r['육교연장']),
        육교폭: numOrNull(r['육교폭']),
        계단폭: numOrNull(r['계단폭']),
        데이터기준일자: r['데이터기준일자'] ?? '',
      },
    })
  }
  return out
}

export function convertWelfare(rows: CsvObj[]): PubItem[] {
  const out: PubItem[] = []
  for (const r of rows) {
    const p = parsePoint(r['지오로케이션'])
    if (!p) continue
    out.push({
      id: `welfare-${r['순번']}`,
      name: tidy(r['시설명']),
      lat: p.lat,
      lng: p.lng,
      address: tidy(r['주소']),
      fields: {
        구분: tidy(r['구분']),
        운영기관명: tidy(r['운영기관명']),
        전화번호: cleanPhone(r['전화번호']),
        데이터기준일자: r['데이터기준일자'] ?? '',
      },
    })
  }
  return out
}

/** 옐로카펫. 원본의 가려진 칸(`***`)은 쓰지 않는다. */
export function convertYellowCarpet(rows: CsvObj[]): PubItem[] {
  const out: PubItem[] = []
  for (const r of rows) {
    const p = parsePoint(r['지오로케이션'])
    if (!p) continue
    const school = tidy(r['인근학교명칭'])
    out.push({
      id: `yellow-${r['고유아이디']}`,
      name: school ? `${school} 인근 옐로카펫` : '옐로카펫',
      lat: p.lat,
      lng: p.lng,
      address: tidy(r['주소']),
      fields: { 인근학교명칭: school, 설치일: tidy(r['일시']) },
    })
  }
  return out
}

/** 침수 이력을 묶는 칸 크기(도). 약 100m. 같은 칸의 기록은 한 핀으로 모은다. */
export const FLOOD_CELL = 0.001

/**
 * 침수 피해 기록을 격자 칸(약 100m)별로 묶는다. 핀 좌표는 그 칸 첫 기록의 파일 값 그대로다.
 * fields.종류별: { 상가침수: 2, 주택침수: 1 }, fields.건수: 칸 안의 기록 수.
 */
/** 침수 기록의 주소에서 동 이름만 뽑아 「○○동 일대」로 만든다(집·가게 주소와 상호는 남기지 않는다) */
export function dongArea(road: string | undefined, jibun: string | undefined): string {
  const m = /\(([^()]*?[가-힣0-9]+동)\)\s*$/.exec((road ?? '').trim()) ?? /북구\s+([가-힣0-9]+동)/.exec(jibun ?? '') ?? /([가-힣0-9]+동)/.exec(road ?? '')
  return m ? `${m[1].split(/[,\s]+/).pop()} 일대` : '북구 일대'
}

export function convertFlood(rows: CsvObj[]): PubItem[] {
  const cells = new Map<string, PubItem & { fields: { 건수: number; 종류별: Record<string, number>; 발생연도: string[] } }>()
  for (const r of rows) {
    const lat = numOrNull(r['위도'])
    const lng = numOrNull(r['경도'])
    if (lat === null || lng === null || !inBukgu(lat, lng)) continue
    const key = `${Math.round(lat / FLOOD_CELL)}_${Math.round(lng / FLOOD_CELL)}`
    const kind = tidy(r['피해내용']) || '피해'
    const year = tidy(r['발생연도'])
    let c = cells.get(key)
    if (!c) {
      c = {
        id: `flood-${r['연번']}`,
        name: '',
        lat,
        lng,
        address: dongArea(r['피해위치(도로명)'], r['피해위치(지번)']),
        fields: { 건수: 0, 종류별: {}, 발생연도: [] },
      }
      cells.set(key, c)
    }
    c.fields.건수 += 1
    c.fields.종류별[kind] = (c.fields.종류별[kind] ?? 0) + 1
    if (year && !c.fields.발생연도.includes(year)) c.fields.발생연도.push(year)
  }
  const out = [...cells.values()]
  for (const c of out) c.name = `침수 피해 ${c.fields.건수}건`
  return out
}

/** 지번주소 한 줄(그늘막 원본) → 검색용 문자열 */
export const shadeQuery = (jibun: string | undefined) => tidy(jibun)

/**
 * 그늘막. 원본에 좌표가 없어 지번주소를 카카오 주소검색으로 좌표로 바꾼다(geocode는 호출 쪽에서 캐시).
 * 좌표를 못 찾았거나 북구 밖이면 뺀다. failed는 뺀 개수.
 */
export async function convertShade(rows: CsvObj[], geocode: Geocoder): Promise<{ items: PubItem[]; failed: number }> {
  const items: PubItem[] = []
  let failed = 0
  for (const r of rows) {
    const q = shadeQuery(r['설치위치지번주소'])
    // 카카오가 새 행정구역 이름을 못 찾는 주소는 옛 이름(광주광역시)으로 한 번 더 찾는다
    const g = q ? await geocode([q, q.replace('전남광주통합특별시', '광주광역시')]) : null
    if (!g || !inBukgu(g.lat, g.lng)) {
      failed++
      continue
    }
    items.push({
      id: `shade-${r['관리번호']}`,
      name: tidy(r['설치장소명']) || '그늘막',
      lat: g.lat,
      lng: g.lng,
      address: q,
      fields: { 종류: tidy(r['종류']), 읍면동: tidy(r['읍면동']), 설치일자: tidy(r['설치일자']), geocoded: true, geocodeQuery: g.matched },
    })
  }
  return { items, failed }
}

/** 대기질 신호등: 측정 기록에서 설치 위치(고유한 이름·좌표)만 뽑는다. 측정값은 쓰지 않는다. */
export function airSignalStations(rows: CsvObj[]): PubItem[] {
  const seen = new Map<string, PubItem>()
  for (const r of rows) {
    const lat = numOrNull(r['위도(설치장소)'])
    const lng = numOrNull(r['경도(설치장소)'])
    const raw = tidy(r['신호등명'])
    if (lat === null || lng === null || !raw || !inBukgu(lat, lng)) continue
    const key = `${raw}|${lat}|${lng}`
    if (seen.has(key)) continue
    seen.set(key, {
      id: `airsignal-${seen.size + 1}`,
      name: raw.replace(/_?신호등$/, '').trim() || raw,
      lat,
      lng,
      address: tidy(r['설치장소']),
      fields: {},
    })
  }
  // 파일 순서와 상관없이 같은 결과가 나오도록 이름순으로 번호를 붙인다
  return [...seen.values()].sort((a, b) => a.name.localeCompare(b.name, 'ko')).map((it, i) => ({ ...it, id: `airsignal-${i + 1}` }))
}

// ---------- 광주 C-ITS (스쿨존·주정차 단속구간) ----------
/** C-ITS 응답 한 건(필요한 칸만) */
export type CitsZone = { zoneId?: string | number; name?: string; address?: string; latitude?: string | number; longitude?: string | number }

const zoneCoord = (z: CitsZone) => {
  const lat = Number(z.latitude)
  const lng = Number(z.longitude)
  return Number.isFinite(lat) && Number.isFinite(lng) && inBukgu(lat, lng) ? { lat, lng } : null
}

/** 어린이보호구역. 주소에 `북구`가 있는 곳만 남긴다. 구역 모양(offset)은 쓰지 않고 대표 좌표 한 점만 쓴다. */
export function convertSchoolZone(zones: CitsZone[]): PubItem[] {
  const out: PubItem[] = []
  for (const z of zones) {
    const c = zoneCoord(z)
    const address = tidy(z.address)
    if (!c || !/북구/.test(address)) continue
    out.push({ id: `school-${z.zoneId}`, name: tidy(z.name) || '어린이보호구역', lat: c.lat, lng: c.lng, address, fields: {} })
  }
  return out
}

/** 주정차 단속구간. 주소가 없어 북구 여부는 호출 쪽이 좌표로 판별해 넘긴다(isBukgu). */
export function convertParkingZone(zones: CitsZone[], isBukgu: (lat: number, lng: number, z: CitsZone) => boolean): PubItem[] {
  const out: PubItem[] = []
  for (const z of zones) {
    const c = zoneCoord(z)
    if (!c || !isBukgu(c.lat, c.lng, z)) continue
    out.push({ id: `parking-${z.zoneId}`, name: tidy(z.name) || '주정차 단속구간', lat: c.lat, lng: c.lng, address: '', fields: {} })
  }
  return out
}
