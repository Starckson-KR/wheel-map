// 개선계획 반영 후보 CSV. 엑셀에서 한글이 깨지지 않도록 UTF-8 BOM을 붙인다.
export const CSV_HEADER = ['순위', '지점ID', '지점명', '동', '판정', '우선순위 점수', '제보 수', '정류장 수', '시설 수', '대안 경로', '반영 단계', '연결 사업', '예산 항목', '금액(원)', '반영 연도', '메모', '담당 기관']

export type CsvRow = (string | number | null)[]

// 쉼표·따옴표·줄바꿈이 있으면 따옴표로 감싸고 따옴표는 두 번 쓴다.
// 글자 칸이 = + - @ 로 시작하면 엑셀이 수식으로 읽을 수 있어 앞에 작은따옴표를 붙인다(text=true일 때만).
export function csvCell(v: string | number | null, text = false): string {
  if (v === null || v === undefined) return ''
  let s = String(v)
  if (text && /^[=+\-@\t\r]/.test(s)) s = `'${s}`
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

// 글자 칸: 지점명(2), 연결 사업(11), 예산 항목(12), 메모(15), 담당 기관(16)
const TEXT_COLS = new Set([2, 3, 11, 12, 15, 16])

export function buildCsv(rows: CsvRow[]): string {
  const lines = [CSV_HEADER, ...rows].map((r) => r.map((v, i) => csvCell(v, TEXT_COLS.has(i))).join(','))
  return '﻿' + lines.join('\r\n') + '\r\n'
}

export function csvFileName(d = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0')
  return `개선계획_반영후보_${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}.csv`
}
