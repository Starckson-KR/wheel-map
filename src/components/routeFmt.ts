// 길찾기 화면이 같이 쓰는 표기 도우미
export const fmtDist = (m: number) => (m >= 1000 ? `${(m / 1000).toFixed(1)}km` : `${Math.round(m)}m`)
export const fmtMin = (s: number) => `${Math.max(1, Math.round(s / 60))}분`
export const WALK_COLOR = 'var(--route-walk)'
