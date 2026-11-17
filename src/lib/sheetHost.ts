import { useEffect, useState } from 'react'

// 시트를 띄울 화면 틀(.bm). 지도는 탭을 바꿔도 숨긴 채 남아 있으므로, 숨긴 지도 안의 .bm을 고르면 시트가 보이지 않는다.

/** 후보 중 숨겨지지 않은 첫 번째(순수 로직). 모두 숨겨졌으면 undefined */
export function pickVisible<T>(candidates: readonly T[], isHidden: (c: T) => boolean): T | undefined {
  return candidates.find((c) => !isHidden(c))
}

export const sheetHost = (): HTMLElement => pickVisible([...document.querySelectorAll<HTMLElement>('.bm')], (el) => !!el.closest('[hidden]')) ?? document.body

// 화면이 바뀌는 바로 그 렌더 중에는 DOM에 아직 이전 화면(숨기기 전 지도)이 남아 있다. 렌더 중에 sheetHost()를 부르면
// 곧 숨겨질 지도 틀을 골라 시트가 안 보이게 된다(뒤로가기로 홈에 돌아오며 바로 열리는 시트가 그랬다).
// 이 훅은 화면이 반영된 뒤(효과)에 고르므로 그때의 보이는 틀이 정해진다. active가 꺼지면 null.
export function useSheetHost(active: boolean): HTMLElement | null {
  const [host, setHost] = useState<HTMLElement | null>(null)
  useEffect(() => {
    // DOM(화면 반영 뒤의 보이는 틀)을 읽어 맞추는 것이라 효과 안에서 상태로 옮기는 게 맞다
    // oxlint-disable-next-line react/set-state-in-effect
    setHost(active ? sheetHost() : null)
  }, [active])
  return host
}
