// 대규모 시연 데이터 파일 생성: 같은 순수 모듈(src/lib/demoLarge.ts)로 data/demo/large-demo.json을 만든다.
// 사용: node scripts/genDemo.ts [--now=ISO]   (기본: 지금 시각 기준. 같은 now면 같은 결과)
// 결과: data/demo/large-demo.json (형식 wheelmap-demo v1). 팀원 폰의 시연 도구 > "시연 데이터 가져오기"로 불러온다.
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import './registerTs.mjs';

const ROOT = path.resolve(import.meta.dirname, '..');
const readJson = <T>(p: string): T => JSON.parse(fs.readFileSync(path.join(ROOT, p), 'utf8'));

const lib = await import(pathToFileURL(path.join(ROOT, 'src/lib/demoLarge.ts')).href);
const merge = await import(pathToFileURL(path.join(ROOT, 'src/lib/seedMerge.ts')).href);

export function generate(nowMs: number) {
  const seed = path.join('data', 'seed');
  const barriers = merge.mergeBarriers(
    readJson<any[]>(path.join(seed, 'barriers.json')),
    readJson<any[]>(path.join(seed, 'pilot_coords.json')),
    readJson<any[]>(path.join(seed, 'pilot_candidates.json')),
    readJson<any[]>(path.join(seed, 'provisional_coords.json')),
  );
  const pub = (n: string) => readJson<{ items: any[] }>(path.join('data', 'public', n + '.json')).items;
  const candidates = lib.pickCandidates({ crosswalk: pub('crosswalks'), bus: pub('bus-stops'), facility: pub('facilities') });
  const res = lib.buildLargeDemo({ now: nowMs, candidates, avoid: lib.avoidFromBarriers(barriers) });
  return { res, file: lib.makeDemoFile(res.users, res.reports, new Date(nowMs).toISOString()) };
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename)) {
  const arg = process.argv.find((a) => a.startsWith('--now='));
  const nowMs = arg ? new Date(arg.slice(6)).getTime() : Date.now();
  if (Number.isNaN(nowMs)) throw new Error('--now 값이 날짜가 아니에요');
  const { res, file } = generate(nowMs);
  const out = path.join(ROOT, 'data', 'demo', 'large-demo.json');
  fs.mkdirSync(path.dirname(out), { recursive: true });
  const json = JSON.stringify(file);
  fs.writeFileSync(out, json);
  console.log('저장:', out);
  console.log('지점', res.stats.sites, '· 제보', res.stats.reports, '· 사용자', res.stats.users, '· 후보', res.stats.candidates, '· 재발 지점', res.stats.recurrenceSites, '· 크기', Math.round(json.length / 1024), 'KB');
}
