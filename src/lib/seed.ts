import barriersData from '../../data/seed/barriers.json'
import candidatesData from '../../data/seed/pilot_candidates.json'
import coordsData from '../../data/seed/pilot_coords.json'
import provisionalData from '../../data/seed/provisional_coords.json'
import type { Barrier, BarrierAttrs, BarrierKind, Provisional } from '../types'
import { mergeBarriers, type CoordEntry } from './seedMerge'

// 속성(barriers.json)과 위치(pilot_coords.json)를 id로 합친다. 합치는 규칙은 seedMerge.ts 한 곳에만 있다.
export function loadBarriers(): Barrier[] {
  return mergeBarriers(
    barriersData as unknown as BarrierAttrs[],
    coordsData as unknown as CoordEntry[],
    candidatesData as { id: string; geometryKind: BarrierKind }[],
    provisionalData as unknown as (Provisional & { id: string })[],
  )
}
