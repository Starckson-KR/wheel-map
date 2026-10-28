import type { Hit } from './engine.ts'

// "대안 경로 없음"으로 판정된 지점 기록(4단계 우선순위의 '대안 경로' 점수에 쓴다). localStorage 키: wheelmap.noAlternative
export const NO_ALT_KEY = 'wheelmap.noAlternative'
export type NoAltRecord = { id: string; name: string; impact?: 'passage'; parentId?: string; pairs: string[]; firstAt: string; lastAt: string }
export type NoAltMap = Record<string, NoAltRecord>

export function loadNoAlt(): NoAltMap {
  try {
    const v = JSON.parse(localStorage.getItem(NO_ALT_KEY) ?? '{}')
    return v && typeof v === 'object' && !Array.isArray(v) ? (v as NoAltMap) : {}
  } catch {
    return {}
  }
}

export function recordNoAlt(hits: Hit[], pairLabel: string) {
  hits = hits.filter((h) => h.o.impact === 'passage') // 지나가기 어려운 곳만 기록(정류장·출입은 우회 대상이 아님)
  if (hits.length === 0) return
  try {
    const all = loadNoAlt()
    const now = new Date().toISOString()
    for (const h of hits) {
      const prev = all[h.o.id]
      all[h.o.id] = {
        id: h.o.id,
        name: h.o.name,
        impact: 'passage' as const,
        ...(h.o.parentId ? { parentId: h.o.parentId } : {}),
        pairs: prev && prev.pairs.includes(pairLabel) ? prev.pairs : [...(prev?.pairs ?? []), pairLabel],
        firstAt: prev?.firstAt ?? now,
        lastAt: now,
      }
    }
    localStorage.setItem(NO_ALT_KEY, JSON.stringify(all))
  } catch {
    /* 저장 실패 시 화면 표시만 유지 */
  }
}

// 지점(시드 id·하위 점의 상위 id·제보 id)에 해당하는 기록
export function noAltFor(map: NoAltMap, key: string): NoAltRecord | undefined {
  // impact가 passage로 기록된 것만 인정한다(이전 테스트로 쌓인 정류장 등 기록은 무시)
  if (map[key]?.impact === 'passage') return map[key]
  return Object.values(map).find((r) => r.parentId === key && r.impact === 'passage')
}
