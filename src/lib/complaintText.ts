import type { Barrier, Report } from '../types'
import { distanceM, distanceToGeometryM } from './geo'

// 민원 문안에 넣는 "관련 법령 기준". 조문 표기는 디자인사고_인수인계.md 6장(korean-law MCP 원문 조회, 2026-10-04 기준)을 그대로 옮겼다.
// 유형 × 위치 성격으로 고르며, 해당하는 기준이 없으면 비운다(새로 만들지 않는다).
type Criterion = { text: string; basis: string }

const STOP = '교통약자법 시행규칙 별표1 제3호'

export function criteriaFor(type: string, kind: string): Criterion[] {
  const out: Criterion[] = []
  const building = kind === '공공건물 출입' || kind === '민간 건물 출입' || kind === '대학 캠퍼스 내부'
  if (type === '좁은 보도') out.push({ text: '보도 유효폭 2m 이상(불가피한 경우 1.2m까지 완화), 1.5m 미만이면 50m마다 1.5×1.5m 교행구역', basis: STOP })
  if (type === '급경사') {
    if (building) out.push({ text: '건축물 경사로 기울기 1/12 이하', basis: '장애인등편의법 시행규칙 별표1 제12호' })
    else out.push({ text: '보도 기울기 1/18 이하(불가피한 경우 1/12), 좌우 기울기 1/25 이하', basis: STOP })
  }
  if (type === '계단·턱' && kind === '횡단보도·신호') out.push({ text: '횡단보도 턱 낮춤 단차 2cm 이하, 연석경사로 유효폭 0.9m·기울기 1/12', basis: '교통약자법 시행규칙 별표1 제3호가목6)' })
  if (type === '경사로 없음' || (type === '계단·턱' && building)) out.push({ text: '건축물 경사로 유효폭 1.2m 이상(증·개축 등은 0.9m까지 완화), 기울기 1/12 이하', basis: '장애인등편의법 시행규칙 별표1 제12호' })
  if (type === '수동문') out.push({ text: '건축물 출입문 통과 유효폭 0.9m 이상, 손잡이는 레버형·수평/수직 막대형', basis: '장애인등편의법 시행규칙 별표1 제6호' })
  if (type === '장애인화장실 없음') out.push({ text: '판매시설 1,000㎡ 이상은 장애인용 대변기 설치 의무, 공원은 시설로 가는 보도 중 하나 이상 통행 가능', basis: '장애인등편의법 시행령 별표2' })
  if (kind === '버스정류장' && (type === '계단·턱' || type === '파손 노면' || type === '경사로 없음')) {
    out.push({ text: '버스정류장은 휠체어의 진출입과 회전이 가능해야 함(대기공간 크기 수치 규정은 찾지 못함)', basis: '교통약자법 시행규칙 별표1 제2호버목' })
  }
  return out
}

export const BUILDING_NOTE = '건물의 설치 의무는 신축·주요 부분 변경 시 생기는 것이 원칙이며, 대상 시설 여부는 소관 기관의 확인이 필요합니다.'

export type RelatedInfo = { merged: number; nearReports: number; nearTeamPoints: number; nearTeamX: number }

// 반경 내 관련 제보 수와 시범 경로(팀 조사 지점) 인근 현황. 반경은 팀 조사 지점 200m, 제보 100m.
export function relatedInfo(r: Report, reports: Report[], seeds: Barrier[]): RelatedInfo {
  const merged = reports.filter((x) => x.status === 'merged' && x.barrierId === r.id).length
  const nearReports = reports.filter((x) => x.id !== r.id && x.status !== 'rejected' && x.status !== 'merged' && distanceM(r.lat, r.lng, x.lat, x.lng) <= 100).length
  const near = seeds.filter((b) => b.geometry && !b.parentId && distanceToGeometryM(r.lat, r.lng, b.geometry) <= 200)
  return { merged, nearReports, nearTeamPoints: near.length, nearTeamX: near.filter((b) => b.rating === 'X').length }
}

export function buildComplaintText(args: { r: Report; address: string | null; agencyNames: string[]; related: RelatedInfo; ratingLabel?: string }): string {
  const { r, address, agencyNames, related, ratingLabel } = args
  const kind = r.locationKind ?? '확인 필요'
  const crit = criteriaFor(r.type, kind)
  const lines: string[] = []
  let n = 0
  const num = () => `${++n}.`
  lines.push(`제목: 보행 장애요소(${r.type}) 확인 및 개선 요청`)
  lines.push('')
  lines.push('안녕하십니까. 휠체어 이용자의 안전한 이동을 위해, 아래 보행 장애요소의 확인과 개선을 정중히 요청드립니다.')
  lines.push('')
  lines.push(`${num()} 위치: ${address ?? '주소를 확인하지 못했습니다'} (위도 ${r.lat.toFixed(5)}, 경도 ${r.lng.toFixed(5)})`)
  lines.push(`   위치 성격: ${kind}`)
  lines.push(`${num()} 유형: ${r.type} (${r.category === 'fixed' ? '고정형' : '일시형'})`)
  lines.push(`${num()} 현황: ${r.description}`)
  if (r.measurements && (r.measurements.widthM !== undefined || r.measurements.curbCm !== undefined)) {
    const m = [r.measurements.widthM !== undefined ? `폭 ${r.measurements.widthM}m` : '', r.measurements.curbCm !== undefined ? `턱 높이 ${r.measurements.curbCm}cm` : ''].filter(Boolean).join(', ')
    lines.push(`${num()} 실측값: ${m} (시민 입력값으로 오차가 있을 수 있습니다)`)
  }
  lines.push(`${num()} 사진: ${r.photos.length}장 (접수 화면에서 첨부해 주시기 바랍니다)`)
  if (crit.length > 0) {
    lines.push(`${num()} 관련 기준(팀 내부 기준안이며, 실제 통과 가능 여부를 우선합니다):`)
    for (const c of crit) lines.push(`   - ${c.text} (${c.basis})`)
    if (kind.endsWith('출입') || kind === '대학 캠퍼스 내부') lines.push(`   ※ ${BUILDING_NOTE}`)
  }
  lines.push(`${num()} 관련 제보: 이 제보에 합쳐진 시민 제보 ${related.merged}건, 반경 100m 안의 다른 제보 ${related.nearReports}건`)
  if (related.nearTeamPoints > 0) {
    lines.push(`   같은 경로(후문 원룸촌~정류장~전남대치과병원 시범 경로) 인근 반경 200m 안의 팀 현장조사 지점 ${related.nearTeamPoints}곳(통과 불가 X ${related.nearTeamX}곳)`)
  }
  lines.push(`${num()} 검증 상태: 시민 확인 ${r.verification.votes}명${ratingLabel ? `, 검증자 판정 ${ratingLabel}` : ''}`)
  if (agencyNames.length > 0) lines.push(`${num()} 소관 기관 후보: ${agencyNames.join(', ')} (소관이 다르면 이송해 주시기 바랍니다)`)
  lines.push('')
  lines.push('요청 사항: 현장을 확인해 주시고, 휠체어가 통행할 수 있도록 개선 또는 정비해 주시기 바랍니다. 조치 후 처리 결과를 회신해 주시면 감사하겠습니다.')
  lines.push('')
  lines.push('※ 이 문안은 북구동행지도(발표용 프로토타입)에서 자동 작성되었습니다. 국민신문고·안전신문고를 대체하지 않으며, 실제 접수는 해당 채널에서 이루어집니다.')
  return lines.join('\n')
}
