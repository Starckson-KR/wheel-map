import type { PubItem } from './publicLayers'
import { facilityTitle } from './facilityName'

// 장애인편의시설 자료의 id는 건물 단위라 한 건물의 시설 2~4곳이 같은 id를 쓴다(시설 고유 번호는 fields.faclInfId).
// 지도에는 건물마다 핀 하나만 그리고, 누르면 그 건물의 시설 목록을 보인다. 자료 파일은 그대로 두고 화면에서만 묶는다.

export type FacilityMember = { key: string; name: string; type: string; evalInfo: string; address: string; fields: Record<string, unknown> }

const DELETED = /^\(?\s*삭제\s*요청/
const evalOf = (it: PubItem) => (typeof it.fields['evalInfo'] === 'string' ? (it.fields['evalInfo'] as string) : '')

/** 지울 요청이 들어온 자료(이름이 「삭제 요청」으로 시작) */
export const isDeletedFacility = (it: PubItem) => DELETED.test(it.name.trim())

/** 건물(id)마다 하나로 묶는다. 삭제 요청 자료는 빼고, 같은 id·같은 이름 중복은 편의시설 항목이 있는 쪽 하나만 남긴다. 시설이 둘 이상이면 fields.members에 목록을 둔다. */
export function groupFacilities(items: readonly PubItem[]): PubItem[] {
  const byId = new Map<string, PubItem[]>()
  for (const it of items) {
    if (isDeletedFacility(it)) continue
    const list = byId.get(it.id)
    if (list) list.push(it)
    else byId.set(it.id, [it])
  }
  const out: PubItem[] = []
  for (const [id, list] of byId) {
    const byName = new Map<string, PubItem>()
    for (const it of list) {
      const prev = byName.get(it.name)
      if (!prev || evalOf(it).length > evalOf(prev).length) byName.set(it.name, it)
    }
    const uniq = [...byName.values()]
    const pos = uniq.find((x) => x.lat != null && x.lng != null) ?? uniq[0]
    const head = uniq[0]
    if (uniq.length === 1) {
      out.push(head)
      continue
    }
    const members: FacilityMember[] = uniq.map((x) => ({
      key: String(x.fields['faclInfId'] ?? `${id}#${x.name}`),
      name: x.name,
      type: String(x.fields['faclTyCd'] ?? ''),
      evalInfo: evalOf(x),
      address: x.address,
      fields: x.fields,
    }))
    out.push({ id, name: head.name, lat: pos.lat, lng: pos.lng, address: head.address, fields: { ...head.fields, members } })
  }
  return out
}

export const membersOf = (it: Pick<PubItem, 'fields'>): FacilityMember[] => {
  const m = it.fields['members']
  return Array.isArray(m) ? (m as FacilityMember[]) : []
}

/** 핀 이름표·카드 제목: 시설이 하나면 그 이름, 둘 이상이면 「이름 외 N곳」 */
export const facilityLabel = (it: PubItem): string => {
  const n = membersOf(it).length
  return n > 1 ? `${facilityTitle(it)} 외 ${n - 1}곳` : facilityTitle(it)
}
