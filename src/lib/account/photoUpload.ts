// 서버로 올릴 사진 줄이기: 긴 변 1024px, JPEG 품질 0.7(필요하면 더 낮춰) 400KB 이하만 올린다. 캔버스에 다시 그려 EXIF도 남지 않는다.
export const UPLOAD_MAX_EDGE = 1024
export const UPLOAD_MAX_BYTES = 400 * 1024

export async function shrinkForUpload(blob: Blob): Promise<Blob | null> {
  let bmp: ImageBitmap
  try {
    bmp = await createImageBitmap(blob, { imageOrientation: 'from-image' })
  } catch {
    return null
  }
  try {
    const scale = Math.min(1, UPLOAD_MAX_EDGE / Math.max(bmp.width, bmp.height))
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.round(bmp.width * scale))
    canvas.height = Math.max(1, Math.round(bmp.height * scale))
    const ctx = canvas.getContext('2d')
    if (!ctx) return null
    ctx.drawImage(bmp, 0, 0, canvas.width, canvas.height)
    for (const q of [0.7, 0.55, 0.4]) {
      const out = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', q))
      if (out && out.size <= UPLOAD_MAX_BYTES) return out
    }
    return null
  } finally {
    bmp.close()
  }
}
