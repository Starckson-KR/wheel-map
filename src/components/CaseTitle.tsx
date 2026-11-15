import { coordText, useVisibleAddress } from '../lib/addressCache'
import type { Report } from '../types'

// 행정 목록의 민원 제목. 시민 제보는 유형만으로는 모두 같아 보이므로 "유형 · 주소"로 보여 준다(보이는 항목만 조회).
export default function CaseTitle({ r, caseName }: { r: Report; caseName: (r: Report) => string }) {
  const [ref, addr] = useVisibleAddress<HTMLElement>(r.lat, r.lng)
  if (r.seedId) return <strong>{caseName(r)}</strong>
  const place = addr.short ?? (addr.status === 'loading' ? '주소를 찾고 있어요…' : coordText(r.lat, r.lng))
  return (
    <strong ref={ref}>
      {r.type} · {place}
    </strong>
  )
}
