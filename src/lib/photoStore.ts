import { PHOTO_MAX_EDGE, PHOTO_QUALITY } from './config'

// 제보 사진 보관(IndexedDB `wheelmap` DB). 서버가 없으므로 이 브라우저에만 저장된다.
const DB_NAME = 'wheelmap'
const STORE = 'photos'

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('이 브라우저에서는 사진을 저장할 수 없습니다.'))
      return
    }
    const req = indexedDB.open(DB_NAME, 1)
    req.onupgradeneeded = () => req.result.createObjectStore(STORE)
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error ?? new Error('사진 저장소를 열지 못했습니다.'))
  })
}

async function withStore<T>(mode: IDBTransactionMode, run: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await openDb()
  try {
    return await new Promise<T>((resolve, reject) => {
      const tx = db.transaction(STORE, mode)
      const req = run(tx.objectStore(STORE))
      tx.oncomplete = () => resolve(req.result)
      tx.onerror = () => reject(tx.error ?? new Error('사진 저장소 오류'))
      tx.onabort = () => reject(tx.error ?? new Error('사진 저장소 오류'))
    })
  } finally {
    db.close()
  }
}

export const savePhoto = (key: string, blob: Blob) => withStore('readwrite', (s) => s.put(blob, key)).then(() => undefined)
export const loadPhoto = (key: string) => withStore<Blob | undefined>('readonly', (s) => s.get(key))
export const clearPhotos = () => withStore('readwrite', (s) => s.clear()).then(() => undefined)

// 긴 변 1280px 이하 JPEG로 줄인다. 캔버스에 다시 그리므로 EXIF(촬영 위치·시각 등)는 남지 않는다.
export async function resizeImage(file: File): Promise<Blob> {
  let src: CanvasImageSource
  let w: number
  let h: number
  let cleanup = () => {}
  try {
    const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' })
    src = bmp
    w = bmp.width
    h = bmp.height
    cleanup = () => bmp.close()
  } catch {
    const url = URL.createObjectURL(file)
    cleanup = () => URL.revokeObjectURL(url)
    const img = new Image()
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve()
      img.onerror = () => reject(new Error('사진을 읽지 못했습니다. 다른 사진을 선택해 주세요.'))
      img.src = url
    })
    src = img
    w = img.naturalWidth
    h = img.naturalHeight
  }
  try {
    const scale = Math.min(1, PHOTO_MAX_EDGE / Math.max(w, h))
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.round(w * scale))
    canvas.height = Math.max(1, Math.round(h * scale))
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('사진을 처리하지 못했습니다.')
    ctx.drawImage(src, 0, 0, canvas.width, canvas.height)
    return await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('사진을 변환하지 못했습니다.'))), 'image/jpeg', PHOTO_QUALITY),
    )
  } finally {
    cleanup()
  }
}
