// 첫 화면 뒤 장식: 흐린 동네 지도 위로 파란 길이 그려지고, 끝(아이콘 중심)에 핀이 꽂힌다.
// 좌표는 아이콘 중심이 (0,0). 움직임은 onboarding.css(.ob-w-*)에서만 정한다.
const PIN = 'M38 152C38 152 0 98.47 0 46a38 38 0 0 1 76 0C76 98.47 38 152 38 152Z'

// 횡단보도: 세로 길(줄무늬 세로) / 가로 길(줄무늬 가로)
const zebraV = (cx: number, cy: number) => [0, 1, 2, 3, 4].map((k) => <rect key={`v${cx},${cy},${k}`} x={cx - 11 + k * 5.5} y={cy - 8} width={3} height={16} rx={1} />)
const zebraH = (cx: number, cy: number) => [0, 1, 2, 3, 4].map((k) => <rect key={`h${cx},${cy},${k}`} x={cx - 8} y={cy - 11 + k * 5.5} width={16} height={3} rx={1} />)

export function WelcomeMap() {
  return (
    <svg className="ob-w-map" viewBox="-1200 -1000 2400 2000" focusable="false" aria-hidden="true">
      <defs>
        {/* 블록 한 칸(가로 150, 세로 190)과 길 가운데 점선. 길은 x=-110+150k, y=190k */}
        <pattern id="ob-w-grid" x={-110} y={0} width={150} height={190} patternUnits="userSpaceOnUse">
          <rect className="ob-w-block" x={13} y={13} width={124} height={164} rx={10} />
          <path className="ob-w-center" d="M0 0H150M0 0V190" />
        </pattern>
      </defs>
      <g className="ob-w-town">
        <rect x={-1200} y={-1000} width={2400} height={2000} fill="url(#ob-w-grid)" />
        <g className="ob-w-zebra">
          {zebraV(40, 105)}
          {zebraV(-260, 100)}
          {zebraV(190, 280)}
          {zebraV(-110, 300)}
          {zebraH(-40, 190)}
          {zebraH(100, 380)}
          {zebraH(-190, 0)}
          {zebraH(250, 190)}
        </g>
        <g className="ob-w-tree">
          {[[70, 55], [100, 95], [120, 45], [150, 110], [90, 140], [140, 70]].map(([x, y]) => (
            <circle key={`${x},${y}`} cx={x} cy={y} r={6} />
          ))}
        </g>
      </g>
      <path className="ob-w-route" pathLength={1} d="M 190 470 L 190 210 Q 190 190 170 190 L -90 190 Q -110 190 -110 170 L -110 20 Q -110 0 -90 0 L 0 0" />
      <ellipse className="ob-w-ripple" cx={0} cy={0} rx={100} ry={50} />
      <g className="ob-w-pin">
        <path transform="scale(0.5) translate(-38 -152)" d={PIN} />
      </g>
    </svg>
  )
}
