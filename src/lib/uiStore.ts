import { create } from 'zustand'

// 확인 시트와 가벼운 알림(토스트·스낵바)을 어디서든 부르는 작은 저장소. 저장은 하지 않는다(화면 상태만).
export type ConfirmOptions = {
  title: string
  body?: string
  confirmLabel?: string
  cancelLabel?: string
  /** 되돌릴 수 없는 동작이면 true(확인 버튼이 빨강) */
  danger?: boolean
}
type ConfirmReq = ConfirmOptions & { id: number; resolve: (ok: boolean) => void }
export type Notice = { id: number; message: string; undo?: () => void; undoLabel: string; ms: number }

type UiState = {
  confirm: ConfirmReq | null
  notice: Notice | null
}

export const useUi = create<UiState>(() => ({ confirm: null, notice: null }))

let seq = 0

/** 브라우저 기본 confirm 대신 쓰는 바텀시트. 확인하면 true, 취소·Esc·바깥 누름은 false */
export function confirmSheet(opts: ConfirmOptions): Promise<boolean> {
  return new Promise((resolve) => {
    useUi.getState().confirm?.resolve(false)
    useUi.setState({ confirm: { ...opts, id: ++seq, resolve } })
  })
}

export function closeConfirm(ok: boolean) {
  const c = useUi.getState().confirm
  if (!c) return
  useUi.setState({ confirm: null })
  c.resolve(ok)
}

/** 2초 동안 보이는 완료 알림(복사·저장·등록 등) */
export function toast(message: string) {
  useUi.setState({ notice: { id: ++seq, message, undoLabel: '', ms: 2000 } })
}

/** 되돌리기 버튼이 있는 알림(5초). 누르면 undo를 부르고 닫는다 */
export function snack(message: string, undo: () => void, undoLabel = '되돌리기') {
  useUi.setState({ notice: { id: ++seq, message, undo, undoLabel, ms: 5000 } })
}

export function dismissNotice() {
  useUi.setState({ notice: null })
}
