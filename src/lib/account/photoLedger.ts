import { SYNC_PHOTOS_KEY } from './keys'

// 서버에 올렸거나(1) 올릴 수 없어 포기한(0) 사진 키 기록. 같은 사진을 다시 올리지 않기 위한 장부.
let ledger: Record<string, 0 | 1> | null = null
function load(): Record<string, 0 | 1> {
  if (ledger) return ledger
  try {
    const v: unknown = JSON.parse(localStorage.getItem(SYNC_PHOTOS_KEY) ?? '{}')
    ledger = typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Record<string, 0 | 1>) : {}
  } catch {
    ledger = {}
  }
  return ledger
}
function save() {
  try {
    localStorage.setItem(SYNC_PHOTOS_KEY, JSON.stringify(ledger))
  } catch {
    /* 저장 실패 시 다음에 한 번 더 올릴 수 있을 뿐이다 */
  }
}
export const isPhotoDone = (key: string) => key in load()
export function markPhotoUploaded(key: string) {
  load()[key] = 1
  save()
}
export function markPhotoSkipped(key: string) {
  load()[key] = 0
  save()
}
export function resetPhotoLedger() {
  ledger = {}
  try {
    localStorage.removeItem(SYNC_PHOTOS_KEY)
  } catch {
    /* 무시 */
  }
}
