// 리뷰어·시민에게 보이는 문구로 바꾸는 표시 계층. 데이터 파일(data/seed/*.json)은 고치지 않고 화면에 낼 때만 거른다.
// 팀 내부 표기(팀원 이름, 조사 문서의 장 번호, 사진 EXIF, 내부 지점 번호 등)는 여기서 빼거나 공개용 말로 바꾼다.

const INTERNAL_WORDS = /팀원|원문|종합본|EXIF|사용자 확인|사용자가|사용자 입력|원본 배치|조사자|판정 근거|사진\s*[①-⑳]|\d+장\)?\s*보유/
const INTERNAL_ID = /(?<![A-Za-z])[A-Z]{1,2}-?\d{2}(?!\d)|(?<![A-Za-z])[A-Z]-[a-zA-Z](?![A-Za-z])/ // R19, C12, W-B 같은 지점 번호
const DOC_REF = /\s*\((?:[^()]*?)?\d?\s*장\s*[①-⑳0-9]+[^()]*\)|\s*,?\s*\d장\s*[①-⑳0-9]+/g // (2장 ③) (…, 2장 12)

/** 평가 출처: "팀원 B 표" → "팀 현장조사(안)". 이미 "팀 판정(안)"처럼 공개해도 되는 말이면 그대로 둔다. */
export function publicRatingSource(src?: string): string | null {
  if (!src) return null
  if (/팀원/.test(src)) return '팀 현장조사(안)'
  return src
}

/** 조사 정보 한 줄: 조사자 이름은 빼고 "팀 현장조사(안) · 2026-09-30"처럼. */
export function publicSurvey(source: 'team_survey' | 'interview', surveyedAt?: string): string {
  const base = source === 'interview' ? '인터뷰 진술' : '팀 현장조사(안)'
  return surveyedAt ? `${base} · ${surveyedAt}` : base
}

/** 비고: 문장 단위로 나눠 내부 작업 메모가 든 문장은 뺀다. 남는 것이 없으면 null. */
export function publicNote(note?: string): string | null {
  if (!note) return null
  const cleaned = note.replace(/\(팀원\s?[A-Z]\)/g, '')
  const parts = cleaned
    .split(/(?<=[.다요음])\s+/)
    .map((s) => s.trim())
    .filter((s) => s && !INTERNAL_WORDS.test(s) && !INTERNAL_ID.test(s))
  const out = parts.join(' ').trim()
  return out || null
}

/** "확인이 더 필요해요" 항목: 문서 장 번호를 지우고 팀원 이름 표기를 걷어 낸 뒤, 그래도 내부 메모인 항목은 뺀다. */
export function publicNeedsCheck(items?: string[]): string[] {
  if (!items) return []
  const out: string[] = []
  for (const raw of items) {
    const t = raw
      .replace(DOC_REF, '')
      .replace(/팀원\s?[A-Z]\s?/g, '')
      .replace(/\s{2,}/g, ' ')
      .trim()
    if (!t || INTERNAL_WORDS.test(t) || INTERNAL_ID.test(t)) continue
    if (!out.includes(t)) out.push(t)
  }
  return out
}
