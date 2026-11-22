// BIS 정류소 번호 목록을 Worker 상수로 만든다: data/public/bus-stops.bis.json → worker/src/bisStops.ts
// 사용: node scripts/makeBisStopIds.mjs   (정류소 목록을 다시 받은 뒤에 한 번 돌리고, Worker를 다시 배포한다)
// 앱이 /bis/arrive로 보내는 정류소 번호는 모두 이 목록(src/lib/bus/data.ts의 loadBisStops)에서 나온다.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const src = path.join(root, 'data', 'public', 'bus-stops.bis.json')
const out = path.join(root, 'worker', 'src', 'bisStops.ts')
const ids = [...new Set(JSON.parse(fs.readFileSync(src, 'utf8')).items.map((x) => String(x.id)))].filter((s) => /^\d{1,7}$/.test(s)).sort((a, b) => Number(a) - Number(b))
const body = `// 자동 생성: node scripts/makeBisStopIds.mjs (원본 data/public/bus-stops.bis.json, ${ids.length}곳). 직접 고치지 않는다.
// /bis/arrive는 이 목록의 정류소 번호만 받는다(아무 번호나 보내 하루 상한을 소진하는 것을 막는다).
const IDS = '${ids.join(',')}'
export const BIS_STOP_IDS: ReadonlySet<string> = new Set(IDS.split(','))
`
fs.writeFileSync(out, body)
console.log(`${ids.length}곳 → ${path.relative(root, out)} (${body.length}자)`)
