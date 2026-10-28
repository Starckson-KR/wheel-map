import type { Impact } from './engine.ts'

// 시민 제보의 '영향 종류' 자동 판단(5단계 보정). 유형(명세서 4-1(1)의 12종) + 위치 성격(3단계 LOCATION_KINDS)으로 정한다.
// 근거:
//  - 정류장에서 생긴 제보(위치 성격 '버스정류장')는 걸어서 지나가는 길이 아니라 버스 타기(대기공간·승강장)의 문제로 본다 → boarding
//  - 경사로 없음·수동문·장애인화장실 없음은 '건물 안으로 들어가는' 문제 → entry (그 건물이 도착지일 때만 판정에 쓴다)
//  - 그 밖(계단·턱, 좁은 보도, 급경사, 파손 노면, 쓰레기·킥보드·입간판·공사 자재·불법 주정차)은 보행로를 막거나 거칠게 하는 것 → passage
//  - zone(동네 단위 영역)은 모양이 영역인 팀 조사 지점에만 쓰며 시민 제보(점)에는 쓰지 않는다
// 위치 성격이 없으면(옛 제보) 유형만으로 판단한다.
const ENTRY_TYPES = ['경사로 없음', '수동문', '장애인화장실 없음']

export function impactOfReport(type: string, locationKind?: string): Impact {
  if (locationKind === '버스정류장') return 'boarding'
  if (ENTRY_TYPES.includes(type)) return 'entry'
  return 'passage'
}
