// 공용 CSV 도구. 엑셀에서 한글이 깨지지 않도록 UTF-8 BOM을 붙인다.
export type CsvRow = (string | number | null)[]

// 쉼표·따옴표·줄바꿈이 있으면 따옴표로 감싸고 따옴표는 두 번 쓴다.
// 글자 칸이 = + - @ 로 시작하면 엑셀이 수식으로 읽을 수 있어 앞에 작은따옴표를 붙인다(text=true일 때만).
export function csvCell(v: string | number | null, text = false): string {
  if (v === null || v === undefined) return ''
  let s = String(v)
  if (text && /^[=+\-@\t\r]/.test(s)) s = `'${s}`
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

// rows를 CSV 글자로 만든다. isTextCol이 true인 칸은 수식 주입을 막는다.
export function toCsv(rows: CsvRow[], isTextCol: (col: number) => boolean): string {
  const lines = rows.map((r) => r.map((v, i) => csvCell(v, isTextCol(i))).join(','))
  return '﻿' + lines.join('\r\n') + '\r\n'
}

export function downloadText(text: string, name: string, type = 'text/csv;charset=utf-8') {
  const url = URL.createObjectURL(new Blob([text], { type }))
  const a = document.createElement('a')
  a.href = url
  a.download = name
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}
