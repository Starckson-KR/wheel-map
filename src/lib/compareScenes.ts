// 전·후 비교 슬라이더용 시연 그림. 실제 현장·사람·차량 번호가 없는 단순한 일러스트를 SVG로 직접 그렸다(사진 파일 없음).
// 조치 사진이 없는 시연 데이터 제보에만 쓰고, 그림 안에 "시연용 그림" 표시가 항상 들어간다.
const W = 960
const H = 720

const frame = (inner: string) => `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" font-family="'Malgun Gothic','Apple SD Gothic Neo','Noto Sans KR',sans-serif">
<rect width="${W}" height="${H}" fill="#dbeafe"/>${inner}
<rect x="24" y="24" width="200" height="52" rx="26" fill="#191f28" opacity="0.88"/>
<text x="124" y="58" font-size="26" font-weight="700" fill="#fff" text-anchor="middle">시연용 그림</text>
<rect x="0" y="${H - 52}" width="${W}" height="52" fill="#191f28" opacity="0.72"/>
<text x="${W / 2}" y="${H - 18}" font-size="22" fill="#fff" text-anchor="middle">시연용 가상 그림이에요 · 실제 현장이 아니에요</text></svg>`

const toUri = (svg: string) => 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg)

const SIDEWALK = `
<rect y="250" width="${W}" height="150" fill="#bfd7f5"/>
<rect y="330" width="${W}" height="390" fill="#9aa5b1"/>
<polygon points="0,330 ${W},330 ${W},470 0,560" fill="#cfd6dd"/>
<polygon points="0,560 ${W},470 ${W},720 0,720" fill="#6b7684"/>
<g stroke="#eef1f4" stroke-width="3" opacity="0.8"><line x1="0" y1="445" x2="${W}" y2="400"/><line x1="160" y1="560" x2="230" y2="330"/><line x1="320" y1="540" x2="380" y2="330"/><line x1="480" y1="520" x2="520" y2="330"/><line x1="640" y1="505" x2="660" y2="330"/><line x1="800" y1="490" x2="800" y2="330"/></g>`

const POLE_BEFORE = frame(`${SIDEWALK}
<rect x="430" y="150" width="46" height="400" rx="8" fill="#4e5968"/>
<ellipse cx="453" cy="552" rx="70" ry="16" fill="#3d4654" opacity="0.4"/>
<rect x="415" y="150" width="76" height="26" rx="6" fill="#333d4b"/>
<text x="705" y="300" font-size="26" fill="#333d4b" font-weight="700">보도 한가운데 전봇대</text>`)

const POLE_AFTER = frame(`${SIDEWALK}
<rect x="780" y="190" width="40" height="360" rx="8" fill="#4e5968"/>
<ellipse cx="800" cy="552" rx="60" ry="14" fill="#3d4654" opacity="0.4"/>
<rect x="766" y="190" width="68" height="24" rx="6" fill="#333d4b"/>
<path d="M 120 640 h 600" stroke="#1ea672" stroke-width="10" stroke-dasharray="4 16" stroke-linecap="round"/>
<text x="120" y="300" font-size="26" fill="#0b6845" font-weight="700">전봇대를 옮겨 길이 넓어졌어요</text>`)

const ROAD = `
<rect y="250" width="${W}" height="120" fill="#bfd7f5"/>
<rect y="360" width="${W}" height="360" fill="#6b7684"/>
<rect y="360" width="${W}" height="110" fill="#cfd6dd"/>
<g fill="#f2f4f6">
${[0, 1, 2, 3, 4, 5, 6].map((i) => `<rect x="${60 + i * 130}" y="540" width="80" height="150" rx="6"/>`).join('')}
</g>`

const CURB_BEFORE = frame(`${ROAD}
<rect y="470" width="${W}" height="34" fill="#a3adb8"/>
<rect y="504" width="${W}" height="6" fill="#4e5968"/>
<text x="560" y="492" font-size="28" fill="#fff" font-weight="700" stroke="#191f28" stroke-width="0.5">턱이 있어요</text>`)

const CURB_AFTER = frame(`${ROAD}
<polygon points="250,470 710,470 790,540 170,540" fill="#e1e6eb"/>
<polygon points="250,470 710,470 710,504 250,504" fill="#cfd6dd"/>
<path d="M 250 470 L 170 540 M 710 470 L 790 540" stroke="#8b95a1" stroke-width="4"/>
<g stroke="#1ea672" stroke-width="6" stroke-linecap="round" fill="none"><path d="M 480 530 V 480"/><path d="M 462 498 L 480 478 L 498 498"/></g>
<text x="520" y="460" font-size="28" fill="#fff" font-weight="700" stroke="#191f28" stroke-width="0.5">경사로가 생겼어요</text>`)

export type CompareSceneId = 'pole' | 'curb'
export const COMPARE_SCENES: Record<CompareSceneId, { before: string; after: string; alt: string }> = {
  pole: { before: toUri(POLE_BEFORE), after: toUri(POLE_AFTER), alt: '전봇대 시연용 그림' },
  curb: { before: toUri(CURB_BEFORE), after: toUri(CURB_AFTER), alt: '턱·경사로 시연용 그림' },
}

/** 제보 유형 이름으로 그림을 고른다(턱·경사·횡단은 턱 그림, 나머지는 전봇대 그림). */
export function sceneFor(type: string): CompareSceneId {
  return /턱|경사|횡단|단차/.test(type) ? 'curb' : 'pole'
}
