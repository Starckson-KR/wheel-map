// 자체 보행망 만들기: OpenStreetMap(Overpass API)에서 시범 지역의 걸을 수 있는 길을 한 번 받아 data/routes/walk-graph.json으로 저장한다.
// 사용: node scripts/buildWalkGraph.ts            (받은 원본이 캐시에 있으면 그걸 쓴다)
//       node scripts/buildWalkGraph.ts --refresh  (Overpass를 다시 부른다)
// 이용 정책(https://wiki.openstreetmap.org/wiki/Overpass_API): 정기 사용은 하루 100회·10MB 이하 권장, 앱을 식별하는 User-Agent, 병렬 호출 금지,
// 429·406이면 30초 쉬고 다시. 이 스크립트는 요청을 1회(실패 시 30초 뒤 최대 2회 더)만 보내고 원본은 data/routes/.cache/에 저장한다.
// 자료: © OpenStreetMap contributors, ODbL — https://www.openstreetmap.org/copyright
import fs from 'node:fs'
import path from 'node:path'
import { buildWalkGraph, type OsmEl } from '../src/lib/routing/walkGraph.ts'

const ROOT = path.resolve(import.meta.dirname, '..')
const CACHE = path.join(ROOT, 'data', 'routes', '.cache')
const RAW = path.join(CACHE, 'osm-walk-raw.json')
const OUT = path.join(ROOT, 'data', 'routes', 'walk-graph.json')
// 시범 지역(용봉동 일대): 팀 조사 지점·시연 경로 범위(남 35.1674~북 35.1820, 서 126.8960~동 126.9201)에 약 300m 여유.
const BBOX: [number, number, number, number] = [35.163, 126.892, 35.186, 126.924]
const UA = 'wheel-map-prototype/0.1 (university class project; one-off pedestrian graph download)'

const query = `[out:json][timeout:60];
(
  way["highway"~"^(footway|path|pedestrian|steps|living_street|residential|service|unclassified|tertiary|tertiary_link|secondary|secondary_link|primary|primary_link|trunk|trunk_link|track|cycleway|corridor)$"](${BBOX.join(',')});
  >;
);
out body qt;`

async function fetchRaw(): Promise<string> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const r = await fetch('https://overpass-api.de/api/interpreter', {
      method: 'POST',
      headers: { 'User-Agent': UA, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: 'data=' + encodeURIComponent(query),
    })
    if (r.ok) return await r.text()
    console.log(`Overpass 응답 ${r.status}`)
    if (r.status !== 429 && r.status !== 406 && r.status < 500) break
    console.log('30초 쉬고 다시 시도합니다.')
    await new Promise((res) => setTimeout(res, 30000))
  }
  throw new Error('Overpass에서 자료를 받지 못했습니다.')
}

fs.mkdirSync(CACHE, { recursive: true })
if (process.argv.includes('--refresh') || !fs.existsSync(RAW)) {
  fs.writeFileSync(RAW, await fetchRaw())
  console.log('원본 저장:', RAW)
}
const raw = JSON.parse(fs.readFileSync(RAW, 'utf8')) as { elements: OsmEl[]; osm3s?: { timestamp_osm_base?: string } }
const g = buildWalkGraph(raw.elements, BBOX, {
  source: '© OpenStreetMap contributors (ODbL), Overpass API',
  fetchedAt: raw.osm3s?.timestamp_osm_base ?? new Date().toISOString(),
})
fs.writeFileSync(OUT, JSON.stringify(g))
console.log(`보행망: 점 ${g.n.length / 2}개, 길 토막 ${g.e.length}개, 크기 ${(fs.statSync(OUT).size / 1024).toFixed(0)}KB -> ${OUT}`)
