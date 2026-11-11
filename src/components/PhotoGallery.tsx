import { useEffect, useState } from 'react'
import { PHOTOS_VISIBLE, photoUrl, photosFor } from '../lib/photos'

// 지점 사진 썸네일 + 확대 보기. 사진은 개발 서버에서만 보이고, 배포본에는 안내 문구만 나온다.
export default function PhotoGallery({ barrierId }: { barrierId: string }) {
  const photos = photosFor(barrierId)
  const [openIndex, setOpenIndex] = useState<number | null>(null)

  useEffect(() => {
    if (openIndex === null) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        // 확대 보기만 닫고, 지도의 Esc 처리(상세 패널 닫기)로는 넘기지 않는다.
        e.stopImmediatePropagation()
        setOpenIndex(null)
      } else if (e.key === 'ArrowRight') setOpenIndex((i) => (i === null ? i : (i + 1) % photos.length))
      else if (e.key === 'ArrowLeft') setOpenIndex((i) => (i === null ? i : (i - 1 + photos.length) % photos.length))
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [openIndex, photos.length])

  if (photos.length === 0 || !PHOTOS_VISIBLE) return <>사진은 공개용으로 고른 뒤에 추가할 예정이에요.</>

  const current = openIndex === null ? null : photos[openIndex]
  return (
    <>
      <div className="bm-thumbs">
        {photos.map((p, i) => (
          <button key={p.file} type="button" className="bm-thumb" onClick={() => setOpenIndex(i)} title={p.caption ?? '사진 확대'}>
            <img src={photoUrl(p.file)} alt={p.caption ?? `${barrierId} 현장 사진 ${i + 1}`} loading="lazy" />
          </button>
        ))}
      </div>
      <span className="bm-meta">{photos.length}장 · 내부 확인용이라 개발 서버에서만 보여요. 누르면 크게 볼 수 있어요.</span>
      {current && (
        <div className="bm-lightbox" role="dialog" aria-modal="true" aria-label="사진 확대" onClick={() => setOpenIndex(null)}>
          <figure onClick={(e) => e.stopPropagation()}>
            <img src={photoUrl(current.file)} alt={current.caption ?? `${barrierId} 현장 사진`} />
            <figcaption>
              {current.caption ?? '설명 없음'}
              <span className="bm-meta">
                {' '}
                ({(openIndex ?? 0) + 1}/{photos.length} · 출처: {current.source} · Esc로 닫고 ←→로 넘겨요)
              </span>
            </figcaption>
            {photos.length > 1 && (
              <div className="bm-lightbox-nav">
                <button type="button" onClick={() => setOpenIndex((i) => (i === null ? i : (i - 1 + photos.length) % photos.length))}>
                  이전 사진
                </button>
                <button type="button" onClick={() => setOpenIndex((i) => (i === null ? i : (i + 1) % photos.length))}>
                  다음 사진
                </button>
              </div>
            )}
            <button type="button" className="bm-lightbox-close" onClick={() => setOpenIndex(null)}>
              닫기
            </button>
          </figure>
        </div>
      )}
    </>
  )
}
