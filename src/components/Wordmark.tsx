import '../styles/wordmark.css'

// 서비스 이름 로고: 글자 "이의있음"은 HTML 글자(currentColor), 끝의 "!"는 핀과 점 모양 SVG.
// decorative: 버튼처럼 이미 읽기 이름이 있는 곳 안에 넣을 때 켠다(읽기 이름이 겹치지 않게 숨김).
export function Wordmark({ decorative = false }: { decorative?: boolean }) {
  const a11y = decorative ? { 'aria-hidden': true as const } : { role: 'img' as const, 'aria-label': '이의있음' }
  return (
    <span className="wordmark" {...a11y}>
      <span aria-hidden="true">이의있음</span>
      <svg className="wordmark-bang" viewBox="0 0 76 200" aria-hidden="true" focusable="false">
        <path d="M38 152C38 152 0 98.47 0 46a38 38 0 0 1 76 0C76 98.47 38 152 38 152Z" />
        <circle cx="38" cy="183" r="17" />
      </svg>
    </span>
  )
}
