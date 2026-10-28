import { useEffect, useState } from 'react'
import { loadPhoto } from './photoStore'

// IndexedDB에 저장된 제보 사진을 불러와 object URL로 바꿔 준다(없으면 null).
export function usePhotoUrls(keys: string[]): { urls: (string | null)[]; failed: boolean } {
  const joined = keys.join('|')
  const [state, setState] = useState<{ joined: string; urls: (string | null)[]; failed: boolean }>({ joined: '', urls: [], failed: false })

  useEffect(() => {
    let cancelled = false
    const created: string[] = []
    ;(async () => {
      let failed = false
      const urls: (string | null)[] = []
      for (const k of joined ? joined.split('|') : []) {
        try {
          const blob = await loadPhoto(k)
          if (blob) {
            const u = URL.createObjectURL(blob)
            created.push(u)
            urls.push(u)
          } else urls.push(null)
        } catch {
          failed = true
          urls.push(null)
        }
      }
      if (cancelled) created.forEach((u) => URL.revokeObjectURL(u))
      else setState({ joined, urls, failed })
    })()
    return () => {
      cancelled = true
      created.forEach((u) => URL.revokeObjectURL(u))
    }
  }, [joined])

  return state.joined === joined ? { urls: state.urls, failed: state.failed } : { urls: [], failed: false }
}
