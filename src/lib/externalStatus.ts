import type { ExternalStage, ExternalUpdate, Report } from '../types'

// 접수번호 비교용 정리: 앞뒤 공백·내부 공백·하이픈류를 없애고 대문자로 통일한다. 형식(자릿수·접두어)은 검사하지 않는다.
export const normalizeReceipt = (s: string): string => s.replace(/[\s\-‐-―−]/g, '').toUpperCase()

// 이 기기에 저장된 민원 중 접수번호가 같은 것. 빈 입력은 아무것도 찾지 않는다.
export function findByReceipt(reports: Report[], input: string): Report[] {
  const key = normalizeReceipt(input)
  if (!key) return []
  return reports.filter((r) => r.complaint && normalizeReceipt(r.complaint.receiptNo) === key)
}

export const EXTERNAL_STAGES: ExternalStage[] = ['접수 확인', '이송됨', '처리 중', '답변 완료', '기타']

export const externalUpdates = (r: Report): ExternalUpdate[] => (r.complaint?.external?.updates ?? []).slice().sort((a, b) => a.at.localeCompare(b.at))

export const lastExternal = (r: Report): ExternalUpdate | undefined => {
  const u = externalUpdates(r)
  return u[u.length - 1]
}

export const hasExternalAnswer = (r: Report): boolean => (r.complaint?.external?.updates ?? []).some((u) => u.stage === '답변 완료')

const pad = (n: number) => String(n).padStart(2, '0')
// 앱 시각(ms)의 날짜를 입력칸용 YYYY-MM-DD로
export const ymdOf = (ms: number): string => {
  const d = new Date(ms)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

// 입력칸 날짜 → 저장용 ISO. 오늘이면 앱 시각 그대로, 다른 날이면 그날 정오로 둔다.
export function atFromYmd(ymd: string, nowMs: number): string {
  if (ymd === ymdOf(nowMs)) return new Date(nowMs).toISOString()
  return new Date(`${ymd}T12:00:00`).toISOString()
}
