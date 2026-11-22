import { useEffect, type RefObject } from 'react'

// 시트가 열리면 닫기 버튼(.bm-close)으로 초점을 옮기고, 닫히면 열었던 버튼으로 돌려준다.
export function useSheetFocus(open: boolean, sheet: RefObject<HTMLElement | null>) {
  useEffect(() => {
    if (!open) return
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null
    sheet.current?.querySelector<HTMLElement>('.bm-close')?.focus({ preventScroll: true })
    return () => {
      if (opener && opener.isConnected) opener.focus({ preventScroll: true })
    }
  }, [open, sheet])
}
