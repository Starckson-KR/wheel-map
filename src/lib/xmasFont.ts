// 크리스마스 문구 전용 글꼴 「주아」(Jua, SIL OFL 1.1): 크리스마스 모드일 때만 Google Fonts에서 필요한 글자만 불러온다(평소에는 요청 0건).
// 글꼴이 실제로 불러와졌을 때만 <html class="xm-font-on">을 붙여 적용한다. 못 불러오면(오프라인·차단) 본문 글꼴 그대로라 배치가 깨지지 않는다.
export const XMAS_TITLE = '작은 선물을 준비했어요'
export const XMAS_HINT = '화면을 눌러 보세요'
export const XMAS_MSG = '메리 크리스마스!'
export const XMAS_FONT_TEXTS = [XMAS_TITLE, XMAS_HINT, XMAS_MSG]
const LINK_ID = 'xm-font-link'
const ON_CLASS = 'xm-font-on'

/** 문구에 쓰인 글자를 겹치지 않게 모은다(공백 제외, 순서 고정). */
export function uniqueChars(texts: readonly string[]): string {
  return [...new Set(texts.join('').replace(/\s/g, ''))].sort().join('')
}
/** 필요한 글자만 담은 Google Fonts CSS 주소(순수 함수). */
export function xmasFontUrl(texts: readonly string[] = XMAS_FONT_TEXTS): string {
  return `https://fonts.googleapis.com/css2?family=Jua&display=swap&text=${encodeURIComponent(uniqueChars(texts))}`
}

/** 모드가 켜지는 즉시 부른다: CSS를 붙이고 글꼴 파일까지 미리 받아 둔다. 실패는 조용히 넘어간다. */
export function loadXmasFont(): void {
  if (typeof document === 'undefined' || document.getElementById(LINK_ID)) return
  try {
    const link = document.createElement('link')
    link.id = LINK_ID
    link.rel = 'stylesheet'
    link.href = xmasFontUrl()
    link.onload = () => {
      const text = uniqueChars(XMAS_FONT_TEXTS)
      void document.fonts
        ?.load('1em Jua', text)
        .then((faces) => {
          if (faces.length > 0 && document.getElementById(LINK_ID)) document.documentElement.classList.add(ON_CLASS)
        })
        .catch(() => undefined)
    }
    document.head.appendChild(link)
  } catch {
    /* 못 불러와도 본문 글꼴로 보인다 */
  }
}
/** 모드가 꺼지면 되돌린다. */
export function unloadXmasFont(): void {
  if (typeof document === 'undefined') return
  document.getElementById(LINK_ID)?.remove()
  document.documentElement.classList.remove(ON_CLASS)
}
