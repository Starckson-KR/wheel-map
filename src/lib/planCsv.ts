// 개선계획 반영 후보 CSV. 공용 CSV 도구(csv.ts)를 쓴다.
import { toCsv, type CsvRow } from './csv'

export type { CsvRow }
export { csvCell } from './csv'

export const CSV_HEADER = ['순위', '지점ID', '지점명', '동', '판정', '우선순위 점수', '제보 수', '정류장 수', '시설 수', '대안 경로', '반영 단계', '연결 사업', '예산 항목', '금액(원)', '반영 연도', '메모', '담당 기관']

// 글자 칸: 지점명(2), 연결 사업(11), 예산 항목(12), 메모(15), 담당 기관(16)
const TEXT_COLS = new Set([2, 3, 11, 12, 15, 16])

export function buildCsv(rows: CsvRow[]): string {
  return toCsv([CSV_HEADER, ...rows], (i) => TEXT_COLS.has(i))
}

export function csvFileName(d = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0')
  return `개선계획_반영후보_${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}.csv`
}
