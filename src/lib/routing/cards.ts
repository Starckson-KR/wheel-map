// 경로 결과를 옆으로 넘기는 카드로 고르는 규칙(화면 코드가 없는 순수 함수).
// 순서: 피해 가는 길(추천) · 가장 짧은 길 · 버스 타고

export type CardId = 'detour' | 'base' | 'bus'

export function cardOrder(hasDetour: boolean): CardId[] {
  return hasDetour ? ['detour', 'base', 'bus'] : ['base', 'bus']
}

/** 화살표 키로 옆 카드로(처음·끝에서 멈춘다). 다른 키는 null */
export function stepCard(ids: readonly CardId[], cur: CardId, key: string): CardId | null {
  const i = ids.indexOf(cur)
  if (i < 0) return null
  if (key === 'ArrowRight' || key === 'ArrowDown') return ids[Math.min(ids.length - 1, i + 1)]
  if (key === 'ArrowLeft' || key === 'ArrowUp') return ids[Math.max(0, i - 1)]
  if (key === 'Home') return ids[0]
  if (key === 'End') return ids[ids.length - 1]
  return null
}

/** 버스 카드: ready=저장된 경로가 있다 / find=개발 모드에서 직접 찾을 수 있다 / none=볼 수 없다(짧은 안내만) */
export type BusCardState = 'ready' | 'find' | 'none'
export function busCardState(stored: boolean, freeSearch: boolean): BusCardState {
  return stored ? 'ready' : freeSearch ? 'find' : 'none'
}

/** 경로가 나온 직후 고른 카드: 기본은 맨 앞(추천). 버스로 열라는 요청이 있고 버스를 쓸 수 있으면 버스 */
export function initialCard(hasDetour: boolean, wantBus: boolean, bus: BusCardState): CardId {
  if (wantBus && bus !== 'none') return 'bus'
  return cardOrder(hasDetour)[0]
}
