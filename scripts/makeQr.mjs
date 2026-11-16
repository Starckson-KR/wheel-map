// 피어리뷰용 QR 화면 만들기. 사용법: node scripts/makeQr.mjs
// QR을 SVG로 직접 그려 public/qr.html 에 넣는다(런타임에 외부 서비스를 부르지 않는다). 앱 아이콘은 public/favicon.svg 를 그대로 쓴다.
import QRCode from 'qrcode'
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const URL_ = 'https://starckson-kr.github.io/wheel-map/'
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')

const qr = QRCode.create(URL_, { errorCorrectionLevel: 'M' })
const n = qr.modules.size
const data = qr.modules.data
const margin = 4 // QR 규격의 여백(칸)
let d = ''
for (let y = 0; y < n; y++) {
  let x = 0
  while (x < n) {
    if (!data[y * n + x]) {
      x++
      continue
    }
    let w = 1
    while (x + w < n && data[y * n + x + w]) w++
    d += `M${x + margin} ${y + margin}h${w}v1h-${w}z`
    x += w
  }
}
const size = n + margin * 2
const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" shape-rendering="crispEdges" role="img" aria-label="이의있음! 주소 QR 코드"><rect width="${size}" height="${size}" fill="#fff"/><path d="${d}" fill="#000"/></svg>`

const icon = 'data:image/svg+xml;base64,' + Buffer.from(readFileSync(join(root, 'public', 'favicon.svg'))).toString('base64')

const html = `<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="color-scheme" content="light dark">
<meta name="theme-color" content="#f2f4f6" media="(prefers-color-scheme: light)">
<meta name="theme-color" content="#17171c" media="(prefers-color-scheme: dark)">
<title>이의있음!</title>
<style>
:root{--bg:#f2f4f6;--card:#fff;--text:#191f28;--sub:#6b7684;--chip:#e8f3ff;--chip-text:#1f6de3;--shadow:0 8px 32px rgba(25,31,40,.08)}
@media (prefers-color-scheme:dark){:root{--bg:#17171c;--card:#202027;--text:#f9fafb;--sub:#a0a8b3;--chip:#1c2a40;--chip-text:#8dbcff;--shadow:0 8px 32px rgba(0,0,0,.4)}}
*{box-sizing:border-box}
html,body{margin:0;height:100%}
body{display:flex;align-items:center;justify-content:center;padding:max(20px,env(safe-area-inset-top)) 20px max(20px,env(safe-area-inset-bottom));background:var(--bg);color:var(--text);font-family:Pretendard,"Pretendard Variable","Apple SD Gothic Neo","Malgun Gothic",system-ui,sans-serif;-webkit-font-smoothing:antialiased}
main{display:flex;flex-direction:column;align-items:center;text-align:center;width:100%;max-width:560px;background:var(--card);border-radius:32px;box-shadow:var(--shadow);padding:clamp(24px,4.5vh,44px) clamp(20px,5vw,48px)}
.brand{display:flex;align-items:center;gap:14px}
.brand img{width:clamp(44px,8vh,64px);height:clamp(44px,8vh,64px);border-radius:22%;box-shadow:0 4px 14px rgba(31,109,227,.28)}
h1{margin:0;font-size:clamp(24px,4.6vh,34px);font-weight:700;letter-spacing:-.02em}
.qr{margin-top:clamp(18px,3.6vh,32px);width:min(100%,calc(100vh - 330px),420px);min-width:200px;aspect-ratio:1;background:#fff;border-radius:20px;padding:clamp(6px,1.2vh,12px);box-shadow:0 0 0 1px rgba(0,0,0,.06)}
.qr svg{display:block;width:100%;height:100%;border-radius:12px}
.guide{margin:clamp(16px,3vh,28px) 0 0;font-size:clamp(18px,3vh,22px);font-weight:600;letter-spacing:-.01em;text-wrap:balance;word-break:keep-all}
.url{margin:14px 0 0;padding:8px 16px;border-radius:999px;background:var(--chip);color:var(--chip-text);font-size:clamp(13px,2.2vh,16px);font-weight:600;word-break:break-all}
@media (max-width:480px){main{border-radius:28px}}
</style>
</head>
<body>
<main>
<div class="brand"><img src="${icon}" alt=""><h1>이의있음!</h1></div>
<div class="qr">${svg}</div>
<p class="guide">휴대폰 카메라로 찍어 들어와 주세요.</p>
<p class="url">starckson-kr.github.io/wheel-map</p>
</main>
</body>
</html>
`
writeFileSync(join(root, 'public', 'qr.html'), html)
console.log(`public/qr.html 생성 완료 (${n}x${n} 칸, 주소 ${URL_})`)
