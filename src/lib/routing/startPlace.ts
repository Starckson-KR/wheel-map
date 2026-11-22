// 길찾기 출발지를 '내 위치'로 미리 정하는 규칙(화면 코드가 없는 순수 함수).
// 위치는 화면 계산에만 쓰고 저장·전송하지 않는다.

export type PermState = 'granted' | 'prompt' | 'denied' | 'unknown'

/**
 * 어떻게 출발지를 채울까
 * - silent: 이미 허용돼 있으니 조용히 위치를 받아 채운다(권한 창이 없어 도착 칸 커서·키보드를 빼앗지 않는다)
 * - onPick: 아직 안 물었다. 출발 칸에 '내 위치'만 보여 두고, 이용자가 도착지를 고르는 순간(사용자 동작 안)에 요청한다
 * - none: 자동으로 채우지 않는다(거부했거나, 홈 검색에서 출발지를 가져왔거나, 이미 정했다)
 */
export type StartPlan = 'silent' | 'onPick' | 'none'

export function startPlan(perm: PermState, opts: { hasPreset: boolean; hasFrom: boolean; hasGeo: boolean }): StartPlan {
  if (opts.hasPreset || opts.hasFrom || !opts.hasGeo) return 'none'
  if (perm === 'granted') return 'silent'
  if (perm === 'denied') return 'none'
  return 'onPick' // prompt, 또는 권한 조회를 지원하지 않는 브라우저(unknown)
}

export type StartPos = { lat: number; lng: number }
export type StartResult = { ok: true; place: { name: string; lat: number; lng: number } } | { ok: false }

/** 위치와 '시범 지역 안인지'로 출발지를 정한다. 못 얻었거나 밖이면 비운다 */
export function resolveStart(pos: StartPos | null | undefined, inPilot: boolean): StartResult {
  if (!pos || !Number.isFinite(pos.lat) || !Number.isFinite(pos.lng) || !inPilot) return { ok: false }
  return { ok: true, place: { name: '내 위치', lat: pos.lat, lng: pos.lng } }
}

export type DemoStartSrc = { fromName: string; from: { stopId: string; lat: number; lng: number } }
export type StartPick = { place: { id?: string; name: string; lat: number; lng: number }; demo: boolean }

/** 위치를 못 얻었을 때의 출발점(이름은 그대로 「전남대」): 추천 경로 「전남대 → 용봉2휴먼시아아파트」의 출발 「전남대」와 같은 정류장·좌표 */
export function demoStartOf(pairs: (DemoStartSrc & { toName: string })[]): StartPick['place'] | null {
  const p = pairs.find((x) => x.fromName === '전남대' && x.toName.startsWith('용봉2휴먼시아'))
  return p ? { id: p.from.stopId, name: p.fromName, lat: p.from.lat, lng: p.from.lng } : null
}

/** 검색바에서 도착지를 골랐을 때 출발지: 위치를 쓸 수 있고 시범 지역 안이면 '내 위치', 아니면 시연 출발점 */
export function pickStart(pos: StartPos | null | undefined, inPilot: boolean, demo: StartPick['place'] | null): StartPick | null {
  const r = resolveStart(pos, inPilot)
  if (r.ok) return { place: r.place, demo: false }
  return demo ? { place: demo, demo: true } : null
}

/** 비운 이유를 알리는 짧은 한 줄 */
export const START_HINT = '출발지를 골라 주세요'
