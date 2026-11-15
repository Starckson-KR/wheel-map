// 시트를 띄울 화면 틀(.bm). 지도는 탭을 바꿔도 숨긴 채 남아 있으므로, 숨긴 지도 안의 .bm을 고르면 시트가 보이지 않는다.
export const sheetHost = (): HTMLElement =>
  [...document.querySelectorAll<HTMLElement>('.bm')].find((el) => !el.closest('[hidden]')) ?? document.body
