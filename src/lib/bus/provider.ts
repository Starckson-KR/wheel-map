import snap from '../../../data/public/bus-snapshot.json'
import { ACCOUNT_URL } from '../config.ts'
import { sameLine } from './types.ts'
import type { Arrival,ArrivalResult, LineLow, LineLowResult } from './types.ts'

// 저상버스 도착 정보 공급자(7단계). 화면은 이 인터페이스만 쓴다.
//  - 개발 서버(npm run dev): vite 중계(/__bis/*)로 광주 BIS를 부른다. 키는 서버에만 있고 25초 캐시·하루 상한이 있다.
//  - 배포(GitHub Pages): Cloudflare Worker(worker/src/bis.ts)의 /bis/arrive, /bis/line을 부른다(키는 Worker secret, 25초 캐시·하루 상한·IP 제한).
//    중계가 실패하거나 한도에 닿으면 미리 받아 둔 한 시점 스냅샷(data/public/bus-snapshot.json)으로 돌아간다.
//  - VITE_BUS_RELAY_URL을 주면 어느 모드에서든 그 주소를 먼저 쓴다(시험용).
//  응답 형식(개발 중계·Worker 공통):
//   GET <중계주소>/arrive?station=<BIS 정류소 id>  → { stationId, collectedAt, arrivals: Arrival[] }
//   GET <중계주소>/line?name=<노선 이름>            → { lineName, total, low, collectedAt }

type SnapStation = { name: string; collectedAt: string; arrivals: Arrival[] }
type Snap = { collectedAt: string; stations: Record<string, SnapStation>; lines: Record<string, LineLow> }
const SNAP = snap as unknown as Snap

export const SNAPSHOT_AT: string = SNAP.collectedAt
export const hasSnapshot = (stationId: string) => stationId in SNAP.stations

const RELAY_ENV = (import.meta.env as Record<string, string | undefined>).VITE_BUS_RELAY_URL
// 우선순위: 환경변수 주소 > 개발 서버 중계 > 배포 Worker(ACCOUNT_URL/bis)
const relayBase: string | null = RELAY_ENV ? RELAY_ENV.replace(/\/+$/, '') : import.meta.env?.DEV ? '/wheel-map/__bis' : `${ACCOUNT_URL}/bis`

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
  const d = SNAP.lines[lineName] ?? Object.values(SNAP.lines).find((l) => sameLine(l.lineName, lineName))
  if (d) return { ok: true, mode: 'snapshot', data: d }
  return { ok: false, reason: 'no-snapshot', message: '이 노선의 운행 정보가 없어요.' }
}
