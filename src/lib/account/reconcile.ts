// 서버에서 지워진 제보를 기기 저장소에서도 지우는 판단(순수 함수). 삭제 표시(tombstone)가 생기기 전에 지워진 제보를 한 번 맞출 때 쓴다.
// 지우는 대상은 「서버와 맞춘 적 있는(hashes에 있는)」 제보뿐이다. 서버에 올린 적 없는 로컬 제보·시연 데이터·샘플은 절대 지우지 않는다.
export type GoneInput = {
  /** 이 기기에 있는 제보(id, 시연 여부) */
  local: { id: string; demo?: boolean; demoSet?: string }[]
  /** 서버와 맞춘 적 있는 제보 id(요청을 보내기 전에 찍어 둔 목록) */
  synced: ReadonlySet<string>
  /** 서버가 거절해 이 기기에만 남겨 둔 제보 id */
  localOnly: ReadonlySet<string>
  /** 아직 못 올린 변경이 있는 제보 id */
  pending: ReadonlySet<string>
  /** 서버가 말한 현재 제보 id 전체 */
  serverIds: ReadonlySet<string>
}

export function pickGone(i: GoneInput): string[] {
  return i.local
    .filter((r) => !r.demo && !r.demoSet && i.synced.has(r.id) && !i.localOnly.has(r.id) && !i.pending.has(r.id) && !i.serverIds.has(r.id))
    .map((r) => r.id)
}

/** 서버가 보낸 삭제 id 목록에서 문자열만 거른다 */
export function cleanIds(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && x.length > 0) : []
}
