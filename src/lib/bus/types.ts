// 저상버스 도착 정보(7단계). 브라우저와 Node(개발 중계·prefetch)가 함께 쓰는 형식.
// 광주 BIS arriveInfo: LOW_BUS "1" = 저상(실제 응답 관찰 기준, 활용가이드에 값 설명 없음)

export type Arrival = {
  lineId: string
  lineName: string // 예: 마을777, 419
  remainMin: number | null // 도착까지 남은 분
  remainStop: number | null // 몇 정거장 전
  low: boolean // 저상버스 여부
  kind?: number | null // LINE_KIND(노선 종류 코드, 의미는 가이드에 없음)
  dirEnd?: string // 종점(방면)
}

export type ArrivalOk = {
  ok: true
  mode: 'live' | 'snapshot'
  stationId: string
  collectedAt: string // ISO
  arrivals: Arrival[]
}
export type ArrivalFail = { ok: false; reason: 'unavailable' | 'no-snapshot' | 'error' | 'limit'; message: string }
export type ArrivalResult = ArrivalOk | ArrivalFail

// 노선별 운행 중 저상 비율(busLocationInfo의 LOW_BUS 집계)
export type LineLow = { lineName: string; total: number; low: number; collectedAt: string }
export type LineLowResult = { ok: true; mode: 'live' | 'snapshot'; data: LineLow } | ArrivalFail

export type StopRef = { stationId: string; name: string; ars?: string; next?: string; distM: number }

/** 가장 빨리 오는 저상버스(없으면 null) */
export function nextLow(arrivals: Arrival[], lineName?: string): Arrival | null {
  const list = arrivals.filter((a) => a.low && a.remainMin != null && (!lineName || a.lineName === lineName))
  list.sort((a, b) => (a.remainMin as number) - (b.remainMin as number))
  return list[0] ?? null
}

export function arrivalText(a: Arrival): string {
  const t = a.remainMin == null ? '도착 정보 없음' : a.remainMin <= 1 ? '곧 도착' : `${a.remainMin}분 후`
  const s = a.remainStop != null && a.remainStop > 0 ? `(${a.remainStop}정거장 전)` : ''
  return `${a.lineName}번 ${t}${s}`
}
