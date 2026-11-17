// 화면이 숨겨지면(다른 탭·앱 전환·화면 꺼짐) <html data-page-hidden>을 붙인다.
// 오래 도는 장식 움직임(시작 화면 빛, 검색창 테두리)이 CSS에서 이 속성을 보고 멈춘다.
export function installPageHidden(): void {
  const el = document.documentElement
  const sync = () => el.toggleAttribute('data-page-hidden', document.hidden)
  document.addEventListener('visibilitychange', sync)
  sync()
}
