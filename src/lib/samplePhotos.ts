// "샘플 사진으로 해 보기"용 그림. 실제 현장·사람·차량 번호가 없는 단순한 일러스트를 SVG로 그려 JPEG로 바꿔 쓴다.
// 사진 파일을 따로 싣지 않아 앱이 가볍고, 그림 안에 "샘플 사진" 표시가 남는다.
import { PHOTO_QUALITY } from './config'

const W = 960
const H = 720

const frame = (inner: string) => `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" font-family="'Malgun Gothic','Apple SD Gothic Neo','Noto Sans KR',sans-serif">
<rect width="${W}" height="${H}" fill="#dbeafe"/>${inner}
<rect x="24" y="24" width="188" height="52" rx="26" fill="#191f28" opacity="0.88"/>
<text x="118" y="58" font-size="26" font-weight="700" fill="#fff" text-anchor="middle">샘플 사진</text>
<rect x="0" y="${H - 52}" width="${W}" height="52" fill="#191f28" opacity="0.72"/>
<text x="${W / 2}" y="${H - 18}" font-size="22" fill="#fff" text-anchor="middle">체험용 그림이에요 · 실제 현장이 아니에요</text></svg>`

// 1) 보도 한가운데 전봇대가 있어 지나가기 좁은 곳
const POLE = frame(`
<rect y="250" width="${W}" height="150" fill="#bfd7f5"/>
<rect y="330" width="${W}" height="390" fill="#9aa5b1"/>
<polygon points="0,330 ${W},330 ${W},470 0,560" fill="#cfd6dd"/>
<polygon points="0,560 ${W},470 ${W},720 0,720" fill="#6b7684"/>
<g stroke="#eef1f4" stroke-width="3" opacity="0.8"><line x1="0" y1="445" x2="${W}" y2="400"/><line x1="160" y1="560" x2="230" y2="330"/><line x1="320" y1="540" x2="380" y2="330"/><line x1="480" y1="520" x2="520" y2="330"/><line x1="640" y1="505" x2="660" y2="330"/><line x1="800" y1="490" x2="800" y2="330"/></g>
<rect x="430" y="150" width="46" height="400" rx="8" fill="#4e5968"/>
<ellipse cx="453" cy="552" rx="70" ry="16" fill="#3d4654" opacity="0.4"/>
<rect x="415" y="150" width="76" height="26" rx="6" fill="#333d4b"/>
<path d="M 340 640 h 240" stroke="#3182f6" stroke-width="8" stroke-dasharray="4 14" stroke-linecap="round"/>
<text x="705" y="300" font-size="26" fill="#333d4b" font-weight="700">보도 한가운데 전봇대</text>`)

// 2) 횡단보도 앞 턱
const CURB = frame(`
<rect y="250" width="${W}" height="120" fill="#bfd7f5"/>
<rect y="360" width="${W}" height="360" fill="#6b7684"/>
<rect y="360" width="${W}" height="110" fill="#cfd6dd"/>
<rect y="470" width="${W}" height="34" fill="#a3adb8"/>
<rect y="504" width="${W}" height="6" fill="#4e5968"/>
<g fill="#f2f4f6">
${[0, 1, 2, 3, 4, 5, 6].map((i) => `<rect x="${60 + i * 130}" y="540" width="80" height="150" rx="6"/>`).join('')}
</g>
<path d="M 700 468 v 34" stroke="#f04452" stroke-width="6"/>
<path d="M 700 468 l -10 12 M 700 468 l 10 12 M 700 502 l -10 -12 M 700 502 l 10 -12" stroke="#f04452" stroke-width="6" stroke-linecap="round"/>
<text x="730" y="492" font-size="28" fill="#fff" font-weight="700" stroke="#191f28" stroke-width="0.5">턱 높이 약 5cm</text>`)

export const SAMPLE_SCENES = [
  { id: 'pole', label: '전봇대 샘플', svg: POLE, description: '보도 가운데 전봇대가 있어 휠체어가 지나가기 어려워요.' },
  { id: 'curb', label: '턱 샘플', svg: CURB, description: '횡단보도 앞에 턱이 있어 휠체어로 올라가기 어려워요.' },
] as const

export type SampleSceneId = (typeof SAMPLE_SCENES)[number]['id']

/** SVG 그림을 JPEG Blob으로 바꾼다(캔버스). 실패하면 예외를 던진다. */
export async function sampleBlob(id: SampleSceneId): Promise<Blob> {
  const scene = SAMPLE_SCENES.find((s) => s.id === id) ?? SAMPLE_SCENES[0]
  const img = new Image()
  await new Promise<void>((resolve, reject) => {
    img.onload = () => resolve()
    img.onerror = () => reject(new Error('샘플 사진을 만들지 못했어요.'))
    img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(scene.svg)
  })
  const canvas = document.createElement('canvas')
  canvas.width = W
  canvas.height = H
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('샘플 사진을 만들지 못했어요.')
  ctx.drawImage(img, 0, 0, W, H)
  return new Promise<Blob>((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('샘플 사진을 만들지 못했어요.'))), 'image/jpeg', PHOTO_QUALITY))
}

// 샘플 사진으로 올린 제보 표시. Report.sample이 저장소에 실리지 않는 경우를 위해 id도 이 브라우저에 따로 적어 둔다.
const KEY = 'wheelmap.sampleReports'
const readIds = (): string[] => {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? '[]')
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []
  } catch {
    return []
  }
}
export function markSampleReport(id: string) {
  try {
    localStorage.setItem(KEY, JSON.stringify([...readIds().filter((x) => x !== id), id].slice(-200)))
  } catch {
    /* 표시를 못 남겨도 제보는 그대로 */
  }
}
export const isSampleReport = (r: { id: string; sample?: boolean }) => !!r.sample || readIds().includes(r.id)
