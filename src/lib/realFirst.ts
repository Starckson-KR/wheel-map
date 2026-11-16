import type { Report } from '../types'

// 실제 사람이 채운 데이터를 모의 데이터보다 먼저 보여 주는 정렬 규칙(한 곳에 모음).
// 모의 = 시연 도구가 채운 제보(demo·demoSet)와 "샘플 사진으로 해 보기"로 올린 체험 제보(sample).
// 표시가 없는 제보(옛 제보 포함)는 실제로 본다. 팀 현장조사 지점(seed)은 모의가 아니다.
export const isMockReport = (r: Pick<Report, 'demo' | 'demoSet' | 'sample'>): boolean => !!(r.demo || r.demoSet || r.sample)

// 안정 분할: 실제 항목이 앞, 모의 항목이 뒤. 각 묶음 안의 순서는 그대로다(이미 정렬된 목록에 쓰면 "같은 기준 안에서 실제가 먼저").
export function realFirst<T>(list: readonly T[], mock: (x: T) => boolean): T[] {
  const real: T[] = []
  const fake: T[] = []
  for (const x of list) (mock(x) ? fake : real).push(x)
  return real.concat(fake)
}

export const realFirstReports = (list: readonly Report[]): Report[] => realFirst(list, isMockReport)

// 사용자(순위 표시용): 시연 도구가 만든 가상 사용자는 모의, 계정으로 가입한 사람은 실제.
// 가상 사용자 명부는 reportStore가 갖고 있어 순환 import를 피하려고 거기서 판별 함수를 등록한다.
let mockUser: (id: string) => boolean = () => false
export const setMockUserCheck = (fn: (id: string) => boolean) => {
  mockUser = fn
}
export const isMockUser = (id: string): boolean => mockUser(id)
