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

// 작성자도 개발자도 아닌 계정이 보낸 제보는 「이웃 확인」 한 가지만 받아들인다.
// 보낸 사람 본인의 id 하나를 확인 투표자에 더할 수 있을 뿐, 나머지 필드는 서버에 있던 값을 그대로 둔다.
// 필요한 인원이 차서 「검증 완료」로 바뀌는 것도 서버가 규칙대로 계산한다(src/lib/account/merge.ts reconcileVotes와 같은 값).
export const VOTES_REQUIRED = 2 // src/lib/config.ts와 같은 값

export function neighborConfirm(existing: Json, incoming: Json, userId: string): Json {
  const va = (existing.verification ?? {}) as Json
  const voters = Array.isArray(va.voterIds) ? (va.voterIds as unknown[]).filter((x): x is string => typeof x === 'string') : []
  const vb = (incoming.verification ?? {}) as Json
  const wants = Array.isArray(vb.voterIds) && (vb.voterIds as unknown[]).includes(userId)
  if (!wants || voters.includes(userId) || existing.userId === userId || existing.status !== 'pending' || va.result) return existing
  const next = [...voters, userId]
  const out: Json = { ...existing, verification: { ...va, voterIds: next, votes: next.length } }
  if (next.length >= VOTES_REQUIRED) {
    const hist = Array.isArray(existing.history) ? (existing.history as Entry[]) : []
    const created = typeof existing.createdAt === 'string' ? existing.createdAt : ''
    const lastAt = hist.reduce((m, h) => (typeof h?.at === 'string' && h.at > m ? h.at : m), created)
    const t = new Date(lastAt).getTime()
    if (Number.isNaN(t)) return existing
    const at = new Date(t + 1).toISOString()
    const by = [...next].sort().at(-1) as string
    out.status = 'verified'
    out.verification = { ...(out.verification as Json), result: 'confirmed' }
    out.history = [...hist, { status: 'verified', at, by, memo: `시민 확인 ${next.length}명` }]
  }
  return out
}
