// 불러오는 중에 보여 주는 회색 막대 카드(CSS만). 스크린리더에는 label을 읽어 준다.
export default function Skeleton({ rows = 3, label = '불러오는 중이에요' }: { rows?: number; label?: string }) {
  return (
    <div className="sk" role="status" aria-busy="true">
      <span className="sr-only">{label}</span>
      <div className="sk-card" aria-hidden="true">
        <i className="sk-bar sk-w40" />
        {Array.from({ length: rows }, (_, i) => (
          <i key={i} className={'sk-bar' + (i % 2 === 0 ? ' sk-w100' : ' sk-w70')} />
        ))}
      </div>
    </div>
  )
}
