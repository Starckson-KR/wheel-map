// 리뷰어·시민에게 보이는 문구로 바꾸는 표시 계층. 데이터 파일(data/seed/*.json)은 고치지 않고 화면에 낼 때만 거른다.
// 팀 내부 표기(팀원 이름, 조사 문서의 장 번호, 사진 EXIF, 내부 지점 번호 등)는 여기서 빼거나 공개용 말로 바꾼다.


/** 평가 출처: "팀원 B 표" → "팀 현장조사(안)". 이미 "팀 판정(안)"처럼 공개해도 되는 말이면 그대로 둔다. */
export function publicRatingSource(src?: string): string | null {
  if (!src) return null
  if (/팀원/.test(src)) return '팀 현장조사(안)'
  return src
}

/** 문제 요약: 앞머리 "미흡(서술):", 끝의 출처 괄호 "(… 진술)", "○○ 확인 안 됨" 항목을 화면에서만 뗀다. 남는 것이 없으면 null. */
export function publicIssue(issue?: string): string | null {
  if (!issue) return null
  const text = issue.replace(/^[가-힣]+\(서술\):\s*/, '').replace(/\s*\([^()]*진술\)/g, '').replace(/(^|\s)부록\s*:\s*/g, '$1')
  const parts: string[] = []
  let depth = 0
  let cur = ''
  for (const ch of text) {
    if (ch === '(') depth++
    else if (ch === ')') depth = Math.max(0, depth - 1)
    if (ch === ',' && depth === 0) {
      parts.push(cur)
      cur = ''
    } else cur += ch
  }
  parts.push(cur)
  const out = parts.map((s) => s.trim()).filter((s) => s && !/확인 안 됨/.test(s)).join(', ')
  return out || null
}

/** 동 이름을 화면에 낼 때만 쓴다. 동을 찾지 못해 캐시에 '확인 필요'로 저장된 값(또는 값 없음)은 "기타 지역"으로 보여 준다. 저장 값은 바꾸지 않는다. */
export function dongLabel(name?: string | null): string {
  return !name || name === '확인 필요' ? '기타 지역' : name
}
