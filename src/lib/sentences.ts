// 한국어 설명 글을 문장 단위로 나눈다(줄바꿈용 순수 함수).
// 자르지 않는 곳: 숫자 소수점(11.5), 괄호·따옴표 안의 마침표, 문장 시작의 번호("1. "),
// URL·주소·전화번호처럼 마침표 뒤가 공백이 아닌 경우, 알려진 줄임말(예: 등.).
const OPEN = '([{「『“‘<'
const CLOSE = ')]}」』”’>'
const TAIL_CLOSERS = ')]}」』”’>"\''
const NO_SPLIT_BEFORE = /(?:^|\s)(?:vs|no|etc|Dr|Mr|Ms|St|Mt|e\.g|i\.e)$/i

export function splitSentences(text: string): string[] {
  const src = text.replace(/\s+$/u, '')
  if (!src.trim()) return src ? [src] : []
  const out: string[] = []
  let depth = 0
  let quoteOpen = false
  let start = 0
  let i = 0
  while (i < src.length) {
    const ch = src[i]
    if (OPEN.includes(ch)) depth++
    else if (CLOSE.includes(ch)) depth = Math.max(0, depth - 1)
    else if (ch === '"') quoteOpen = !quoteOpen
    const isEnd = ch === '.' || ch === '!' || ch === '?' || ch === '…' || ch === '。'
    if (!isEnd) {
      i++
      continue
    }
    // 연속 종결부호와 닫는 괄호·따옴표를 한 덩어리로 본다
    let j = i + 1
    let d: number = depth
    let q: boolean = quoteOpen
    while (j < src.length && (/[.!?…]/.test(src[j]) || TAIL_CLOSERS.includes(src[j]))) {
      const c = src[j]
      if (CLOSE.includes(c)) d = Math.max(0, d - 1)
      else if (c === '"') q = !q
      j++
    }
    const nextIsSpace = j >= src.length || /\s/u.test(src[j])
    let boundary = nextIsSpace && d === 0 && !q
    if (boundary && ch === '.') {
      const before = src.slice(start, i)
      // 문장 시작의 "1." 같은 번호
      if (/^\s*\d+$/u.test(before)) boundary = false
      // 소수점·영문 줄임말
      else if (NO_SPLIT_BEFORE.test(before)) boundary = false
      // 마침표 앞이 영문·숫자 한 글자면(예: "A. ") 번호로 본다
      else if (/(?:^|\s)[A-Za-z가-하]$/u.test(before) && j - i === 1 && /^\s*[A-Za-z가-하]$/u.test(before)) boundary = false
    }
    if (boundary && j < src.length) {
      // "예: …" 처럼 다음 말이 앞 문장을 받는 경우는 붙여 둔다
      const rest = src.slice(j).trimStart()
      if (/^(?:등|따위)[\s,.]/u.test(rest) || /^(?:이?라고|이?라는|이?라며)(?:\s|$)/u.test(rest)) boundary = false
    }
    if (boundary) {
      const piece = src.slice(start, j).trim()
      if (piece) out.push(piece)
      start = j
      while (start < src.length && /\s/u.test(src[start])) start++
      i = start
      depth = 0
      quoteOpen = false
      continue
    }
    i = j
    depth = d
    quoteOpen = q
  }
  const last = src.slice(start).trim()
  if (last) out.push(last)
  return out.length ? out : [src]
}

// 줄바꿈 다듬기(글 자체는 그대로, 보이지 않는 글자만 더한다). 여러 번 적용해도 결과가 같다.
// - 가운뎃점(·)은 줄 맨 앞에 오지 않게: 앞은 붙이고(WORD JOINER) 뒤에서만 줄을 바꿀 수 있게(ZERO WIDTH SPACE).
//   "구·시"처럼 양쪽이 한 글자면 아예 붙인다.
// - "할 수", "볼 것", "갈 때"처럼 앞말에 붙어야 하는 의존명사와, "11만 원"처럼 숫자와 단위는 줄 사이에서 갈리지 않게(NBSP)
// - 전화번호·번지("062-410-6382", "45-4 부근")는 하이픈에서 끊기지 않게, 괄호는 앞말에 붙여 "검증자(" 앞에서 끊기지 않게
const BOUND_NOUN = /([가-힣]) +(수|것|때|데|줄|뿐|바|듯|만큼|번)(?=[ .,!?)가-힣]|$)/gu
const NUM_UNIT = /(\d[\d,.]*(?:만|천|억)?) +(원|건|명|번|곳|개|점|일|월|년|세|회|장|분|초|시간|시|m|km|cm|%)(?![가-힣A-Za-z])/gu
export function tidyBreaks(s: string): string {
  return s
    .replace(/[⁠​]*·[⁠​]*/g, '⁠·​')
    .replace(/(^|[^가-힣])([가-힣])⁠·​([가-힣])(?![가-힣])/g, '$1$2⁠·⁠$3')
    .replace(BOUND_NOUN, '$1 $2')
    .replace(NUM_UNIT, '$1 $2')
    .replace(/(\d)⁠?-⁠?(?=\d)/g, '$1⁠-⁠')
    .replace(/([가-힣\d]) *⁠?(?=\()/g, (m, c) => (m === c ? c + '⁠' : m))
    .replace(/([가-힣\d]) +부근/g, '$1 부근')
}
