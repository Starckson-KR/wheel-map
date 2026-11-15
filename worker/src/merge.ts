// 제보 한 건의 병합. 서버(동시 수정 대비)와 앱(src/lib/account/merge.ts)이 같은 규칙을 쓴다.
// history는 항목 id(상태·시각·작성자·메모) 기준 합집합, 확인 투표자 목록도 합집합, 나머지 필드는 incoming(최신 값).
type Json = Record<string, unknown>
type Entry = Record<string, unknown> & { status?: unknown; at?: unknown; by?: unknown; memo?: unknown }

export const entryId = (e: Entry) => `${String(e.status)}|${String(e.at)}|${String(e.by)}|${String(e.memo ?? '')}`

const IMMUTABLE = ['id', 'userId', 'createdAt']

export function mergeReport(existing: Json | null, incoming: Json): Json {
  if (!existing) return incoming
  const merged: Json = { ...incoming }
  for (const k of IMMUTABLE) if (k in existing) merged[k] = existing[k]

  const a = Array.isArray(existing.history) ? (existing.history as Entry[]) : []
  const b = Array.isArray(incoming.history) ? (incoming.history as Entry[]) : []
  const seen = new Set<string>()
  const union: Entry[] = []
  for (const e of [...a, ...b]) {
    if (typeof e !== 'object' || e === null) continue
    const id = entryId(e)
    if (seen.has(id)) continue
    seen.add(id)
    union.push(e)
  }
  // 시각 순(같으면 들어온 순서 유지)
  const sorted = union.map((e, i) => ({ e, i })).sort((x, y) => String(x.e.at).localeCompare(String(y.e.at)) || x.i - y.i).map((x) => x.e)
  merged.history = sorted
  // incoming에 없던 기록이 합쳐졌으면(동시 수정) 상태는 가장 마지막 기록을 따른다.
  const inIds = new Set(b.map(entryId))
  if (sorted.some((e) => !inIds.has(entryId(e))) && sorted.length > 0) merged.status = sorted[sorted.length - 1].status

  const va = (existing.verification ?? {}) as Json
  const vb = (incoming.verification ?? {}) as Json
  const voters = [...new Set([...(Array.isArray(va.voterIds) ? (va.voterIds as string[]) : []), ...(Array.isArray(vb.voterIds) ? (vb.voterIds as string[]) : [])])]
  merged.verification = { ...vb, voterIds: voters, votes: voters.length }
  return merged
}
