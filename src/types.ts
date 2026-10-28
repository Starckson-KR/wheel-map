// 데이터 모델(docs/명세서_5장_수정안.md 기준, 지금 필요한 필드만). 좌표는 [위도, 경도] 순서.
export type LatLng = [number, number]

export type Geometry =
  | { kind: 'point'; at: LatLng }
  | { kind: 'line'; path: LatLng[] } // 2개 이상
  | { kind: 'area'; path: LatLng[] } // 3개 이상, 첫 점을 반복하지 않음

// group(여러 점): 항목 자체에는 모양이 없고 하위 점으로만 위치를 나타낸다.
export type BarrierKind = 'point' | 'line' | 'area' | 'group'

export type Rating = 'O' | 'TRIANGLE' | 'X'

export type Measurement = { label: string; value: string }

// data/seed/barriers.json 한 항목: 속성만. 위치는 pilot_coords.json에서 id로 합친다.
export type BarrierAttrs = {
  id: string
  name?: string
  type: string
  reportType?: string // 명세서 4-1(1)의 12종 중 하나(자료로 판단되는 것만)
  rating?: Rating
  ratingSource?: string
  issue?: string
  measurements: Measurement[]
  surveyor?: string
  surveyedAt?: string
  source: 'team_survey' | 'interview'
  photos: string[]
  note: string
  needsCheck?: string[]
}

// 합친 결과(속성 + 위치)
export type Barrier = BarrierAttrs & {
  name: string
  kind: BarrierKind
  geometry: Geometry | null
  parentId?: string
  locationStatus?: '미확정'
}

// ---- 시민 제보(명세서 5장 Report + 상태 흐름 4-5) ----
export type ReportStatus =
  | 'submitted'
  | 'pending'
  | 'merged'
  | 'verified'
  | 'rejected'
  | 'assigned'
  | 'filed'
  | 'in_progress'
  | 'resolved'
  | 'rechecked'

export type ReportCategory = 'fixed' | 'temporary'

export type Report = {
  id: string
  barrierId?: string // 합쳐진 대상(기존 제보 id 또는 시드 지점 id)
  userId: string
  createdAt: string
  lat: number
  lng: number
  type: string
  category: ReportCategory
  photos: string[] // IndexedDB 키
  description: string
  measurements?: { widthM?: number; curbCm?: number }
  expiresAt?: string // 일시형만
  status: ReportStatus
  verification: {
    votes: number
    voterIds: string[]
    verifierId?: string
    result?: 'confirmed' | 'rejected'
    reason?: string
    rating?: Rating // 검증자 ○△X 판정(없으면 '검증자 판정 대기')
  }
  history: { status: ReportStatus; at: string; by: string; memo?: string; passable?: boolean }[] // passable: 재확인 기록의 통과 여부(리워드 계산용)
  // 3단계
  locationKind?: string // 위치 성격(조사 문서 분류)
  seedId?: string // 팀 조사 지점에서 시작한 흐름이면 그 지점 id
  complaint?: {
    channel: string
    receiptNo: string
    submittedAt: string
    mode: 'link' | 'mock'
    agencyIds: string[]
    assignedAgencyId?: string
    deadlineDays: number
  }
  demo?: boolean // 시연 데이터 채우기로 만든 건
  lastCheckedAt?: string // 사후 점검 기준일(조치 완료·재확인 통과 시 갱신)
  transfers?: {
    fromAgencyId: string
    toAgencyId: string
    reason: string
    at: string
    by: string
    status: 'requested' | 'accepted' | 'rejected'
    decidedAt?: string
    decidedBy?: string
  }[]
  action?: {
    description: string
    beforePhotos: string[]
    afterPhotos: string[]
    doneAt: string
    recheck?: { passable: boolean; at: string; by: string }
  }
}
