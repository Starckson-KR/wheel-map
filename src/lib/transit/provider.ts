import stored from '../../../data/routes/transit.json'
import { ACCOUNT_URL } from '../config.ts'
import type { Place } from '../routing/provider.ts'
import type { TItinerary } from './parse.ts'

// 대중교통(버스) 경로 가져오기(7단계). 순서: 저장된 시연 경로(data/routes/transit.json) → 새 구간은 ODsay 대중교통 길찾기.
//  - 개발 서버: vite 중계(/__odsay/transit, 키는 .env의 KOREACONNECT_KEY). 못 쓰면 예비로 TMAP 중계(/__tmap/transit, 하루 10건)를 한 번 더 시도한다.
//  - 배포(GitHub Pages): Cloudflare Worker의 /transit(worker/src/transit.ts, 키는 Worker secret, 캐시·하루 상한·IP 제한).
// 키는 브라우저에 없다. 저상버스 여부는 이 경로에 없고, 화면이 광주 BIS(LOW_BUS)로 따로 채운다.

type Stored = Record<string, { fetchedAt: string; itineraries: TItinerary[]; noRoute?: string }>
const STORED = (stored as unknown as { pairs: Stored }).pairs
const STORED_PROVIDER: Provider = (stored as unknown as { provider?: string }).provider === 'tmap' ? 'tmap' : 'odsay'

type Provider = 'odsay' | 'tmap'

// 저장본이 없는 구간도 찾을 수 있다(배포판은 Worker, 개발 서버는 중계가 맡는다).
export const TRANSIT_FREE_SEARCH = true

export type TransitFetch =
  | { ok: true; itineraries: TItinerary[]; source: 'stored' | 'relay'; provider: Provider; cached?: boolean; fetchedAt?: string }
  | { ok: false; message: string }

export const hasStoredTransit = (pairId: string | null) => !!pairId && !!STORED[pairId]

/** 저장된 버스 경로의 가장 빠른 소요(초). 없으면 null(카드에 시간을 보이는 데만 쓴다) */
export function storedTransitSummary(pairId: string | null): { time: number; count: number } | null {
  const s = pairId ? STORED[pairId] : undefined
  if (!s || s.itineraries.length === 0) return null
  return { time: Math.min(...s.itineraries.map((i) => i.time)), count: s.itineraries.length }
}

type Relay = { ok: true; itineraries: TItinerary[]; cached: boolean } | { ok: false; status: number; message: string }

const FAIL = '지금은 버스 경로를 찾지 못했어요.'
const messageOf = (status: number, body: { error?: string }): string =>
  status === 429 ? body.error || '오늘 버스 경로 조회 한도에 닿았어요.' : status === 404 || status === 405 ? FAIL : body.error || FAIL

async function viaDevRelay(url: string, from: Place, to: Place): Promise<Relay> {
  try {
    const r = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: [from.lat, from.lng], to: [to.lat, to.lng] }),
    })
    const body = (await r.json().catch(() => ({}))) as { itineraries?: TItinerary[]; cached?: boolean; error?: string }
    if (!r.ok || !body.itineraries) return { ok: false, status: r.status, message: messageOf(r.status, body) }
    return { ok: true, itineraries: body.itineraries, cached: !!body.cached }
  } catch {
    return { ok: false, status: 0, message: FAIL }
  }
}

async function viaWorker(from: Place, to: Place): Promise<Relay> {
  const q = `from=${from.lat.toFixed(6)},${from.lng.toFixed(6)}&to=${to.lat.toFixed(6)},${to.lng.toFixed(6)}`
  try {
    const r = await fetch(`${ACCOUNT_URL}/transit?${q}`)
    const body = (await r.json().catch(() => ({}))) as { itineraries?: TItinerary[]; cached?: boolean; error?: string }
    if (!r.ok || !body.itineraries) return { ok: false, status: r.status, message: messageOf(r.status, body) }
    return { ok: true, itineraries: body.itineraries, cached: !!body.cached }
  } catch {
    return { ok: false, status: 0, message: FAIL }
  }
}

export async function fetchTransit(pairId: string | null, from: Place, to: Place, allowRelay: boolean): Promise<TransitFetch> {
  const s = pairId ? STORED[pairId] : undefined
  if (s?.noRoute) return { ok: false, message: s.noRoute } // 저장된 '길 없음'(가까운 거리 등): 개발 서버 중계의 422와 같은 결과
  if (s) return { ok: true, itineraries: s.itineraries, source: 'stored', provider: STORED_PROVIDER, fetchedAt: s.fetchedAt }
  if (!allowRelay) return { ok: false, message: '시연 경로를 고르면 버스 경로를 볼 수 있어요.' }
  if (!import.meta.env.DEV) {
    const w = await viaWorker(from, to)
    return w.ok ? { ok: true, itineraries: w.itineraries, source: 'relay', provider: 'odsay', cached: w.cached } : { ok: false, message: w.message }
  }
  const o = await viaDevRelay('/wheel-map/__odsay/transit', from, to)
  if (o.ok) return { ok: true, itineraries: o.itineraries, source: 'relay', provider: 'odsay', cached: o.cached }
  // 길이 없거나(422) 하루 상한(429)이면 그대로 알린다. 중계·키가 없거나 상류가 막힐 때만 TMAP을 예비로 쓴다.
  if (o.status === 422 || o.status === 429) return { ok: false, message: o.message }
  const t = await viaDevRelay('/wheel-map/__tmap/transit', from, to)
  return t.ok ? { ok: true, itineraries: t.itineraries, source: 'relay', provider: 'tmap', cached: t.cached } : { ok: false, message: o.message === FAIL ? t.message : o.message }
}
