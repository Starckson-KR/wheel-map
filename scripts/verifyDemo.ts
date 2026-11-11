// 대규모 시연 데이터 검증: 같은 now로 데이터를 만들어 기존 계산 코드(리워드·랭킹·개선 현황·재발·보고서)로 숫자를 출력한다.
// 사용: node scripts/verifyDemo.ts [--now=ISO] [--file]   (--file이면 data/demo/large-demo.json을 읽어 검증)
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import './registerTs.mjs';

const ROOT = path.resolve(import.meta.dirname, '..');
const imp = (p: string) => import(pathToFileURL(path.join(ROOT, 'src/lib', p)).href);
const lib = await imp('demoLarge.ts');
const merge = await imp('seedMerge.ts');
const { computeRewards } = await imp('rewards.ts');
const { computeRanking } = await imp('ranking.ts');
const { buildProgress } = await imp('progress.ts');
const { computeRecurrence } = await imp('recurrence.ts');
const { statsOf } = await imp('reportStats.ts');
const { buildDemoReports } = await imp('demoData.ts');
const { distanceM } = await imp('geo.ts');
const { REWARD_DAILY_CAP } = await imp('config.ts');
const { deadlineOf, DAY } = await imp('caseMetrics.ts');

const readJson = <T>(p: string): T => JSON.parse(fs.readFileSync(path.join(ROOT, p), 'utf8'));
const argNow = process.argv.find((a) => a.startsWith('--now='));
const now = argNow ? new Date(argNow.slice(6)).getTime() : Date.now();

const seed = 'data/seed';
const barriers = merge.mergeBarriers(
  readJson<any[]>(`${seed}/barriers.json`),
  readJson<any[]>(`${seed}/pilot_coords.json`),
  readJson<any[]>(`${seed}/pilot_candidates.json`),
  readJson<any[]>(`${seed}/provisional_coords.json`),
);

let reports: any[];
let users: { id: string; nickname: string }[];
let fileNow = now;
let jsonBytes = 0;
if (process.argv.includes('--file')) {
  const text = fs.readFileSync(path.join(ROOT, 'data/demo/large-demo.json'), 'utf8');
  const parsed = lib.parseDemoFile(text);
  if (!parsed.ok) throw new Error('파일 검사 실패: ' + parsed.message);
  reports = parsed.file.reports;
  users = parsed.file.users;
  fileNow = new Date(parsed.file.generatedAt).getTime();
  jsonBytes = text.length;
} else {
  const pub = (n: string) => readJson<{ items: any[] }>(`data/public/${n}.json`).items;
  const candidates = lib.pickCandidates({ crosswalk: pub('crosswalks'), bus: pub('bus-stops'), facility: pub('facilities') });
  const t0 = performance.now();
  const res = lib.buildLargeDemo({ now, candidates, avoid: lib.avoidFromBarriers(barriers) });
  console.log(`생성 시간 ${Math.round(performance.now() - t0)}ms · 지점 ${res.stats.sites} (후보 ${res.stats.candidates})`);
  reports = res.reports;
  users = res.users;
  jsonBytes = JSON.stringify(lib.makeDemoFile(users, reports, new Date(now).toISOString())).length;
}
const N = reports.length;
const pctS = (a: number, b = N) => `${a} (${((a / b) * 100).toFixed(1)}%)`;
const count = <T,>(arr: T[], f: (x: T) => string) => {
  const m: Record<string, number> = {};
  for (const x of arr) m[f(x)] = (m[f(x)] ?? 0) + 1;
  return m;
};
const show = (m: Record<string, number>, total = N) =>
  Object.entries(m).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${pctS(v, total)}`).join(' · ');

console.log('\n== 규모 ==');
console.log('제보', N, '· 사용자', users.length, '· JSON', Math.round(jsonBytes / 1024), 'KB (localStorage 한도 약 5MB의', ((jsonBytes * 2) / (5 * 1048576) * 100).toFixed(0) + '%, UTF-16 2바이트 계산)');
console.log('닉네임 중복', users.length - new Set(users.map((u) => u.nickname)).size, '· id 중복', N - new Set(reports.map((r) => r.id)).size);
console.log('모두 demo·large·사진없음·(시연) 표기:', reports.every((r) => r.demo === true && r.demoSet === 'large' && r.photos.length === 0 && r.description.startsWith('(시연)')));

console.log('\n== 상태 분포 ==');
console.log(show(count(reports, (r) => r.status)));
console.log('유형:', show(count(reports, (r) => r.type)));
console.log('위치 성격:', show(count(reports, (r) => r.locationKind)));
const verified = reports.filter((r) => r.verification.rating);
console.log('판정(검증 후):', show(count(verified, (r) => r.verification.rating), verified.length));
console.log('날짜 구간(일 전):', show(count(reports, (r) => { const d = (now - new Date(r.createdAt).getTime()) / DAY; return d < 7 ? '0-7' : d < 14 ? '7-14' : d < 30 ? '14-30' : d < 60 ? '30-60' : '60-90'; })));

console.log('\n== 개선 현황·처리율 ==');
const prog = buildProgress({ reports, barriers: [], plans: {}, now, periodDays: null, placeName: () => '', seedName: () => '' });
const s = prog.summary;
console.log('접수 제보', s.received, '· 기관 접수(filed)', s.filed, '· 해결', s.done, '· 처리율(개선율)', s.rate === null ? '-' : (s.rate * 100).toFixed(1) + '%', '· 평균 처리일', s.avgDays?.toFixed(1));
console.log('단계 수:', JSON.stringify(s.counts));
const solved = reports.filter((r) => r.status === 'resolved' || r.status === 'rechecked').length;
console.log('조치 완료+재확인 / 전체 제보', pctS(solved), '· 재확인 완료', pctS(reports.filter((r) => r.status === 'rechecked').length));
const overdue = reports.filter((r) => r.complaint && (deadlineOf(r, now)?.overdueDays ?? 0) > 0).length;
console.log('처리기한 경과', pctS(overdue), '· 장기 미조치(60일+)', reports.filter((r) => r.complaint && (deadlineOf(r, now)?.longDays ?? 0) > 0).length);
console.log('이관: 요청 중', reports.filter((r) => r.transfers?.some((t: any) => t.status === 'requested')).length, '· 수락', reports.filter((r) => r.transfers?.some((t: any) => t.status === 'accepted')).length, '· 반려', reports.filter((r) => r.transfers?.some((t: any) => t.status === 'rejected')).length);

console.log('\n== 재발 ==');
const t1 = performance.now();
const rec = computeRecurrence(reports);
console.log('재발 계산', Math.round(performance.now() - t1), 'ms · 재발 건', rec.byId.size, '· 재발 지점', rec.sites.length, '· 재발 횟수 분포', JSON.stringify(count(rec.sites, (x: any) => String(x.recurIds.length))));
const st = statsOf(reports, now, rec);
console.log('분기 통계(전체):', JSON.stringify(st));

console.log('\n== 규칙 검사 ==');
let bad = 0;
const byId = new Map(reports.map((r) => [r.id, r]));
for (const r of reports) {
  const c = new Date(r.createdAt).getTime();
  for (const h of r.history) if (new Date(h.at).getTime() < c) bad++;
}
console.log('단계 날짜 < 접수일 위반:', bad);
let sorted = 0;
for (const r of reports) for (let i = 1; i < r.history.length; i++) if (new Date(r.history[i].at).getTime() < new Date(r.history[i - 1].at).getTime()) sorted++;
console.log('이력 시각이 거꾸로인 항목:', sorted);
if (sorted > 0 && process.argv.includes('--debug')) for (const r of reports) for (let i = 1; i < r.history.length; i++) if (new Date(r.history[i].at).getTime() < new Date(r.history[i - 1].at).getTime()) console.log('  거꾸로:', r.id, r.status, r.history.map((h: any) => h.status + '@' + h.at.slice(5, 16)).join(' > '));
if (process.argv.includes('--debug')) for (const r of reports) if (r.history.some((h: any) => new Date(h.at).getTime() > now + 1000)) console.log('  미래:', r.id, r.status, r.history.map((h: any) => h.status + '@' + h.at.slice(5, 16)).join(' > '));
console.log('미래 시각:', reports.filter((r) => r.history.some((h: any) => new Date(h.at).getTime() > now + 1000) || new Date(r.createdAt).getTime() > now).length);
let selfVote = 0;
let dupVote = 0;
for (const r of reports) {
  if (r.verification.voterIds.includes(r.userId)) selfVote++;
  if (new Set(r.verification.voterIds).size !== r.verification.voterIds.length) dupVote++;
}
console.log('투표자=제보자:', selfVote, '· 중복 투표:', dupVote);
const receipts = reports.filter((r) => r.complaint).map((r) => r.complaint.receiptNo);
console.log('접수번호 수', receipts.length, '· 중복', receipts.length - new Set(receipts).size, '· 형식 DEMO-LRG-NNNN 위반', receipts.filter((x: string) => !/^DEMO-LRG-\d{4}$/.test(x)).length);
console.log('합침 대상 없음:', reports.filter((r) => r.status === 'merged' && !byId.has(r.barrierId)).length);
const rechk = reports.flatMap((r) => r.history.filter((h: any) => h.status === 'rechecked').map((h: any) => [r, h]));
console.log('재확인자=제보자:', rechk.filter(([r, h]: any) => r.userId === h.by).length);

console.log('\n== 하루 점수 상한 ==');
const uids = [...users.map((u) => u.id)];
const t2 = performance.now();
const rw = computeRewards(reports, uids);
console.log('리워드 계산(300명)', Math.round(performance.now() - t2), 'ms');
let cappedEvents = 0;
let overCapDays = 0;
const perDay = new Map<string, number>();
let maxDay = 0;
for (const u of uids) {
  for (const e of rw[u].events) {
    if (e.points < e.base) cappedEvents++;
    const k = u + '|' + new Date(e.at).toLocaleDateString('sv-SE');
    perDay.set(k, (perDay.get(k) ?? 0) + e.base);
  }
}
for (const v of perDay.values()) { if (v > REWARD_DAILY_CAP) overCapDays++; maxDay = Math.max(maxDay, v); }
console.log(`상한(${REWARD_DAILY_CAP}) 때문에 깎인 사건: ${cappedEvents} · 상한 넘은 사용자-날: ${overCapDays} · 하루 최대 규칙 점수: ${maxDay}`);

console.log('\n== 사용자 활동 ==');
const perUser = count(reports, (r) => r.userId);
const sortedCnt = Object.values(perUser).sort((a, b) => b - a);
const top5 = Math.ceil(users.length * 0.05);
console.log(`제보한 사용자 ${sortedCnt.length}/${users.length} · 상위 5%(${top5}명) 제보 비중 ${((sortedCnt.slice(0, top5).reduce((a, b) => a + b, 0) / N) * 100).toFixed(1)}% · 1~2건인 사용자 ${sortedCnt.filter((x) => x <= 2).length}명(${((sortedCnt.filter((x) => x <= 2).length / sortedCnt.length) * 100).toFixed(0)}%) · 최다 ${sortedCnt[0]}건`);
const voteOnly = users.filter((u) => !perUser[u.id]).length;
console.log('제보 없이 투표·재확인만 한 사용자(후보):', voteOnly, '· 그중 점수 있는 사용자', users.filter((u) => !perUser[u.id] && rw[u.id].total > 0).length);

console.log('\n== 랭킹 ==');
for (const period of ['week', 'month'] as const) {
  const t = performance.now();
  const rk = computeRanking(reports, uids, period, now);
  console.log(`${period} ${rk.range.label}: 점수 있는 사용자 ${rk.ranked.length}명 · 1위 ${rk.ranked[0]?.points ?? 0}점 · 계산 ${Math.round(performance.now() - t)}ms`);
}
// 지난 7일(달력 주와 무관)에도 점수 얻은 사람 수
const since = now - 7 * DAY;
const wk = new Set<string>();
for (const u of uids) if (rw[u].events.some((e: any) => e.points > 0 && new Date(e.at).getTime() >= since)) wk.add(u);
console.log('최근 7일에 점수를 얻은 사용자', wk.size);

console.log('\n== 기존 시나리오 10건 보호 ==');
const base = buildDemoReports(barriers, now, (() => { let i = 0; return () => `r-base-${++i}`; })());
const all = [...base, ...reports];
const recBase = computeRecurrence(base);
const recAll = computeRecurrence(all);
const baseIds = new Set(base.map((r: any) => r.id));
const sameRec = base.every((r: any) => JSON.stringify(recBase.byId.get(r.id) ?? null) === JSON.stringify(recAll.byId.get(r.id) ?? null));
console.log('기존 10건 재발 판정 동일:', sameRec, '(기존 재발 건', recBase.byId.size, '/ 합친 뒤 기존 건 중', [...recAll.byId.keys()].filter((k) => baseIds.has(k)).length, ')');
let minD = Infinity;
for (const b of base) for (const r of reports) minD = Math.min(minD, distanceM(b.lat, b.lng, r.lat, r.lng));
console.log('기존 10건과 대규모 건 사이 최소 거리(m):', minD.toFixed(1));
let minTeam = Infinity;
for (const b of barriers) {
  if (!b.geometry) continue;
  const pts = b.geometry.kind === 'point' ? [b.geometry.at] : b.geometry.path;
  for (const p of pts) for (const r of reports) minTeam = Math.min(minTeam, distanceM(p[0], p[1], r.lat, r.lng));
}
console.log('팀 조사 지점 꼭짓점과 대규모 건 사이 최소 거리(m):', minTeam.toFixed(1));
const recheckable = (list: any[]) => list.filter((r) => r.status === 'resolved' && r.userId !== 'citizen-b').length;
console.log('시민 B 기준 재확인 대기(기존만 → 합친 뒤):', recheckable(base), '→', recheckable(all), '(대규모 건의 제보자는 모두 crowd-*:', reports.every((r) => r.userId.startsWith('crowd-')), ')');

console.log('\n== 파일 왕복 ==');
const file = lib.makeDemoFile(users, reports, new Date(fileNow).toISOString());
const txt = JSON.stringify(file);
const p1 = lib.parseDemoFile(txt);
console.log('정상 파일 검사:', p1.ok);
console.log('잘못된 파일 거부:', [lib.parseDemoFile('{'), lib.parseDemoFile(JSON.stringify({ ...file, version: 2 })), lib.parseDemoFile(JSON.stringify({ ...file, reports: [{ ...reports[0], demo: false }] })), lib.parseDemoFile('x'.repeat(lib.FILE_MAX_BYTES + 1))].map((x: any) => (x.ok ? 'NO' : 'OK')).join(','));
const shifted = lib.shiftDates(reports[0], 2 * DAY);
console.log('날짜 평행 이동 +2일:', new Date(shifted.createdAt).getTime() - new Date(reports[0].createdAt).getTime() === 2 * DAY, '· 설명 문구는 그대로:', shifted.description === reports[0].description);
