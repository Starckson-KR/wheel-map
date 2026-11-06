// 브라우저 쪽 정적 자료 읽기(시범 정류장 짝, BIS 정류소 목록, 스냅샷). 정류소 목록은 크므로 필요할 때 동적으로 불러온다.
import pilot from '../../../data/public/pilot-stops.json'
import type { BisStop, PilotStopsFile } from './stops.ts'

export const PILOT_STOPS = pilot as unknown as PilotStopsFile

let cache: Promise<BisStop[]> | null = null
export function loadBisStops(): Promise<BisStop[]> {
  cache ??= import('../../../data/public/bus-stops.bis.json').then((m) => {
    const d = m.default as unknown as { items: { id: string; name: string; lat: number; lng: number; fields: { ARS_ID?: string; NEXT_BUSSTOP?: string } }[] }
    return d.items.map((x) => ({ id: x.id, name: x.name, lat: x.lat, lng: x.lng, ars: x.fields.ARS_ID, next: x.fields.NEXT_BUSSTOP }))
  })
  return cache
}
