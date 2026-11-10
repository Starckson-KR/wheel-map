// 발표 시연용 모의 민원 접수 API. 실제 국민신문고·안전신문고에는 아무것도 전송하지 않는다(네트워크 호출 없음).
//
// [가정한 API 형식] — 공개 접수 API가 있다고 가정했을 때의 모습이며, 실제 API 명세가 아니다.
//   요청  POST /complaints
//     { channel: string,                 // 예: '안전신문고'
//       title: string, body: string,     // 자동 작성된 민원 문안
//       location: { lat: number, lng: number, address?: string },
//       category: string,                // 제보 유형
//       agencyHints: string[],           // 소관 기관 후보 id (agencies.json)
//       photoCount: number }
//   응답  200
//     { receiptNo: string,               // 'DEMO-'로 시작하는 모의 접수번호
//       receivedAt: string,              // ISO 8601
//       assignedAgencyId: string,        // 담당 기관 배정 결과
//       processingDays: number }         // 처리기한(일)
// 접수번호는 실제 번호처럼 보이지 않도록 항상 'DEMO-' 접두어를 붙인다.
//
// [가정한 API 형식] — 처리 상황 조회. 공개 조회 API가 있다고 가정했을 때의 모습이며, 실제 API 명세가 아니다.
//   요청  GET /complaints/{receiptNo}/status
//   응답  200
//     { receiptNo: string,
//       stage: '접수 확인' | '처리 중' | '답변 완료',   // 앱 안의 현재 상태(history)를 바탕으로 만든 모의 값
//       checkedAt: string,                              // ISO 8601
//       agencyName?: string,
//       summary?: string }                              // 답변 요약(있을 때)

export type MockComplaintRequest = {
  channel: string
  title: string
  body: string
  location: { lat: number; lng: number; address?: string }
  category: string
  agencyHints: string[]
  photoCount: number
  processingDays: number
  nowMs: number
}

export type MockComplaintResponse = {
  receiptNo: string
  receivedAt: string
  assignedAgencyId: string
  processingDays: number
}

export function submitMockComplaint(req: MockComplaintRequest): Promise<MockComplaintResponse> {
  const delay = 1000 + Math.random() * 1000 // 1~2초
  return new Promise((resolve, reject) => {
    setTimeout(() => {
      if (req.agencyHints.length === 0) {
        reject(new Error('담당 기관 후보가 없어 모의 접수를 진행할 수 없습니다.'))
        return
      }
      const d = new Date(req.nowMs)
      const ymd = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`
      resolve({
        receiptNo: `DEMO-${ymd}-${String(Math.floor(Math.random() * 9000) + 1000)}`,
        receivedAt: d.toISOString(),
        assignedAgencyId: req.agencyHints[0],
        processingDays: req.processingDays,
      })
    }, delay)
  })
}

export type MockStatusRequest = {
  receiptNo: string
  history: { status: string; at: string; memo?: string }[]
  agencyName?: string
  nowMs: number
}

export type MockStatusResponse = {
  receiptNo: string
  stage: '접수 확인' | '처리 중' | '답변 완료'
  checkedAt: string
  agencyName?: string
  summary?: string
}

// 모의 처리 상황 조회. 네트워크 호출 없이 앱 안의 처리 기록(history)만 보고 단계를 돌려주며, 1초쯤 기다린 뒤 응답한다.
export function getMockStatus(req: MockStatusRequest): Promise<MockStatusResponse> {
  return new Promise((resolve, reject) => {
    setTimeout(() => {
      if (!req.receiptNo.toUpperCase().startsWith('DEMO-')) {
        reject(new Error('모의 접수번호(DEMO-로 시작)만 모의 조회할 수 있어요.'))
        return
      }
      const last = req.history[req.history.length - 1]?.status
      const stage: MockStatusResponse['stage'] = last === 'resolved' || last === 'rechecked' ? '답변 완료' : last === 'in_progress' ? '처리 중' : '접수 확인'
      const summary = stage === '답변 완료' ? [...req.history].reverse().find((h) => h.status === 'resolved')?.memo : undefined
      resolve({
        receiptNo: req.receiptNo,
        stage,
        checkedAt: new Date(req.nowMs).toISOString(),
        ...(req.agencyName ? { agencyName: req.agencyName } : {}),
        ...(summary ? { summary } : {}),
      })
    }, 1000)
  })
}
