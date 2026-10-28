import type { Barrier, BarrierAttrs, BarrierKind, Geometry } from '../types'

// 속성(barriers.json)과 위치(pilot_coords.json)를 id로 합치는 순수 함수. JSON을 직접 읽지 않아 Node 스크립트에서도 쓴다.
// 위치가 없으면 '위치 미확정', 짝이 안 맞으면 개발 콘솔에 경고한다.

export type CoordEntry = { id: string; name: string; kind?: BarrierKind; geometry: Geometry | null; parentId?: string }

export function mergeBarriers(attrs: BarrierAttrs[], coords: CoordEntry[], candidates: { id: string; geometryKind: BarrierKind }[]): Barrier[] {
  const defaultKinds = new Map(candidates.map((c) => [c.id, c.geometryKind]))
  const coordById = new Map(coords.map((c) => [c.id, c]))
  const attrById = new Map(attrs.map((a) => [a.id, a]))

  const ids = [...attrs.map((a) => a.id), ...coords.filter((c) => !attrById.has(c.id)).map((c) => c.id)]
  const result: Barrier[] = ids.map((id) => {
    const a = attrById.get(id)
    const c = coordById.get(id)
    const geometry = c?.geometry ?? null
    const kind: BarrierKind = c?.kind ?? geometry?.kind ?? defaultKinds.get(id) ?? 'point'
    return {
      type: '(속성 없음)',
      measurements: [],
      source: 'team_survey',
      photos: [],
      note: '',
      ...a,
      id,
      name: a?.name ?? c?.name ?? id,
      kind,
      geometry,
      ...(c?.parentId ? { parentId: c.parentId } : {}),
      ...(!c || (!geometry && kind !== 'group') ? { locationStatus: '미확정' as const } : {}),
    }
  })

  const noCoord = attrs.filter((a) => !coordById.has(a.id)).map((a) => a.id)
  if (noCoord.length > 0) console.warn(`[seed] 속성만 있고 위치가 없음(위치 미확정으로 표시): ${noCoord.join(', ')}`)
  const noAttr = coords.filter((c) => !attrById.has(c.id) && !c.parentId).map((c) => c.id)
  if (noAttr.length > 0) console.warn(`[seed] 위치만 있고 속성이 없음(barriers.json에 추가 필요): ${noAttr.join(', ')}`)
  const orphans = coords.filter((c) => c.parentId && !coordById.has(c.parentId)).map((c) => c.id)
  if (orphans.length > 0) console.warn(`[seed] 상위 항목이 pilot_coords.json에 없는 하위 점: ${orphans.join(', ')}`)
  return result
}
