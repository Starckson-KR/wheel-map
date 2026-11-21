// 화면에 날짜·금액을 내는 공통 함수(출력은 예전 각 파일의 로컬 함수와 같다).
export const fmtDateTime = (v: string | number) => new Date(v).toLocaleString('ko-KR', { dateStyle: 'medium', timeStyle: 'short' })
export const fmtDay = (v: string | number) => new Date(v).toLocaleDateString('ko-KR', { dateStyle: 'medium' })
export const won = (n: number) => n.toLocaleString('ko-KR')
