import { toast } from './uiStore'

// 접수번호 복사: 되면 짧은 알림, 막혀 있으면 직접 복사하라고 알린다. 완료 화면과 처리 흐름이 같이 쓴다.
export async function copyNo(no: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(no)
    toast('접수번호를 복사했어요')
  } catch {
    toast('복사하지 못했어요. 번호를 눌러 선택해 주세요')
  }
}
