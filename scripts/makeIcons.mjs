// 홈 화면 아이콘 만들기. 사용법: node scripts/makeIcons.mjs <시안번호 1|2|3|4> [시안 폴더]
// 시안 SVG(icon-N.svg)를 headless Chrome으로 그려 public/icons/ 의 PNG와 public/favicon.svg를 갈아 끼운다.
import { execFileSync } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import os from 'node:os'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const num = process.argv[2]
if (!['1', '2', '3', '4'].includes(num)) {
  console.error('사용법: node scripts/makeIcons.mjs <1|2|3|4> [시안 폴더]')
  process.exit(1)
}
const designDir = resolve(process.argv[3] ?? join(root, 'scripts', 'icons'))
const src = join(designDir, `icon-${num}.svg`)
if (!existsSync(src)) {
  console.error('시안 파일이 없습니다:', src)
  process.exit(1)
}
const chrome = [
  process.env.CHROME_PATH,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
].find((p) => p && existsSync(p))
if (!chrome) {
  console.error('Chrome을 찾지 못했습니다. CHROME_PATH 환경변수에 chrome.exe 경로를 넣어 주세요.')
  process.exit(1)
}

const out = join(root, 'public', 'icons')
mkdirSync(out, { recursive: true })
const profile = join(os.tmpdir(), 'wheelmap-icon-profile')
// 배율로 줄일 때 가장자리에 흰 줄이 생기지 않도록 그림을 6% 키워 감싼 페이지를 그린다(바깥은 잘려 나간다).
mkdirSync(profile, { recursive: true })
const wrap = join(profile, 'wrap.html')
writeFileSync(
  wrap,
  `<!doctype html><meta charset="utf-8"><style>html,body{margin:0;overflow:hidden;background:#1b5fd0}img{position:fixed;left:-3%;top:-3%;width:106%;height:106%}</style><img src="${pathToFileURL(src).href}">`,
)
const url = pathToFileURL(wrap).href

function render(size, file) {
  execFileSync(
    chrome,
    [
      '--headless=new',
      '--disable-gpu',
      '--hide-scrollbars',
      `--user-data-dir=${profile}`,
      // Chrome 창은 너무 작게 만들 수 없어, 512px 창을 배율로 줄여 원하는 크기를 얻는다.
      `--force-device-scale-factor=${size / 512}`,
      '--window-size=512,512',
      `--screenshot=${file}`,
      url,
    ],
    { stdio: 'ignore' },
  )
}

// 시안은 정사각형을 꽉 채우고 중요한 그림이 가운데 80% 안에 있어, 같은 그림을 마스커블에도 쓴다.
render(192, join(out, 'icon-192.png'))
render(512, join(out, 'icon-512.png'))
render(512, join(out, 'icon-maskable-512.png'))
render(180, join(out, 'apple-touch-icon.png'))
copyFileSync(src, join(root, 'public', 'favicon.svg'))
rmSync(profile, { recursive: true, force: true })
console.log(`시안 ${num} 적용 완료: public/icons/*.png, public/favicon.svg`)
