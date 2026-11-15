import type { Report } from '../../types'

// 제보 한 건의 병합 규칙(서버 worker/src/merge.ts와 같다).
// history는 항목 id(상태·시각·작성자·메모) 기준 합집합, 확인 투표자도 합집합, 나머지 필드는 incoming(최신 값)을 따른다.
type Entry = Report['history'][number]
export const entryId = (e: Entry) => `${String(e.status)}|${String(e.at)}|${String(e.by)}|${String(e.memo ?? '')}`

export function mergeReport(existing: Report, incoming: Report): Report {
  const merged: Report = { ...incoming, id: existing.id, userId: existing.userId, createdAt: existing.createdAt }
  const seen = new Set<string>()
  const union: Entry[] = []
  for (const e of [...existing.history, ...incoming.history]) {
    const id = entryId(e)
    if (seen.has(id)) continue
    seen.add(id)
    union.push(e)
  }
  const sorted = union.map((e, i) => ({ e, i })).sort((x, y) => String(x.e.at).localeCompare(String(y.e.at)) || x.i - y.i).map((x) => x.e)
  merged.history = sorted
  const inIds = new Set(incoming.history.map(entryId))
  if (sorted.length > 0 && sorted.some((e) => !inIds.has(entryId(e)))) merged.status = sorted[sorted.length - 1].status
  const voters = [...new Set([...(existing.verification.voterIds ?? []), ...(incoming.verification.voterIds ?? [])])]
  merged.verification = { ...incoming.verification, voterIds: voters, votes: voters.length }
  return merged
}

// 두 사람이 동시에 투표해 합쳐진 뒤 필요한 인원을 넘었는데 아직 대기 상태이면 "검증 완료"로 올린다.
// 어느 기기에서 계산해도 같은 기록이 나오도록 시각·작성자를 기존 기록에서 정한다(서버 합집합에서 중복이 생기지 않는다).
export function reconcileVotes(r: Report, required: number): Report {
  if (r.status !== 'pending' || r.verification.result || r.verification.voterIds.length < required) return r
  const lastAt = r.history.reduce((m, h) => (h.at > m ? h.at : m), r.createdAt)
  const at = new Date(new Date(lastAt).getTime() + 1).toISOString()
  const by = [...r.verification.voterIds].sort().at(-1) as string
  return {
    ...r,
    status: 'verified',
    verification: { ...r.verification, result: 'confirmed' },
    history: [...r.history, { status: 'verified', at, by, memo: `시민 확인 ${r.verification.voterIds.length}명` }],
  }
}

// 내용 해시(변경 감지용, 보안 목적 아님)
export function hashText(s: string): string {
  let h = 5381
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0
  return `${s.length}:${(h >>> 0).toString(36)}`
}
