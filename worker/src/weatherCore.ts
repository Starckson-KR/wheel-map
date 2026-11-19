// 날씨 공급자(기상청 단기예보 조회서비스) 순수 부분: 격자 변환, 요청 주소, 응답 가공. 네트워크·저장소 의존이 없어 시험하기 쉽다.
// Worker(weather.ts)와 개발 서버 중계(scripts/weatherClient.ts)가 같이 쓴다. 공급자를 바꿔 끼우려면 이 파일의 toWeather까지만 새로 만들면 된다.
//
// 출처(2026-11-19 확인)
// - 공공데이터포털 「기상청_단기예보 조회서비스」 https://www.data.go.kr/data/15084084/openapi.do
//   기본 주소 https://apis.data.go.kr/1360000/VilageFcstInfoService_2.0, 조회 항목: 초단기실황(getUltraSrtNcst), 초단기예보(getUltraSrtFcst), 단기예보, 예보버전.
//   요청 변수: ServiceKey, pageNo, numOfRows, dataType(JSON/XML), base_date(YYYYMMDD), base_time(HHMM), nx, ny.
//   (조회 항목 이름은 공식 페이지에는 한글로만 있고, 영문 경로 이름은 실제 호출로 확인했다: 키 등록 전에도 404가 아니라 키 오류가 돌아온다.)
// - 기상자료개방포털 동네예보 데이터 활용안내 https://data.kma.go.kr/community/nuriLovePopup.do
//   강수형태(PTY): 초단기실황 0 없음 1 비 2 비/눈 3 눈 / 초단기예보 0 없음 1 비 2 비/눈 3 눈 5 빗방울 6 빗방울/눈날림 7 눈날림 (4 소나기는 단기예보에만 있다)
//   하늘상태(SKY): 1 맑음 3 구름많음 4 흐림 (2 구름조금은 2019-06-04 이후 맑음에 포함)
//   초단기실황은 10분 간격 AWS 관측을 격자별로 정리해 매시 정시 자료로 제공, 초단기예보는 매시 30분 발표.
//   초단기실황에는 하늘상태가 없다(2018년 10월까지만 제공) → 하늘은 초단기예보에서 가져온다.
// - 격자 변환식: 기상청 동네예보 「격자 번호 ↔ 위·경도 변환」에 쓰는 Lambert Conformal Conic(DFS) 공식. 상수는 기상청 가이드의 공개값
//   (RE 6371.00877km, GRID 5.0km, 표준위도 30·60, 기준점 126.0E·38.0N, 기준 격자 43,136)이며 시험에서 기상청 안내 예시(청운효자동 60,127)로 맞춰 본다.
//   기상청 안내 페이지(위 활용안내)에는 변환식 본문이 없다.

export const WEATHER_BASE = 'https://apis.data.go.kr/1360000/VilageFcstInfoService_2.0'

// 용봉동 중심: 시범 지역 범위(scripts/buildWalkGraph.ts의 BBOX 남 35.163~북 35.186, 서 126.892~동 126.924)의 가운데
export const YONGBONG = { lat: 35.1745, lng: 126.908 }

export function latLonToGrid(lat: number, lon: number): { nx: number; ny: number } {
  const RE = 6371.00877
  const GRID = 5.0
  const SLAT1 = 30.0
  const SLAT2 = 60.0
  const OLON = 126.0
  const OLAT = 38.0
  const XO = 43
  const YO = 136
  const D = Math.PI / 180
  const re = RE / GRID
  const slat1 = SLAT1 * D
  const slat2 = SLAT2 * D
  const olon = OLON * D
  const olat = OLAT * D
  let sn = Math.tan(Math.PI * 0.25 + slat2 * 0.5) / Math.tan(Math.PI * 0.25 + slat1 * 0.5)
  sn = Math.log(Math.cos(slat1) / Math.cos(slat2)) / Math.log(sn)
  let sf = Math.tan(Math.PI * 0.25 + slat1 * 0.5)
  sf = (Math.pow(sf, sn) * Math.cos(slat1)) / sn
  let ro = Math.tan(Math.PI * 0.25 + olat * 0.5)
  ro = (re * sf) / Math.pow(ro, sn)
  let ra = Math.tan(Math.PI * 0.25 + lat * D * 0.5)
  ra = (re * sf) / Math.pow(ra, sn)
  let theta = lon * D - olon
  if (theta > Math.PI) theta -= 2 * Math.PI
  if (theta < -Math.PI) theta += 2 * Math.PI
  theta *= sn
  return { nx: Math.floor(ra * Math.sin(theta) + XO + 0.5), ny: Math.floor(ro - ra * Math.cos(theta) + YO + 0.5) }
}

export const YONGBONG_GRID = latLonToGrid(YONGBONG.lat, YONGBONG.lng)

// ---- 발표 시각 ----
const p2 = (n: number) => String(n).padStart(2, '0')
// 한국 시각(UTC+9) 조각. Date의 UTC 필드에 9시간을 더해 읽는다(실행 환경 시간대와 무관).
function kst(ms: number) {
  const d = new Date(ms + 9 * 3_600_000)
  return { y: d.getUTCFullYear(), mo: d.getUTCMonth() + 1, d: d.getUTCDate(), h: d.getUTCHours(), mi: d.getUTCMinutes() }
}
function stamp(ms: number, hour: number, minute: number): { date: string; time: string } {
  const k = kst(ms)
  // hour가 -1이면 전날 23시
  let { y, mo, d } = k
  let h = hour
  if (h < 0) {
    const prev = kst(ms - 86_400_000)
    ;({ y, mo, d } = prev)
    h += 24
  }
  return { date: `${y}${p2(mo)}${p2(d)}`, time: `${p2(h)}${p2(minute)}` }
}
// 초단기실황: 매시 정시 자료, 정시 10분 뒤부터 호출(기상청 활용안내). 10분 전이면 앞 시각 자료를 쓴다.
export function ncstBase(nowMs: number): { date: string; time: string } {
  const k = kst(nowMs)
  return stamp(nowMs, k.mi < 10 ? k.h - 1 : k.h, 0)
}
// 초단기예보: 매시 30분 발표, 발표 후 45분 뒤부터 호출(기상청 활용안내 「초단기예보는 매시 45분 이후」). 45분 전이면 앞 시각 30분 발표를 쓴다.
export function fcstBase(nowMs: number): { date: string; time: string } {
  const k = kst(nowMs)
  return stamp(nowMs, k.mi < 45 ? k.h - 1 : k.h, 30)
}

export function weatherUrl(op: 'getUltraSrtNcst' | 'getUltraSrtFcst', key: string, nowMs: number, grid = YONGBONG_GRID): string {
  const b = op === 'getUltraSrtNcst' ? ncstBase(nowMs) : fcstBase(nowMs)
  const q = [
    ['serviceKey', key],
    ['pageNo', '1'],
    ['numOfRows', '60'],
    ['dataType', 'JSON'],
    ['base_date', b.date],
    ['base_time', b.time],
    ['nx', String(grid.nx)],
    ['ny', String(grid.ny)],
  ]
  return `${WEATHER_BASE}/${op}?${q.map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&')}`
}

// ---- 응답 가공 ----
export type Condition = 'clear' | 'cloudy' | 'overcast' | 'rain' | 'sleet' | 'snow'
export type WeatherNow = { tempC: number; condition: Condition | null; observedAt: string }

type Item = { category?: string; obsrValue?: string; fcstValue?: string; fcstDate?: string; fcstTime?: string; baseDate?: string; baseTime?: string }
type Raw = { response?: { header?: { resultCode?: string }; body?: { items?: { item?: Item[] | Item } } } }

export function itemsOf(json: unknown): Item[] | null {
  const r = json as Raw
  if (r?.response?.header?.resultCode !== '00') return null
  const it = r.response.body?.items?.item
  return Array.isArray(it) ? it : it ? [it] : []
}

// 강수형태 코드 → 상태. 0(없음)·모르는 코드는 null.
export function precipCondition(code: string | undefined): Condition | null {
  switch (code) {
    case '1':
    case '4':
    case '5':
      return 'rain'
    case '2':
    case '6':
      return 'sleet'
    case '3':
    case '7':
      return 'snow'
    default:
      return null
  }
}
export function skyCondition(code: string | undefined): Condition | null {
  if (code === '1' || code === '2') return 'clear'
  if (code === '3') return 'cloudy'
  if (code === '4') return 'overcast'
  return null
}

// 실황(기온·강수형태)과 초단기예보(하늘상태)를 합친다. 기온이 없으면 null(날씨 줄을 보이지 않는다). 예보가 없으면 상태만 비운다.
export function toWeather(ncst: unknown, fcst: unknown): WeatherNow | null {
  const n = itemsOf(ncst)
  if (!n) return null
  const t = n.find((x) => x.category === 'T1H')
  const temp = t?.obsrValue === undefined ? NaN : Number(t.obsrValue)
  if (!Number.isFinite(temp) || temp < -60 || temp > 60) return null
  let condition = precipCondition(n.find((x) => x.category === 'PTY')?.obsrValue)
  if (!condition) {
    const f = itemsOf(fcst) ?? []
    const at = (cat: string) =>
      f
        .filter((x) => x.category === cat && x.fcstValue !== undefined)
        .sort((a, b) => `${a.fcstDate}${a.fcstTime}`.localeCompare(`${b.fcstDate}${b.fcstTime}`))[0]?.fcstValue
    condition = skyCondition(at('SKY')) // 비·눈은 지금 관측된 것만 말한다(예보의 강수는 쓰지 않는다)
  }
  const base = n[0]
  const observedAt = base?.baseDate && base.baseTime ? `${base.baseDate}${base.baseTime}` : ''
  return { tempC: Math.round(temp), condition, observedAt }
}
