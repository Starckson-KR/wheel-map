import snap from '../../../data/public/bus-snapshot.json'
import type { Arrival, ArrivalResult, LineLow, LineLowResult } from './types.ts'

// 저상버스 도착 정보 공급자(7단계). 화면은 이 인터페이스만 쓴다.
//  - 개발 서버(npm run dev): vite 중계(/__bis/*)로 광주 BIS를 부른다. 키는 서버에만 있고 25초 캐시·하루 상한이 있다.
//  - 배포(GitHub Pages): 서버가 없어 실시간이 불가능 → 미리 받아 둔 한 시점 스냅샷(data/public/bus-snapshot.json)만 보여 준다.
//
// 실시간을 배포판에도 붙이는 방법(메모): Cloudflare Workers(무료 하루 10만 요청) 같은 HTTPS 중계에
//   GET <중계주소>/arrive?station=<BIS 정류소 id>  → { stationId, collectedAt, arrivals: Arrival[] }
//   GET <중계주소>/line?name=<노선 이름>            → { lineName, total, low, collectedAt }
// 를 만들고(공공데이터 serviceKey는 Workers 비밀 변수로, CORS는 이 사이트 주소만 허용, 25초 캐시),
// 빌드 환경변수 VITE_BUS_RELAY_URL에 그 주소를 넣으면 이 파일이 자동으로 실시간 공급자를 쓴다.
// 응답 형식은 scripts/bisClient.ts의 반환값과 같다. 토스 앱 안에서는 토스가 허용한 도메인·약관 확인이 먼저 필요하다.

type SnapStation = { name: string; collectedAt: string; arrivals: Arrival[] }
type Snap = { collectedAt: string; stations: Record<string, SnapStation>; lines: Record<string, LineLow> }
const SNAP = snap as unknown as Snap

export const SNAPSHOT_AT: string = SNAP.collectedAt
export const hasSnapshot = (stationId: string) => stationId in SNAP.stations

const RELAY_ENV = (import.meta.env as Record<string, string | undefined>).VITE_BUS_RELAY_URL
// 개발 서버가 아니면(배포 빌드) 중계 주소는 환경변수로 준 것만 쓴다.
const relayBase: string | null = import.meta.env.DEV ? '/wheel-map/__bis' : RELAY_ENV ? RELAY_ENV.replace(/\/+$/, '') : null

export const LIVE_AVAILABLE = relayBase !== null

function fromSnapshot(stationId: string, why: string): ArrivalResult {
  const s = SNAP.stations[stationId]
  if (!s) return { ok: false, reason: 'no-snapshot', message: `${why} 이 정류장은 미리 받아 둔 정보도 없어요.` }
  return { ok: true, mode: 'snapshot', stationId, collectedAt: s.collectedAt, arrivals: s.arrivals }
}

async function relayJson(path: string): Promise<{ ok: true; json: unknown } | { ok: false; status: number; message: string }> {
  try {
    const r = await fetch(`${relayBase}${path}`)
    if (!r.ok) {
      const body = (await r.json().catch(() => ({}))) as { error?: string }
      const msg =
        r.status === 404 || r.status === 405
          ? '실시간 중계를 찾지 못했어요. 개발 서버를 다시 시작해야 할 수 있어요.'
          : r.status === 429
            ? '오늘 실시간 조회 한도에 닿았어요.'
            : body.error || '실시간 정보를 받지 못했어요.'
      return { ok: false, status: r.status, message: msg }
    }
    return { ok: true, json: await r.json() }
  } catch {
    return { ok: false, status: 0, message: '실시간 중계에 연결하지 못했어요.' }
  }
}

export async function getArrivals(stationId: string): Promise<ArrivalResult> {
  if (relayBase === null) return fromSnapshot(stationId, '실시간 정보는 준비 중이에요.')
  const r = await relayJson(`/arrive?station=${encodeURIComponent(stationId)}`)
  if (!r.ok) {
    const fb = fromSnapshot(stationId, r.message)
    return fb.ok ? fb : { ok: false, reason: r.status === 429 ? 'limit' : 'error', message: r.message }
  }
  const j = r.json as { collectedAt: string; arrivals: Arrival[] }
  return { ok: true, mode: 'live', stationId, collectedAt: j.collectedAt, arrivals: j.arrivals }
}

export async function getLineLow(lineName: string): Promise<LineLowResult> {
  if (relayBase !== null) {
    const r = await relayJson(`/line?name=${encodeURIComponent(lineName)}`)
    if (r.ok) return { ok: true, mode: 'live', data: r.json as LineLow }
  }
  const d = SNAP.lines[lineName]
  if (d) return { ok: true, mode: 'snapshot', data: d }
  return { ok: false, reason: 'no-snapshot', message: '이 노선의 운행 정보가 없어요.' }
}
