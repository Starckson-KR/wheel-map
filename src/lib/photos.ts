import photosData from '../../data/seed/photos.json'

// 사진 목록(파일명·캡션만). 사진 파일 자체는 번들에 넣지 않는다.
// 개발 서버(vite.config.ts의 dev-photos 플러그인)에서만 /wheel-map/__photos/ 경로로 제공된다.
export type PhotoEntry = {
  barrierId: string
  file: string
  source: string
  caption: string | null
  matchBasis: string
}

const photos = photosData as PhotoEntry[]

export function photosFor(barrierId: string): PhotoEntry[] {
  return photos.filter((p) => p.barrierId === barrierId)
}

export const PHOTOS_VISIBLE = import.meta.env.DEV

export function photoUrl(file: string): string {
  return `${import.meta.env.BASE_URL}__photos/${file.split('/').map(encodeURIComponent).join('/')}`
}
