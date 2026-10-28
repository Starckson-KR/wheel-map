import { useEffect, useState } from 'react'
import { usePhotoUrls } from '../lib/usePhotoUrls'

export function ReportThumb({ photoKey, alt }: { photoKey?: string; alt: string }) {
  const { urls } = usePhotoUrls(photoKey ? [photoKey] : [])
  return urls[0] ? <img className="rp-thumb" src={urls[0]} alt={alt} /> : <span className="rp-thumb rp-thumb-empty" aria-hidden="true" />
}

export default function ReportPhotos({ keys }: { keys: string[] }) {
  const { urls, failed } = usePhotoUrls(keys)
  const [open, setOpen] = useState<number | null>(null)

  useEffect(() => {
    if (open === null) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopImmediatePropagation()
        setOpen(null)
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [open])

  if (keys.length === 0) return <>첨부된 사진이 없어요.</>
  const shown = urls.map((u, i) => ({ u, i })).filter((x): x is { u: string; i: number } => !!x.u)
  return (
    <>
      <div className="bm-thumbs">
        {shown.map(({ u, i }) => (
          <button key={keys[i]} type="button" className="bm-thumb" onClick={() => setOpen(i)} title="사진 확대">
            <img src={u} alt={`제보 사진 ${i + 1}`} />
          </button>
        ))}
      </div>
      {(failed || (urls.length === keys.length && shown.length < keys.length)) && (
        <span className="bm-meta">일부 사진을 불러오지 못했어요. 이 브라우저에 저장되지 않았거나 초기화됐을 수 있어요.</span>
      )}
      {open !== null && urls[open] && (
        <div className="bm-lightbox" role="dialog" aria-modal="true" aria-label="사진 확대" onClick={() => setOpen(null)}>
          <figure onClick={(e) => e.stopPropagation()}>
            <img src={urls[open] as string} alt={`제보 사진 ${open + 1}`} />
            <button type="button" className="bm-lightbox-close" onClick={() => setOpen(null)}>
              닫기
            </button>
          </figure>
        </div>
      )}
    </>
  )
}
