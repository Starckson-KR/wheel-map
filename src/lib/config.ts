// 제보·검증 설정값. 발표 전에 팀이 정하는 값은 여기만 바꾸면 된다.

// 검증 방식(명세서 4-1(2): "둘 중 하나로 확정" — 아직 미정이라 세 가지를 지원한다)
//  'either'   : 시민 확인 투표 또는 검증자 현장 확인 중 먼저 충족되는 쪽 (기본값)
//  'votes'    : 시민 확인 투표만 (검증 완료 뒤 검증자는 ○△X 판정만 추가)
//  'verifier' : 검증자 현장 확인만
export type VerifyMode = 'either' | 'votes' | 'verifier'
export const VERIFY_MODE: VerifyMode = 'either'

export const VOTES_REQUIRED = 2 // 필요한 시민 확인 수(제보자 제외)
export const DUP_RADIUS_M = 15 // 중복 확인 반경
export const DUP_DAYS = 30 // 중복 확인 기간
export const TEMP_VALID_HOURS = 72 // 일시형 유효기간

export const PHOTO_MAX_COUNT = 3
export const PHOTO_MAX_EDGE = 1280 // 긴 변 px
export const PHOTO_QUALITY = 0.85

export const canVote = (m: VerifyMode = VERIFY_MODE) => m === 'either' || m === 'votes'
export const canVerifierConfirm = (m: VerifyMode = VERIFY_MODE) => m === 'either' || m === 'verifier'

// 3단계: 민원 접수 방식.
//  'link' : 문안 복사 + 공식 채널 링크로 이동 → 사용자가 접수번호를 입력 (실제 방식)
//  'mock' : 발표 시연용 모의 접수(src/lib/mockComplaintApi.ts). 실제 국민신문고·안전신문고에는 접수되지 않는다.
export type ComplaintMode = 'link' | 'mock'
export const COMPLAINT_MODE: ComplaintMode = 'link'

export const DEADLINE_FALLBACK_DAYS = 14 // 기관별 기한이 자료에 없을 때의 일반 상한(조사 문서 5장)
export const DEADLINE_SOON_DAYS = 3 // 부서별 화면: 처리기한이 이 일수 안으로 남으면 "기한 임박"
export const LONG_UNRESOLVED_DAYS = 60 // 명세서 4-1(4): 접수 후 60일 이상 미조치
export const BUKGU_OLD_CHANNEL_END = '2026-11-01T00:00:00+09:00' // 북구 주민생활불편신고 종료 다음 날

// 4단계: 행정 화면 설정
export const INSPECT_FIXED_MONTHS = 6 // 사후 점검 주기: 고정형(명세서 4-3(3) 예시)
export const INSPECT_TEMP_MONTHS = 1 // 일시형 다발 지점

// 우선순위 점수 = 제보 수 × 가중치 + (반경 내 정류장 수 + 병원·복지시설 수) × 가중치 + 대안 경로 유무 × 가중치.
// 아래 값은 모두 "가중치(안)"이며 팀이 정하는 값이다. 대안 경로 없음 = 5단계 길찾기에서 우회 경로를 찾지 못해 localStorage wheelmap.noAlternative에 기록된 지점(○△X가 X인 경우만 반영).
export const PRIORITY_WEIGHTS = { report: 2, bus: 1, facility: 1, alternative: 3 }
export const PRIORITY_REPORT_RADIUS_M = 30 // 같은 지점으로 보는 제보 반경
export const PRIORITY_DEMAND_RADIUS_M = 150 // 이용 수요(정류장·병원·복지시설)를 세는 반경
// 이용 수요로 세는 시설 유형(data/public/facilities.json의 faclTyCd 값 그대로)
export const DEMAND_FACILITY_TYPES = [
  '병원·치과병원·한방병원·정신병원·요양병원',
  '의원·치과의원·한의원·조산소·산후조리원',
  '보건소',
  '노인복지시설',
  '이외 사회복지시설',
  '장애인복지시설',
  '아동복지시설',
]

// 5단계: 경로 검색(명세서 4-0). 팀이 정하는 값은 여기만 바꾼다.
export const ROUTE_CFG = {
  radiusM: 10, // 경로선 반경 안의 장애요소를 찾는 거리
  offsetsM: [40, 80], // (표시용) 단일 경유지 거리. 실제 시도 순서는 attemptPlan
  // 우회 시도 순서(지나가기 어려운 곳 passage X에만). single=X 지점에서 경로 수직 ±m 경유지 1개, pair=X 앞뒤로 경로를 따라 d만큼 떨어진 두 점을
  // 같은 쪽으로 m 옮긴 경유지 2개(평행한 다른 길 유도), option=경유지 없이 TMAP searchOption만 바꿈(4 추천+대로우선, 10 최단, 30 최단+계단 제외 — SK open API 문서)
  attemptPlan: [
    { kind: 'single' as const, m: 40 },
    { kind: 'pair' as const, d: 90, m: 40 },
    { kind: 'option' as const, opt: 10 },
    { kind: 'single' as const, m: 80 },
    { kind: 'pair' as const, d: 150, m: 70 },
    { kind: 'option' as const, opt: 4 },
  ],
  maxLengthRatio: 2, // 우회 경로 길이 상한(기본 경로의 배수)
  maxAttempts: 10, // 검색 1회당 경로 요청 최대 횟수(기본 경로 포함). 저장된 결과를 쓸 때도 같은 한도로 세어 결과가 같다
  maxVia: 5, // TMAP 경유지 최대 개수
  stopRadiusM: 150, // 출발·도착 근처 정류장(버스 타기 불편 정보)
  destRadiusM: 50, // 도착지 건물 출입 불편을 판단하는 범위
}
// 2단계: 자체 보행망(OpenStreetMap) 경로 탐색. 아래 숫자는 이 팀이 정한 설계값이며 OSM이 정한 값이 아니다. 시연 쌍으로 검증한 뒤 팀이 조정한다.
export const WALK_CFG = {
  obstacleRadiusM: 10, // 장애요소가 영향을 주는 거리(경로 검사 반경 ROUTE_CFG.radiusM과 같게 둔다)
  penaltyX: 20000, // X(어려움) 곳을 지나는 길 토막 벌점(m) — 사실상 통과 금지(대안이 전혀 없을 때만 지난다)
  penaltyT: 150, // △(주의) 곳을 지나는 길 토막 벌점(m) — 150m까지 돌아가는 건 감수
  penaltyStepsM: 5000, // 계단·휠체어 불가 길 토막 고정 벌점(m)
  penaltyKerbM: 150, // 높은 턱 지점 벌점(m)
  crossingM: 50, // 횡단보도 하나당 더하는 거리(m)(신호 기다림·차도 건너기, 휠체어는 더 오래 걸려 크게 둠)
  roadMajorMult: 3, // 큰 차도(보도 없이 primary·secondary·tertiary를 걷는 길) 길이 배수
  roadServiceMult: 2.5, // 단지 안길(highway=service) 길이 배수. 출입 제한·주차 차량 가능성이 있어 크게 둠
  roadOtherMult: 1.4, // 그 밖의 보도 없는 차도(residential·living_street 등) 길이 배수
  roughMult: 1.5, // 비포장·거친 노면(surface=dirt·gravel 등) 길이 추가 배수
  wcLimitedMult: 1.3, // wheelchair=limited 길 길이 추가 배수
  wcYesMult: 0.95, // wheelchair=yes·designated 길 길이 배수(1보다 작아 약간 선호)
  inclineWarnPct: 8, // 경사 8% 이상(기준 약 1/12)이면 가파른 길
  snapMaxM: 150, // 출발·도착이 보행망에서 이 거리 넘게 떨어지면 자체 경로를 못 찾는 것으로 본다
  walkSpeedMs: 1.37, // 시연 TMAP 경로의 거리÷시간 평균(2,156m/1,569s)
  maxDetourRatio: 2, // 피해 가는 길 허용 길이(기본 길의 배수). 넘으면 피해 가는 길을 내지 않는다
}
export const ROUTE_OFF_ROUTE_M = 40 // 길 안내 중 내 위치가 경로에서 이만큼 떨어지면 "길에서 벗어났어요"로 본다
export const NAV_STEP_NEAR_M = 30 // 길 안내 중 내 위치가 지금 단계 지점에서 이만큼 안이면 단계 화살표 원을 작고 흐리게 해 내 위치 점이 묻히지 않게 한다
export const NAV_Z = { route: 12, step: 15, me: 30 } as const // 길 안내 화면의 쌓이는 순서(큰 값이 위): 경로선·강조선 < 단계 화살표 < 내 위치 점·방향 부채꼴
export const ROUTE_CROSSWALK_RADIUS_M = 20 // 경로 근처 횡단보도
export const ROUTE_STOP_RADIUS_M = 150 // 출발·도착 근처 버스정류장
export const ROUTE_DEST_RADIUS_M = 50 // 도착지 장애인편의시설·장애인화장실

// 6단계: 시민 참여 리워드(명세서 4-2). 아래 값은 모두 명세서의 "(안)"이며 팀 회의에서 확정한다.
export const REWARD_POINTS = {
  verified: 10, // 제보가 검증됨
  evidence: 5, // 실측값·사진 3장 포함 (안: 실측값과 사진 3장을 모두 갖춘 경우)
  ledToAction: 20, // 제보가 조치 완료로 이어짐 (4-5 ⑦: 재확인 통과로 ○가 반영될 때)
  voteMatch: 2, // 확인 투표(결과가 검증과 일치). 같은 지점 중복 제보의 확인 점수도 같은 값(안)
  recheck: 5, // 조치 후 재확인 참여(통과·불통과 모두)
  companion: 30, // 동행 점검 참여 — 동행 점검 기능이 아직 없어 지급 기록이 생기지 않는다
  fake: -20, // 허위·악의 제보 판정 — 판정 기능이 아직 없어 적용되지 않는다
}
export const REWARD_DAILY_CAP = 50 // 하루 점수 상한(명세서 예시값 50)
export const REWARD_EVIDENCE_PHOTOS = 3
// 등급 조건(명세서 4-2(1))
export const REWARD_GRADE_RULES = {
  g2: { verified: 5, votes: 20 }, // 둘 중 하나
  g3: { verified: 15, ledToAction: 3 }, // 둘 다
  g4: { companion: 3 },
}
// 유형별 엠블럼: 명세서에는 이름 예시만 있고 조건이 없어 "해당 유형의 검증된 제보 N건"(안)으로 둔다.
export const REWARD_TYPE_EMBLEM_MIN = 2

// 재발 판정: 앞선 민원이 조치 완료(또는 재확인 완료)된 뒤, 같은 곳에 새 민원이 접수되면 "재발"로 본다. 아래 값은 팀이 정하는 값이다.
export const RECURRENCE_RADIUS_M = 30 // 같은 곳으로 보는 거리(지점 id가 같으면 거리와 상관없이 같은 곳)
export const RECURRENCE_SAME_TYPE = true // true면 민원 유형이 같을 때만 재발로 본다

// 참여 챌린지(보조 기능). 아래 목표 수치와 거리는 모두 팀이 정하는 값이다. 챌린지를 채워도 점수는 새로 주지 않는다.
export const CHALLENGE_WEEKLY = {
  infoGap: 1, // 정보가 부족한 곳 근처에서 이번 주 검증된 제보
  recheck: 2, // 이번 주 조치 결과 재확인
  newReport: 2, // 이번 주 검증된 새 장애요인 제보
}
export const CHALLENGE_NEAR_RADIUS_M = 50 // "정보가 부족한 곳 근처"로 보는 거리(팀이 정하는 값)

// AI 검색창(홈): 의도 분류 Worker 주소. 공개 주소라 비밀이 아니다. 다른 Worker를 쓰려면 VITE_AI_INTENT_URL로 덮어쓴다.
// import.meta.env는 Vite 밖(Node 시험)에서는 없으므로 ?.로 읽는다.
export const AI_INTENT_URL: string = import.meta.env?.VITE_AI_INTENT_URL || 'https://wheelmap-ai.wotjd0202329.workers.dev'

// 간편 계정·공유 제보 서버 주소. 기본은 위 AI Worker와 같은 주소(같은 Worker가 계정·제보도 맡는다). 다른 주소를 쓰려면 VITE_ACCOUNT_URL로 덮어쓴다.
export const ACCOUNT_URL: string = (import.meta.env?.VITE_ACCOUNT_URL || AI_INTENT_URL).replace(/\/+$/, '')
