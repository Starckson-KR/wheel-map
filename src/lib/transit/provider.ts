import stored from '../../../data/routes/transit.json'
import type { Place } from '../routing/provider.ts'
import type { TItinerary } from './parse.ts'

// 대중교통(버스) 경로 가져오기(7단계). 배포(빌드)에서는 미리 저장한 시연 경로(data/routes/transit.json)만 쓰고,
// 개발 서버에서는 저장본이 없을 때만 개발 서버 중계(vite.config.ts → TMAP 대중교통 API)를 부른다. 키는 브라우저에 없다.
// TMAP 대중교통 무료 상품은 하루 10건이라 중계가 하루 상한을 스스로 걸고 같은 요청은 저장해 둔다.

type Stored = Record<string, { fetchedAt: string; itineraries: TItinerary[] }>
const STORED = (stored as unknown as { pairs: Stored }).pairs

export const TRANSIT_FREE_SEARCH: boolean = import.meta.env.DEV

export type TransitFetch = { ok: true; itineraries: TItinerary[]; source: 'stored' | 'relay'; cached?: boolean; fetchedAt?: string } | { ok: false; message: string }

export const hasStoredTransit = (pairId: string | null) => !!pairId && !!STORED[pairId]

export async function fetchTransit(pairId: string | null, from: Place, to: Place, allowRelay: boolean): Promise<TransitFetch> {
  const s = pairId ? STORED[pairId] : undefined
  if (s) return { ok: true, itineraries: s.itineraries, source: 'stored', fetchedAt: s.fetchedAt }
  if (!import.meta.env.DEV || !allowRelay) return { ok: false, message: '발표용으로 미리 저장해 둔 시연 경로에서만 버스 경로를 볼 수 있어요.' }
  try {
    const r = await fetch('/wheel-map/__tmap/transit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: [from.lat, from.lng], to: [to.lat, to.lng] }),
    })
    if (!r.ok) {
      const body = (await r.json().catch(() => ({}))) as { error?: string }
      return {
        ok: false,
        message:
          r.status === 404 || r.status === 405
            ? '버스 경로 중계를 찾지 못했어요. 개발 서버를 다시 시작해야 할 수 있어요.'
            : r.status === 429
              ? '오늘 버스 경로 조회 한도에 닿았어요(무료 상품은 하루 10건).'
              : body.error || '버스 경로를 받지 못했어요.',
      }
    }
    const j = (await r.json()) as { itineraries: TItinerary[]; cached: boolean }
    return { ok: true, itineraries: j.itineraries, source: 'relay', cached: j.cached }
  } catch {
    return { ok: false, message: '버스 경로 중계에 연결하지 못했어요.' }
  }
}
