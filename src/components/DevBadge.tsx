// 개발 중 표시: 빌드 정보와 문구를 빨간 글씨로 화면 위쪽 가장자리에 띄운다.
// 끄려면 .env 또는 빌드 환경에 VITE_SHOW_DEV_BADGE=false (기본은 표시, 배포 빌드에서도 표시).
declare const __BUILD_HASH__: string

const SHOW = (import.meta.env as Record<string, string | undefined>).VITE_SHOW_DEV_BADGE !== 'false'

export default function DevBadge() {
  if (!SHOW) return null
  return (
    <div className="dev-badge" role="status">
      <b>Development In Progress</b> · build {__BUILD_HASH__}
    </div>
  )
}
