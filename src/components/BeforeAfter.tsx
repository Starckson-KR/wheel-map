import ReportPhotos from './ReportPhotos'
import type { Report } from '../types'

// 조치 전/후 사진을 나란히 보여 준다. 조치 전 사진이 없으면 제보 사진을 대신 쓴다. 가짜 사진은 넣지 않는다.
export default function BeforeAfter({ report: r }: { report: Report }) {
  const own = r.action?.beforePhotos ?? []
  const after = r.action?.afterPhotos ?? []
  const fallback = own.length === 0 && r.photos.length > 0
  const before = own.length > 0 ? own : r.photos
  if (after.length === 0) return <p className="ba-empty">조치 사진이 아직 없어요</p>
  return (
    <div className="ba" role="group" aria-label="조치 전 후 사진 비교">
      <figure>
        <figcaption>조치 전{fallback ? ' (제보 사진)' : ''}</figcaption>
        {before.length > 0 ? <ReportPhotos keys={before} /> : <p className="ba-none">조치 전 사진이 없어요</p>}
      </figure>
      <figure>
        <figcaption>조치 후</figcaption>
        <ReportPhotos keys={after} />
      </figure>
    </div>
  )
}
