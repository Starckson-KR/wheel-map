// 광주 북구 공공데이터 사전 수집 스크립트 (키는 브라우저에 넣지 않고 미리 받아 JSON으로 저장)
// 사용: node scripts/prefetch.ts [crosswalks|toilets|facilities|bus-stops|lowfloor-check|routes [쌍id]|pilot-stops|transit-demo|bus-snapshot|all]  (routes는 all에 포함되지 않음)
// 결과: data/public/<이름>.json / 캐시: data/public/.cache/ / 통계: data/public/.cache/stats.json
import fs from 'node:fs';
import path from 'node:path';
import { ROUTE_CFG } from '../src/lib/config.ts';
import { mergeBarriers } from '../src/lib/seedMerge.ts';
import { buildObstacles } from '../src/lib/routing/obstacles.ts';
import { searchRoute, viaKey, verdictOf, type Pt, type RouteData } from '../src/lib/routing/engine.ts';
import { callTmap } from './tmapClient.ts';
import { bisArrive, bisLineLow } from './bisClient.ts';
import { callTransit, TRANSIT_DAILY_CAP, transitCallsToday } from './transitClient.ts';
import { classifyMatch, matchBisStop, PILOT_MATCH_RADIUS_M, stopsNear, type BisStop, type PilotStopEntry } from '../src/lib/bus/stops.ts';
import type { TItinerary } from '../src/lib/transit/parse.ts';

const ROOT = path.resolve(import.meta.dirname, '..');
const PUB = path.join(ROOT, 'data', 'public');
const RAW = path.join(PUB, 'raw');
const CACHE = path.join(PUB, '.cache');
fs.mkdirSync(CACHE, { recursive: true });

// ---------- 환경·공통 ----------
function loadEnv(): Record<string, string> {
  const out: Record<string, string> = {};
  const p = path.join(ROOT, '.env');
  if (!fs.existsSync(p)) return out;
  for (const line of fs.readFileSync(p, 'utf8').split(/\r?\n/)) {
    if (!line.trim() || line.trim().startsWith('#') || !line.includes('=')) continue;
    const i = line.indexOf('=');
    let v = line.slice(i + 1).split(/\s+#/)[0].trim(); // 줄 끝 주석 제거
    v = v.replace(/^["']|["']$/g, '');
    out[line.slice(0, i).trim()] = v;
  }
  return out;
}
const ENV = loadEnv();
const DATA_KEY = ENV.DATA_GO_KR_KEY ?? '';
const KAKAO_KEY = ENV.KAKAO_REST_KEY ?? '';
const TMAP_KEY = ENV.TMAP_APP_KEY ?? '';

// 키가 로그·오류에 새지 않게 가린다
function mask(s: string): string {
  let t = String(s);
  for (const k of [DATA_KEY, KAKAO_KEY, TMAP_KEY]) {
    if (!k) continue;
    t = t.split(k).join('<KEY>').split(encodeURIComponent(k)).join('<KEY>');
  }
  return t;
}
const log = (...a: unknown[]) => console.log(...a.map((x) => mask(String(x))));

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const today = () => new Date().toISOString().slice(0, 10);

function readJson<T>(p: string, fallback: T): T {
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8')) as T;
  } catch {
    return fallback;
  }
}
function writeJson(p: string, v: unknown) {
  fs.writeFileSync(p, JSON.stringify(v, null, 1) + '\n', 'utf8');
}
function saveStats(name: string, stats: Record<string, unknown>) {
  const p = path.join(CACHE, 'stats.json');
  const all = readJson<Record<string, unknown>>(p, {});
  all[name] = { ...stats, at: new Date().toISOString() };
  writeJson(p, all);
}

type Item = {
  id: string;
  name: string;
  lat: number | null;
  lng: number | null;
  address: string;
  fields: Record<string, unknown>;
};
function writeDataset(
  file: string,
  meta: { source: string; provider: string; url: string; license: string; note?: string },
  items: Item[],
) {
  writeJson(path.join(PUB, `${file}.json`), {
    source: meta.source,
    provider: meta.provider,
    url: meta.url,
    license: meta.license,
    ...(meta.note ? { note: meta.note } : {}),
    fetchedAt: new Date().toISOString(),
    area: '광주 북구',
    count: items.length,
    items,
  });
}

// CSV 파서(따옴표 처리)
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cur = '';
  let q = false;
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          cur += '"';
          i++;
        } else q = false;
      } else cur += c;
    } else if (c === '"') q = true;
    else if (c === ',') {
      row.push(cur);
      cur = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(cur);
      cur = '';
      if (row.some((x) => x !== '')) rows.push(row);
      row = [];
    } else cur += c;
  }
  if (cur !== '' || row.length) {
    row.push(cur);
    if (row.some((x) => x !== '')) rows.push(row);
  }
  return rows;
}
function readCsvObjects(file: string): Record<string, string>[] {
  const buf = fs.readFileSync(file);
  let text: string;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(buf);
  } catch {
    text = new TextDecoder('euc-kr').decode(buf); // CP949
  }
  const rows = parseCsv(text);
  const head = rows[0].map((h) => h.trim());
  return rows.slice(1).map((r) => Object.fromEntries(head.map((h, i) => [h, (r[i] ?? '').trim()])));
}
const num = (s: string | undefined): number | null => {
  if (s === undefined || s === '') return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
};
const dist = (vals: (string | undefined)[]) => {
  const d: Record<string, number> = {};
  for (const v of vals) {
    const k = v === undefined || v === '' ? '(빈값)' : v;
    d[k] = (d[k] ?? 0) + 1;
  }
  return d;
};

// ---------- API 호출 ----------
async function getText(url: string, headers?: Record<string, string>): Promise<{ status: number; text: string }> {
  try {
    const r = await fetch(url, { headers });
    return { status: r.status, text: await r.text() };
  } catch (e) {
    return { status: 0, text: 'FETCH_ERROR ' + mask(String((e as Error).message ?? e)) };
  }
}
function apiError(text: string): string | null {
  const m = text.match(/<errMsg>([^<]+)<\/errMsg>/) ?? text.match(/"errMsg":\s*"([^"]+)"/);
  if (m) return m[1];
  const c = text.match(/"resultCode":\s*"?(\w+)"?/);
  if (c && c[1] !== '00' && c[1] !== '0') {
    const mm = text.match(/"resultMsg":\s*"([^"]*)"/);
    return `resultCode ${c[1]} ${mm?.[1] ?? ''}`;
  }
  return null;
}
const dk = () => 'serviceKey=' + encodeURIComponent(DATA_KEY);

// ---------- 카카오 로컬 ----------
const kakaoGeoCache = path.join(CACHE, 'kakao-geocode.json');
const geoCache = readJson<Record<string, { lat: number; lng: number; matched: string } | null>>(kakaoGeoCache, {});
let kakaoCalls = 0;
async function kakaoGet(url: string): Promise<{ status: number; json: any }> {
  kakaoCalls++;
  await sleep(100);
  const r = await getText(url, { Authorization: 'KakaoAK ' + KAKAO_KEY });
  let json: any = null;
  try {
    json = JSON.parse(r.text);
  } catch {
    /* ignore */
  }
  return { status: r.status, json };
}
// 주소 후보를 순서대로 시도. 성공하면 {lat,lng,matched}
async function geocode(cands: string[]): Promise<{ lat: number; lng: number; matched: string } | null> {
  for (const q of cands.filter(Boolean)) {
    const key = q;
    if (key in geoCache) {
      if (geoCache[key]) return geoCache[key];
      continue;
    }
    const r = await kakaoGet('https://dapi.kakao.com/v2/local/search/address.json?size=1&query=' + encodeURIComponent(q));
    if (r.status !== 200) {
      log('  카카오 주소검색 오류', r.status);
      continue; // 캐시하지 않음
    }
    const d = r.json?.documents?.[0];
    geoCache[key] = d ? { lat: Number(d.y), lng: Number(d.x), matched: q } : null;
    writeJson(kakaoGeoCache, geoCache);
    if (d) return geoCache[key];
  }
  return null;
}
const inYongbong = (addr: string) => addr.includes('용봉동');

// ---------- 1. crosswalks ----------
async function crosswalks() {
  const rows = readCsvObjects(path.join(RAW, '전남광주통합특별시_북구_횡단보도.csv'));
  const items: Item[] = rows.map((r) => ({
    id: r['횡단보도관리번호'],
    name: `${r['도로명'] || '(도로명 없음)'} 횡단보도`,
    lat: num(r['위도']),
    lng: num(r['경도']),
    address: r['소재지도로명주소'] || r['소재지지번주소'],
    fields: {
      소재지지번주소: r['소재지지번주소'],
      횡단보도종류: r['횡단보도종류'],
      자전거횡단도겸용여부: r['자전거횡단도겸용여부'],
      고원식적용여부: r['고원식적용여부'],
      차로수: num(r['차로수']),
      횡단보도폭: num(r['횡단보도폭']),
      횡단보도연장: num(r['횡단보도연장']),
      보행자신호등유무: r['보행자신호등유무'],
      보행자작동신호기유무: r['보행자작동신호기유무'],
      음향신호기설치여부: r['음향신호기설치여부'],
      녹색신호시간: num(r['녹색신호시간']),
      적색신호시간: num(r['적색신호시간']),
      교통섬유무: r['교통섬유무'],
      보도턱낮춤여부: r['보도턱낮춤여부'],
      점자블록유무: r['점자블록유무'], // 참고용: 점자블록은 앱 표시 범위 밖(명세서 기준)
      집중조명시설유무: r['집중조명시설유무'],
      데이터기준일자: r['데이터기준일자'],
    },
  }));
  writeDataset(
    'crosswalks',
    {
      source: '전남광주통합특별시 북구 횡단보도 (전국횡단보도표준데이터)',
      provider: '전남광주통합특별시 북구청 (소관 국토교통부·경찰청)',
      url: 'https://www.data.go.kr/data/15028201/standard.do',
      license: '확인 필요 (데이터셋 페이지에 이용허락범위 표기 없음)',
      note: '점자블록유무는 참고용으로만 유지하며 앱 표시 범위 밖이다. 보도턱낮춤은 여부(Y/N)만 있고 단차 cm는 없다.',
    },
    items,
  );
  const withCoord = items.filter((i) => i.lat !== null && i.lng !== null).length;
  const stats: Record<string, unknown> = {
    count: items.length,
    withCoord,
    용봉동: items.filter((i) => inYongbong(String(i.fields.소재지지번주소) + i.address)).length,
    보도턱낮춤여부: dist(rows.map((r) => r['보도턱낮춤여부'])),
    점자블록유무: dist(rows.map((r) => r['점자블록유무'])),
    음향신호기설치여부: dist(rows.map((r) => r['음향신호기설치여부'])),
    보행자신호등유무: dist(rows.map((r) => r['보행자신호등유무'])),
    횡단보도폭_빈값: rows.filter((r) => !r['횡단보도폭']).length,
  };
  log(`crosswalks: ${items.length}건, 좌표 ${withCoord}`);

  // API 대조(저장하지 않고 비교만)
  const api = await fetchCrosswalkApi();
  if (api.error) {
    stats.api = { ok: false, error: api.error };
    log('  횡단보도 API 오류:', api.error);
  } else {
    const csvById = new Map(items.map((i) => [i.id, rows.find((r) => r['횡단보도관리번호'] === i.id)!]));
    const apiById = new Map(api.items.map((a: any) => [a.crslkManageNo, a]));
    const onlyApi = [...apiById.keys()].filter((k) => !csvById.has(k));
    const onlyCsv = [...csvById.keys()].filter((k) => !apiById.has(k));
    const map: Record<string, string> = {
      보도턱낮춤여부: 'ftpthLowerYn',
      점자블록유무: 'brllBlckYn',
      음향신호기설치여부: 'sondSgngnrYn',
      횡단보도폭: 'bt',
      횡단보도연장: 'et',
      위도: 'latitude',
      경도: 'longitude',
      차로수: 'cartrkCo',
    };
    const diff: Record<string, number> = {};
    for (const [id, a] of apiById) {
      const c = csvById.get(id as string);
      if (!c) continue;
      for (const [cf, af] of Object.entries(map)) {
        const x = String(c[cf] ?? '').trim();
        const y = String((a as any)[af] ?? '').trim();
        const same = x === y || (x !== '' && y !== '' && Number(x) === Number(y));
        if (!same) diff[cf] = (diff[cf] ?? 0) + 1;
      }
    }
    stats.api = {
      ok: true,
      apiCount: api.items.length,
      apiTotalCount: api.total,
      csvCount: items.length,
      onlyInApi: onlyApi.length,
      onlyInCsv: onlyCsv.length,
      fieldMismatchCounts: diff,
      apiFields: Object.keys(api.items[0] ?? {}),
    };
    log(`  횡단보도 API 대조: API ${api.items.length}건(total ${api.total}) / CSV ${items.length}건, API만 ${onlyApi.length}, CSV만 ${onlyCsv.length}`);
  }
  saveStats('crosswalks', stats);
}
async function fetchCrosswalkApi(): Promise<{ items: any[]; total: number; error?: string }> {
  const all: any[] = [];
  let total = 0;
  for (let page = 1; page <= 5; page++) {
    const url = `https://api.data.go.kr/openapi/tn_pubr_public_crosswalk_api?${dk()}&pageNo=${page}&numOfRows=500&type=json&signguNm=${encodeURIComponent('북구')}&ctprvnNm=${encodeURIComponent('전남광주통합특별시')}`;
    const r = await getText(url);
    const err = apiError(r.text);
    if (r.status !== 200 || err) return { items: all, total, error: `HTTP ${r.status} ${err ?? r.text.slice(0, 80)}` };
    const j = JSON.parse(r.text);
    total = Number(j.body?.totalCount ?? 0);
    const it = j.body?.items;
    const arr = Array.isArray(it) ? it : (it?.item ?? []);
    all.push(...arr);
    if (all.length >= total || arr.length === 0) break;
    await sleep(150);
  }
  return { items: all, total };
}

// ---------- 2. toilets ----------
async function toilets() {
  const rows = readCsvObjects(path.join(RAW, '공중화장실정보_전남광주북구.csv'));
  const cleanPhone = (p: string) => (/^0?1[016789]/.test(p.replace(/\D/g, '')) ? '' : p); // 개인 휴대폰 형태 제거
  let geocoded = 0;
  let already = 0;
  let failed = 0;
  const items: Item[] = [];
  const hasLatLng = rows[0] && ('위도' in rows[0] || '경도' in rows[0]);
  let i = 0;
  for (const r of rows) {
    i++;
    const road = r['소재지도로명주소'];
    const jibun = r['소재지지번주소'];
    let lat: number | null = hasLatLng ? num(r['위도']) : null;
    let lng: number | null = hasLatLng ? num(r['경도']) : null;
    let geo: Record<string, unknown> = {};
    if (lat !== null && lng !== null) already++;
    else {
      // 도로명주소의 "(용두동)" 같은 괄호는 제거해서 검색
      const roadClean = road.replace(/\s*\([^)]*\)\s*$/, '');
      const g = await geocode([roadClean, jibun]);
      if (g) {
        lat = g.lat;
        lng = g.lng;
        geocoded++;
        geo = { geocoded: true, geocodeQuery: g.matched };
      } else {
        failed++;
        geo = { geocoded: false, geocodeQuery: null };
      }
    }
    if (i % 50 === 0) log(`  toilets 지오코딩 ${i}/${rows.length}`);
    const disM = num(r['남성용-장애인용대변기수']) ?? 0;
    const disMu = num(r['남성용-장애인용소변기수']) ?? 0;
    const disF = num(r['여성용-장애인용대변기수']) ?? 0;
    items.push({
      id: r['관리번호'],
      name: r['화장실명'],
      lat,
      lng,
      address: road || jibun,
      fields: {
        ...geo,
        구분명: r['구분명'],
        소재지지번주소: jibun,
        '남성용-장애인용대변기수': disM,
        '남성용-장애인용소변기수': disMu,
        '여성용-장애인용대변기수': disF,
        장애인용위생시설합계: disM + disMu + disF,
        개방시간: r['개방시간'],
        개방시간상세: r['개방시간상세'],
        관리기관명: r['관리기관명'],
        전화번호: cleanPhone(r['전화번호']),
        비상벨설치여부: r['비상벨설치여부'],
        기저귀교환대유무: r['기저귀교환대유무'],
        데이터기준일자: r['데이터기준일자'],
      },
    });
  }
  writeDataset(
    'toilets',
    {
      source: '행정안전부 공중화장실정보 (전남광주 북구 분)',
      provider: '행정안전부',
      url: 'https://www.data.go.kr/data/15075531/fileData.do',
      license: '이용허락범위 제한 없음 (공공데이터포털 페이지, 조사문서 기준)',
      note: '원본에 좌표가 없어 카카오 로컬 주소검색으로 좌표를 구함(geocoded 표시). 개인 휴대폰 형태 번호는 제거함.',
    },
    items,
  );
  const withCoord = items.filter((x) => x.lat !== null).length;
  const accessible = items.filter((x) => Number(x.fields.장애인용위생시설합계) > 0);
  saveStats('toilets', {
    count: items.length,
    withCoordOriginal: already,
    geocoded,
    failed,
    withCoord,
    장애인용있음: accessible.length,
    장애인용있음_용봉동: accessible.filter((x) => inYongbong(String(x.fields.소재지지번주소) + x.address)).length,
    용봉동: items.filter((x) => inYongbong(String(x.fields.소재지지번주소) + x.address)).length,
    개방시간: dist(items.map((x) => String(x.fields.개방시간))),
    구분명: dist(items.map((x) => String(x.fields.구분명))),
    kakaoCalls,
  });
  log(`toilets: ${items.length}건, 좌표 ${withCoord} (지오코딩 ${geocoded}, 실패 ${failed}), 장애인용 있음 ${accessible.length}`);
}

// ---------- 3. facilities ----------
const FAC_CALL_CAP = 80; // 개발계정 하루 약 100건 한도 → 상한
const facCounterPath = path.join(CACHE, 'facilities-calls.json');
const facDetailCachePath = path.join(CACHE, 'facilities-detail.json');
function facCounter() {
  const c = readJson<{ date: string; n: number }>(facCounterPath, { date: today(), n: 0 });
  if (c.date !== today()) return { date: today(), n: 0 };
  return c;
}
async function facCall(url: string): Promise<{ status: number; text: string } | null> {
  const c = facCounter();
  if (c.n >= FAC_CALL_CAP) {
    log('  장애인편의시설 API 호출 상한 도달, 중단');
    return null;
  }
  c.n++;
  writeJson(facCounterPath, c); // 호출 전에 먼저 센다
  await sleep(300);
  return getText(url);
}
const xmlTag = (s: string, t: string) => s.match(new RegExp(`<${t}>([\\s\\S]*?)</${t}>`))?.[1]?.trim() ?? '';

async function facilities() {
  const base = 'http://apis.data.go.kr/B554287/DisabledPersonConvenientFacility';
  const listCache = path.join(CACHE, 'facilities-list.json');
  let list = readJson<Item[] | null>(listCache, null);
  let listError: string | null = null;
  if (!list) {
    list = [];
    for (let page = 1; page <= 5; page++) {
      const r = await facCall(
        `${base}/getDisConvFaclList?${dk()}&pageNo=${page}&numOfRows=1000&siDoNm=${encodeURIComponent('전남광주통합특별시')}&cggNm=${encodeURIComponent('북구')}`,
      );
      if (!r) break;
      const err = apiError(r.text);
      if (r.status !== 200 || err) {
        listError = `HTTP ${r.status} ${err ?? r.text.slice(0, 80)}`;
        break;
      }
      const total = Number(xmlTag(r.text, 'totalCount'));
      const blocks = r.text.match(/<servList>[\s\S]*?<\/servList>/g) ?? [];
      for (const b of blocks) {
        list.push({
          id: xmlTag(b, 'wfcltId'),
          name: xmlTag(b, 'faclNm'),
          lat: num(xmlTag(b, 'faclLat')),
          lng: num(xmlTag(b, 'faclLng')),
          address: xmlTag(b, 'lcMnad'),
          fields: {
            faclInfId: xmlTag(b, 'faclInfId'),
            faclTyCd: xmlTag(b, 'faclTyCd'),
            salStaNm: xmlTag(b, 'salStaNm'),
            estbDate: xmlTag(b, 'estbDate'),
          },
        });
      }
      if (list.length >= total || blocks.length === 0) break;
    }
    if (!listError && list.length) writeJson(listCache, list);
  }
  if (listError) {
    log('  장애인편의시설 목록 오류:', listError);
    saveStats('facilities', { ok: false, error: listError });
    return;
  }

  // 지오코딩: 좌표 없는 시설만
  let geocoded = 0;
  let failed = 0;
  for (const it of list) {
    if (it.lat !== null && it.lng !== null && it.lat !== 0) continue;
    const g = await geocode([it.address.replace(/\s*\([^)]*\)\s*$/, ''), it.address]);
    if (g) {
      it.lat = g.lat;
      it.lng = g.lng;
      it.fields.geocoded = true;
      it.fields.geocodeQuery = g.matched;
      geocoded++;
    } else {
      it.lat = null;
      it.lng = null;
      failed++;
    }
  }

  // 상세(evalInfo): 용봉동 → 그 외 순서로, 호출 상한 내에서만. 캐시 사용.
  const detail = readJson<Record<string, string>>(facDetailCachePath, {});
  const order = [...list.filter((x) => inYongbong(x.address)), ...list.filter((x) => !inYongbong(x.address))];
  let detailCalls = 0;
  let stopped = false;
  let detailErrors = 0;
  for (const it of order) {
    if (it.id in detail) continue;
    const r = await facCall(`${base}/getFacInfoOpenApiJpEvalInfoList?${dk()}&wfcltId=${encodeURIComponent(it.id)}`);
    if (!r) {
      stopped = true;
      break;
    }
    detailCalls++;
    const err = apiError(r.text);
    if (r.status !== 200 || err) {
      log('  상세 오류:', err ?? r.status);
      if (++detailErrors >= 3) {
        log('  상세 오류가 연속되어 중단(호출 낭비 방지)');
        break;
      }
      continue;
    }
    detailErrors = 0;
    detail[it.id] = xmlTag(r.text, 'evalInfo');
    writeJson(facDetailCachePath, detail);
    if (detailCalls >= FAC_CALL_CAP) break;
  }
  for (const it of list) it.fields.evalInfo = it.id in detail ? detail[it.id] : null; // null = 상세 미조회

  writeDataset(
    'facilities',
    {
      source: '한국사회보장정보원 장애인편의시설 현황',
      provider: '한국사회보장정보원(보건복지부)',
      url: 'https://www.data.go.kr/data/15092317/openapi.do',
      license: '이용제한 없음 (공공데이터포털 페이지, 조사문서 기준)',
      note: 'evalInfo가 null인 시설은 일일 호출 한도 때문에 상세(편의시설 항목)를 아직 조회하지 않은 것. 용봉동 시설부터 조회함. 다시 실행하면 이어서 조회.',
    },
    list,
  );
  const withCoord = list.filter((x) => x.lat !== null).length;
  const yb = list.filter((x) => inYongbong(x.address));
  saveStats('facilities', {
    ok: true,
    count: list.length,
    withCoord,
    geocoded,
    failed,
    용봉동: yb.length,
    용봉동_상세조회됨: yb.filter((x) => x.fields.evalInfo !== null).length,
    상세조회됨_전체: list.filter((x) => x.fields.evalInfo !== null).length,
    시설유형: dist(list.map((x) => String(x.fields.faclTyCd))),
    api호출_오늘누계: facCounter().n,
    호출상한: FAC_CALL_CAP,
    stopped,
  });
  log(`facilities: ${list.length}건, 좌표 ${withCoord}, 용봉동 ${yb.length}, 상세 ${Object.keys(detail).length}건, 오늘 호출 ${facCounter().n}/${FAC_CALL_CAP}`);
}

// ---------- 4. bus-stops ----------
// 광주 BIS(15157923)는 엔드포인트가 활용가이드 docx에만 있어 아직 사용하지 못함 → TAGO 정류소정보(15098534)의 좌표 근접 조회를 격자로 호출.
const BUS_REGION_CAP = 1500;
async function busStops() {
  const base = 'http://apis.data.go.kr/1613000/BusSttnInfoInqireService/getCrdntPrxmtSttnList';
  // 북구 대략 범위(격자 탐색용, 행정경계가 아님 — 북구 여부는 카카오 행정구역으로 판별)
  const LAT0 = 35.13, LAT1 = 35.27, LNG0 = 126.83, LNG1 = 127.0, STEP = 0.007;
  const stops = new Map<string, { id: string; name: string; lat: number; lng: number; no: number | null }>();
  let calls = 0;
  let error: string | null = null;
  const gridCache = path.join(CACHE, 'bus-grid.json');
  const grid = readJson<Record<string, any[]>>(gridCache, {});
  for (let lat = LAT0; lat <= LAT1 + 1e-9; lat += STEP) {
    for (let lng = LNG0; lng <= LNG1 + 1e-9; lng += STEP) {
      const key = lat.toFixed(4) + ',' + lng.toFixed(4);
      let arr = grid[key];
      if (!arr) {
        let r = await getText(`${base}?${dk()}&gpsLati=${lat.toFixed(6)}&gpsLong=${lng.toFixed(6)}&numOfRows=100&_type=json`);
        calls++;
        for (let t = 0; t < 6 && (r.status === 0 || /세션이 존재하지/.test(r.text)); t++) {
          await sleep(1500 * (t + 1)); // 동시 접속 한도(세션) 초과 시 대기 후 재시도
          r = await getText(`${base}?${dk()}&gpsLati=${lat.toFixed(6)}&gpsLong=${lng.toFixed(6)}&numOfRows=100&_type=json`);
          calls++;
        }
        const err = apiError(r.text);
        if (r.status !== 200 || err) {
          error = `HTTP ${r.status} ${err ?? r.text.slice(0, 80)}`;
          break;
        }
        const it = JSON.parse(r.text).response?.body?.items;
        arr = Array.isArray(it?.item) ? it.item : it?.item ? [it.item] : [];
        grid[key] = arr;
        await sleep(80);
      }
      for (const s of arr) stops.set(String(s.nodeid), { id: String(s.nodeid), name: s.nodenm, lat: s.gpslati, lng: s.gpslong, no: s.nodeno ?? null });
    }
    if (error) break;
    writeJson(gridCache, grid);
  }
  writeJson(gridCache, grid);
  if (error) {
    log('  정류소 오류:', error);
    saveStats('bus-stops', { ok: false, error });
    return;
  }
  log(`  TAGO 격자 호출 ${calls}회, 정류소 후보 ${stops.size}개 → 카카오 행정구역 판별`);

  // 북구 판별: coord2regioncode (캐시, 호출 상한)
  const regCachePath = path.join(CACHE, 'kakao-region.json');
  const regCache = readJson<Record<string, { r1: string; r2: string; r3: string } | null>>(regCachePath, {});
  let regCalls = 0;
  const items: Item[] = [];
  let unknown = 0;
  for (const s of stops.values()) {
    if (!(s.id in regCache)) {
      if (regCalls >= BUS_REGION_CAP) {
        unknown++;
        continue;
      }
      const r = await kakaoGet(`https://dapi.kakao.com/v2/local/geo/coord2regioncode.json?x=${s.lng}&y=${s.lat}`);
      regCalls++;
      if (r.status !== 200) {
        unknown++;
        continue;
      }
      const d = (r.json?.documents ?? []).find((x: any) => x.region_type === 'H') ?? r.json?.documents?.[0];
      regCache[s.id] = d ? { r1: d.region_1depth_name, r2: d.region_2depth_name, r3: d.region_3depth_name } : null;
      if (regCalls % 50 === 0) writeJson(regCachePath, regCache);
    }
    const reg = regCache[s.id];
    if (reg && reg.r2 === '북구') {
      items.push({
        id: s.id,
        name: s.name,
        lat: s.lat,
        lng: s.lng,
        address: `${reg.r1} ${reg.r2} ${reg.r3}`,
        fields: { nodeno: s.no, 행정동: reg.r3 },
      });
    }
  }
  writeJson(regCachePath, regCache);
  writeDataset(
    'bus-stops',
    {
      source: 'TAGO 버스정류소정보 (좌표 근접 조회)',
      provider: '국토교통부',
      url: 'https://www.data.go.kr/data/15098534/openapi.do',
      license: '확인 필요 (페이지 이용허락범위 미확인)',
      note: '광주 BIS(15157923) 엔드포인트는 활용가이드 docx에만 있어 미사용. 북구 여부는 카카오 coord2regioncode 행정동 기준.',
    },
    items,
  );
  saveStats('bus-stops', {
    ok: true,
    tagoCalls: calls,
    candidates: stops.size,
    kakaoRegionCalls: regCalls,
    unknownRegion: unknown,
    count: items.length,
    용봉동: items.filter((x) => String(x.fields.행정동) === '용봉동').length,
  });
  log(`bus-stops: 북구 ${items.length}개 (후보 ${stops.size}, 지역 판별 호출 ${regCalls}, 미판별 ${unknown})`);
}

// ---------- 4-2. bus-stops-bis (광주 BIS 정류소 → bus-stops.bis.json, bus-stops.json은 건드리지 않음) ----------
async function busStopsBis() {
  const r = await getText(`http://apis.data.go.kr/6290000/gj_bis/stationInfo?${dk()}&resultType=json`);
  const err = apiError(r.text);
  if (r.status !== 200 || err) {
    log('  BIS 오류:', err ?? r.status);
    saveStats('bus-stops-bis', { ok: false, error: `HTTP ${r.status} ${err ?? ''}` });
    return;
  }
  const raw: any[] = JSON.parse(r.text).RESPONSE?.STATION_LIST?.ITEM ?? [];
  // 활용가이드 표의 위도/경도 설명이 서로 바뀌어 적혀 있음 → 값 범위로 판별(광주: 위도 35, 경도 126)
  const pts = raw.map((s) => {
    const a = Number(s.LATITUDE);
    const b = Number(s.LONGITUDE);
    return { id: String(s.BUSSTOP_ID), name: s.BUSSTOP_NAME, ars: s.ARS_ID, next: s.NEXT_BUSSTOP, lat: a < 90 && a > 30 && a < 40 ? a : b, lng: a > 100 ? a : b };
  });
  // 북구 판별: TAGO 격자 후보 정류소(이미 행정동을 구해 둠)와 40m 이내면 그 결과를 재사용, 아니면 카카오 호출
  const tagoGrid = readJson<Record<string, any[]>>(path.join(CACHE, 'bus-grid.json'), {});
  const tagoReg = readJson<Record<string, { r1: string; r2: string; r3: string } | null>>(path.join(CACHE, 'kakao-region.json'), {});
  const tagoAll = new Map<string, { lat: number; lng: number }>();
  for (const arr of Object.values(tagoGrid)) for (const s of arr) tagoAll.set(String(s.nodeid), { lat: s.gpslati, lng: s.gpslong });
  const near = (lat: number, lng: number) => {
    let best: string | null = null;
    let bd = 0.0004; // 약 40m
    for (const [id, t] of tagoAll) {
      const d = Math.hypot(t.lat - lat, (t.lng - lng) * 0.82);
      if (d < bd && id in tagoReg) {
        bd = d;
        best = id;
      }
    }
    return best;
  };
  const regPath = path.join(CACHE, 'kakao-region-bis.json');
  const reg = readJson<Record<string, { r1: string; r2: string; r3: string } | null>>(regPath, {});
  let kcalls = 0;
  let reused = 0;
  const items: Item[] = [];
  for (const p of pts) {
    if (!(p.id in reg)) {
      const t = near(p.lat, p.lng);
      if (t) {
        reg[p.id] = tagoReg[t];
        reused++;
      } else if (kcalls < BUS_REGION_CAP) {
        const k = await kakaoGet(`https://dapi.kakao.com/v2/local/geo/coord2regioncode.json?x=${p.lng}&y=${p.lat}`);
        kcalls++;
        if (k.status !== 200) continue;
        const d = (k.json?.documents ?? []).find((x: any) => x.region_type === 'H') ?? k.json?.documents?.[0];
        reg[p.id] = d ? { r1: d.region_1depth_name, r2: d.region_2depth_name, r3: d.region_3depth_name } : null;
      } else continue;
    }
    const g = reg[p.id];
    if (g && g.r2 === '북구') {
      items.push({ id: p.id, name: p.name, lat: p.lat, lng: p.lng, address: `${g.r1} ${g.r2} ${g.r3}`, fields: { ARS_ID: p.ars, NEXT_BUSSTOP: p.next, 행정동: g.r3 } });
    }
  }
  writeJson(regPath, reg);
  writeDataset(
    'bus-stops.bis',
    {
      source: '광주광역시 광주버스정보(BIS) 정류소 목록',
      provider: '광주광역시',
      url: 'https://www.data.go.kr/data/15157923/openapi.do',
      license: '이용허락범위 제한 없음 (공공데이터포털 페이지)',
      note: '북구 여부는 카카오 행정동 기준. 정류소 id는 BIS 정류소 ID(TAGO nodeid와 다름).',
    },
    items,
  );
  // TAGO 수집분(bus-stops.json)과 대조: 좌표 40m 이내를 같은 정류소로 본다
  const tago = readJson<{ items: Item[] }>(path.join(PUB, 'bus-stops.json'), { items: [] }).items;
  const matchT = (a: Item, list: Item[]) => list.some((b) => Math.hypot((a.lat ?? 0) - (b.lat ?? 0), ((a.lng ?? 0) - (b.lng ?? 0)) * 0.82) < 0.0004);
  const bisOnly = items.filter((x) => !matchT(x, tago));
  const tagoOnly = tago.filter((x) => !matchT(x, items));
  saveStats('bus-stops-bis', {
    ok: true,
    bisTotalGwangju: pts.length,
    bisBukgu: items.length,
    bisBukgu_용봉동: items.filter((x) => x.fields.행정동 === '용봉동').length,
    tagoBukgu: tago.length,
    bisOnly_not_in_tago: bisOnly.length,
    tagoOnly_not_in_bis: tagoOnly.length,
    bisOnlySamples: bisOnly.slice(0, 8).map((x) => `${x.name}(${x.fields.행정동})`),
    tagoOnlySamples: tagoOnly.slice(0, 8).map((x) => `${x.name}(${x.fields.행정동})`),
    kakaoCalls: kcalls,
    reusedFromTago: reused,
  });
  log(`bus-stops-bis: 광주 전체 ${pts.length}, 북구 ${items.length} / TAGO 북구 ${tago.length}, BIS만 ${bisOnly.length}, TAGO만 ${tagoOnly.length}`);
}

// ---------- 5. lowfloor-check (확인만, 저장 안 함) ----------
async function lowfloorCheck() {
  const base = 'http://apis.data.go.kr/1613000/ArvlInfoInqireService/getSttnAcctoArvlPrearngeInfoList';
  const stopsFile = path.join(PUB, 'bus-stops.json');
  let sample: { id: string; name: string }[] = [
    { id: 'KJB1199', name: '전남대스포츠센터' },
    { id: 'KJB4397', name: '전남대용봉탑' },
    { id: 'KJB1209', name: '전대치과병원' },
  ];
  if (fs.existsSync(stopsFile)) {
    const j = readJson<{ items: Item[] }>(stopsFile, { items: [] });
    const yb = j.items.filter((x) => x.fields.행정동 === '용봉동').slice(0, 3);
    if (yb.length) sample = yb.map((x) => ({ id: x.id, name: x.name }));
  }
  const out: Record<string, unknown>[] = [];
  const vt = new Set<string>();
  for (const s of sample) {
    const r = await getText(`${base}?${dk()}&cityCode=24&nodeId=${encodeURIComponent(s.id)}&numOfRows=20&_type=json`);
    const err = apiError(r.text);
    if (r.status !== 200 || err) {
      out.push({ stop: s.name, error: `HTTP ${r.status} ${err ?? ''}` });
      continue;
    }
    const it = JSON.parse(r.text).response?.body?.items;
    const arr = Array.isArray(it?.item) ? it.item : it?.item ? [it.item] : [];
    arr.forEach((a: any) => a.vehicletp && vt.add(a.vehicletp));
    out.push({ stop: s.name, arrivals: arr.length, vehicletpPresent: arr.filter((a: any) => 'vehicletp' in a).length, 저상: arr.filter((a: any) => a.vehicletp === '저상버스').length });
    await sleep(200);
  }
  const res = { cityCode: 24, samples: out, vehicletpValues: [...vt] }; // 실시간 도착 값은 저장하지 않는다
  saveStats('lowfloor-check', res);
  log('lowfloor-check:', JSON.stringify(res));
}


// ---------- 시연 경로(5단계) ----------
// 시연 출발·도착 쌍(data/routes/pairs.json)마다 앱과 같은 경로 검색(우회 시도 포함)을 돌려, 받은 모든 경로를
// data/routes/demo.json에 저장한다. 배포 화면은 이 파일만 읽는다(TMAP 키는 브라우저에 넣지 않는다).
// 평가는 팀 조사 지점 자료 기준(시민 제보·재확인 반영 전)이다. 같은 요청은 data/routes/.cache/를 먼저 본다.
async function routes() {
  const rdir = path.join(ROOT, 'data', 'routes');
  const pairs = readJson<any[]>(path.join(rdir, 'pairs.json'), []);
  const seed = path.join(ROOT, 'data', 'seed');
  const barriers = mergeBarriers(
    readJson<any[]>(path.join(seed, 'barriers.json'), []),
    readJson<any[]>(path.join(seed, 'pilot_coords.json'), []),
    readJson<any[]>(path.join(seed, 'pilot_candidates.json'), []),
  );
  const byId = new Map(barriers.map((b: any) => [b.id, b]));
  const obstacles = buildObstacles(barriers, new Map(), []);
  const only = process.argv[3];
  const outPath = path.join(rdir, 'demo.json');
  const out = readJson<any>(outPath, { source: 'TMAP 보행자 경로(SK텔레콤)', pairs: {} });
  let fresh = 0;
  for (const pair of pairs) {
    if (only && pair.id !== only) continue;
    const f: any = byId.get(pair.fromId), t: any = byId.get(pair.toId);
    if (f?.geometry?.kind !== 'point' || t?.geometry?.kind !== 'point') { log('  좌표 없음, 건너뜀:', pair.id); continue; }
    const from = f.geometry.at as Pt, to = t.geometry.at as Pt;
    const store: Record<string, RouteData> = {};
    const res = await searchRoute({
      obstacles,
      cfg: ROUTE_CFG,
      fetchRoute: async (via: Pt[], opt?: number) => {
        const r = await callTmap({ from, to, fromName: pair.fromName, toName: pair.toName, via, ...(opt ? { searchOption: opt } : {}) }, TMAP_KEY, ROOT);
        if (!r.fromCache && r.route) fresh++;
        if (r.error) log('  ', r.error);
        if (r.route) store[viaKey(via, opt)] = r.route;
        return r.route;
      },
    });
    const xs = (h: any[]) => h.filter((x) => x.role === 'X').map((x) => x.o.id);
    const ts = (h: any[]) => h.filter((x) => x.role === 'T').map((x) => x.o.id);
    const zs = (h: any[]) => h.filter((x) => x.role === 'Z').map((x) => x.o.id);
    const summary = {
      baseDistance: res.base?.distance ?? null,
      detourDistance: res.detour?.distance ?? null,
      baseX: xs(res.baseHits), baseT: ts(res.baseHits), baseZ: zs(res.baseHits),
      detourX: xs(res.detourHits), detourT: ts(res.detourHits), detourZ: zs(res.detourHits),
      noAlternative: res.unresolved.map((h) => h.o.id), endpointX: res.endpoint.map((h) => h.o.id), untested: res.untested.map((h) => h.o.id),
      attempts: res.attempts.map((a) => a.targetId + ' ' + a.offsetLabel + ' ' + a.result),
      requests: res.requests,
      detourOption: res.detourOption ?? null,
      summaryText: { base: res.summary.base?.text ?? null, detour: res.summary.detour?.text ?? null },
      boardingStops: (res.summary.detour ?? res.summary.base)?.stops.map((x: any) => x.o.id + '@' + x.where) ?? [],
      verdict: res.base ? verdictOf(res.detour ? res.detourHits : res.baseHits, res.endpoint.map((h) => h.o.id)) : null,
    };
    log('  ' + pair.id, pair.label, JSON.stringify(summary));
    out.pairs[pair.id] = { fromId: pair.fromId, toId: pair.toId, fetchedAt: new Date().toISOString(), summary, routes: store };
  }
  out.fetchedAt = new Date().toISOString();
  writeJson(outPath, out);
  log('  routes 저장 완료. 이번 실행에서 TMAP 실제 호출:', fresh, '회');
}

// ---------- 7단계: 저상버스 ----------
function seedBarriers() {
  const seed = path.join(ROOT, 'data', 'seed');
  return mergeBarriers(
    readJson<any[]>(path.join(seed, 'barriers.json'), []),
    readJson<any[]>(path.join(seed, 'pilot_coords.json'), []),
    readJson<any[]>(path.join(seed, 'pilot_candidates.json'), []),
  );
}
function readBisStops(): BisStop[] {
  const j = readJson<{ items: any[] }>(path.join(PUB, 'bus-stops.bis.json'), { items: [] });
  return j.items.map((x) => ({ id: String(x.id), name: x.name, lat: x.lat, lng: x.lng, ars: x.fields?.ARS_ID, next: x.fields?.NEXT_BUSSTOP }));
}

// 시범 경로의 정류장(영향 종류 boarding)을 실제 BIS 정류소와 짝짓는다(좌표 40m 이내, API 호출 없음).
// 결과: data/public/pilot-stops.json — 애매한 것(status ambiguous/none)은 note에 이유를 적는다.
async function pilotStops() {
  const barriers = seedBarriers();
  const byId = new Map(barriers.map((b: any) => [b.id, b]));
  const bis = readBisStops();
  const items: Record<string, PilotStopEntry> = {};
  for (const b of barriers as any[]) {
    const impact = b.impact ?? byId.get(b.parentId)?.impact;
    if (impact !== 'boarding' || !b.geometry) continue;
    const g = b.geometry;
    let pts: Pt[] = g.kind === 'point' ? [g.at] : g.path;
    if (g.kind === 'area') {
      const cx = g.path.reduce((a: number, p: Pt) => a + p[0], 0) / g.path.length;
      const cy = g.path.reduce((a: number, p: Pt) => a + p[1], 0) / g.path.length;
      pts = [...g.path, [cx, cy]];
    }
    const matches = stopsNear(pts, bis, PILOT_MATCH_RADIUS_M).slice(0, 4);
    const c = classifyMatch(matches);
    items[b.id] = { barrierId: b.id, matches, status: c.status, primary: c.primary, note: c.note };
    log('  ' + b.id, b.name, c.status, matches.map((m) => `${m.name}(${m.stationId}, ${m.next ?? ''}, ${m.distM}m)`).join(' / '), c.note);
  }
  writeJson(path.join(PUB, 'pilot-stops.json'), {
    source: '시범 경로 정류장(팀 조사) ↔ 광주 BIS 정류소(bus-stops.bis.json) 좌표 짝짓기',
    generatedAt: new Date().toISOString(),
    radiusM: PILOT_MATCH_RADIUS_M,
    items,
  });
}

// 시연 쌍마다 TMAP 대중교통 경로(최대 3개)를 받아 data/routes/transit.json에 저장한다. 같은 요청은 캐시, 하루 상한은 transitClient.ts.
async function transitDemo() {
  const rdir = path.join(ROOT, 'data', 'routes');
  const pairs = readJson<any[]>(path.join(rdir, 'pairs.json'), []);
  const byId = new Map(seedBarriers().map((b: any) => [b.id, b]));
  const outPath = path.join(rdir, 'transit.json');
  const out = readJson<any>(outPath, { source: 'TMAP 대중교통 경로(SK open API)', pairs: {} });
  let fresh = 0;
  for (const pair of pairs) {
    const f: any = byId.get(pair.fromId), t: any = byId.get(pair.toId);
    if (f?.geometry?.kind !== 'point' || t?.geometry?.kind !== 'point') continue;
    const r = await callTransit({ from: f.geometry.at, to: t.geometry.at }, TMAP_KEY, ROOT);
    if (!r.ok) { log('  ' + pair.id, '실패:', r.error); continue; }
    if (!r.fromCache) fresh++;
    out.pairs[pair.id] = { fromId: pair.fromId, toId: pair.toId, fetchedAt: new Date().toISOString(), itineraries: r.itineraries };
    log('  ' + pair.id, r.fromCache ? '(캐시)' : '(호출)', r.itineraries.map((i) => `${Math.round(i.time / 60)}분 ${i.legs.map((l) => l.mode === 'BUS' ? l.lineName : l.mode === 'WALK' ? '도보' : l.mode).join('>')}`).join(' | '));
  }
  out.fetchedAt = new Date().toISOString();
  writeJson(outPath, out);
  log(`  transit 저장 완료. 이번 실행의 TMAP 대중교통 실제 호출 ${fresh}회, 오늘 누적 ${transitCallsToday(ROOT)}/${TRANSIT_DAILY_CAP}`);
}

// 발표(배포)판용 한 시점 스냅샷: 시범 정류장 + 대중교통 시연 경로의 승·하차 정류소의 도착정보와 노선별 운행 저상 수.
// 실시간이 아니다 — collectedAt을 같이 저장해 화면에 '○시 ○분 기준'으로 보여 준다. BIS 호출 상한 50회 안에서만.
async function busSnapshot() {
  const bis = readBisStops();
  const pilot = readJson<any>(path.join(PUB, 'pilot-stops.json'), { items: {} });
  const transit = readJson<any>(path.join(ROOT, 'data', 'routes', 'transit.json'), { pairs: {} });
  const ids = new Map<string, string>();
  for (const e of Object.values<any>(pilot.items)) for (const m of e.matches) ids.set(m.stationId, m.name);
  const lines = new Set<string>();
  for (const pr of Object.values<any>(transit.pairs)) {
    for (const it of pr.itineraries as TItinerary[]) {
      for (const l of it.legs) {
        if (l.mode !== 'BUS' || !l.stations?.length) continue;
        if (l.lineName) lines.add(l.lineName);
        const a = matchBisStop(l.stations[0], l.stations[1]?.name, bis);
        const z = matchBisStop(l.stations[l.stations.length - 1], undefined, bis);
        for (const m of [a, z]) if (m) ids.set(m.stop.id, m.stop.name);
      }
    }
  }
  const MAX_ST = 28;
  const list = [...ids.entries()].slice(0, MAX_ST);
  log(`  정류소 ${list.length}곳(상한 ${MAX_ST}), 노선 ${lines.size}개`);
  const stations: Record<string, any> = {};
  let calls = 0;
  for (const [id, name] of list) {
    const r = await bisArrive(id, DATA_KEY, ROOT, 0);
    if (!r.ok) { log('  ', id, name, '실패:', r.error); if (r.limit) break; continue; }
    if (!r.fromCache) calls++;
    stations[id] = { name, collectedAt: r.collectedAt, arrivals: r.arrivals };
    await sleep(150);
  }
  const lineLow: Record<string, any> = {};
  for (const ln of [...lines].slice(0, 8)) {
    const r = await bisLineLow(ln, DATA_KEY, ROOT);
    if (!r.ok) { log('  노선', ln, '실패:', r.error); continue; }
    lineLow[ln] = r.data;
    await sleep(150);
  }
  writeJson(path.join(PUB, 'bus-snapshot.json'), {
    source: '광주광역시 광주버스정보(BIS) arriveInfo·busLocationInfo — 한 시점 스냅샷(실시간 아님)',
    provider: '광주광역시',
    url: 'https://www.data.go.kr/data/15157923/openapi.do',
    collectedAt: new Date().toISOString(),
    note: 'LOW_BUS 1=저상(응답 관찰 기준). 도착 시간은 수집 시각 기준이다.',
    stations,
    lines: lineLow,
  });
  log(`  스냅샷 저장: 정류소 ${Object.keys(stations).length}곳, 노선 ${Object.keys(lineLow).length}개 (도착정보 새 호출 ${calls}회)`);
}

// ---------- 실행 ----------
const jobs: Record<string, () => Promise<void>> = {
  crosswalks,
  toilets,
  facilities,
  'bus-stops': busStops,
  'bus-stops-bis': busStopsBis,
  'lowfloor-check': lowfloorCheck,
  routes,
  'pilot-stops': pilotStops,
  'transit-demo': transitDemo,
  'bus-snapshot': busSnapshot,
};
const arg = process.argv[2] ?? 'all';
const run = arg === 'all' ? Object.keys(jobs).filter((n) => !['routes', 'transit-demo', 'bus-snapshot'].includes(n)) : [arg]; // routes는 TMAP 호출이 들어가 따로 실행
if (run.some((n) => !(n in jobs))) {
  console.error('사용: node scripts/prefetch.ts [' + Object.keys(jobs).join('|') + '|all]');
  process.exit(1);
}
if (!DATA_KEY || !KAKAO_KEY) log('경고: .env에 DATA_GO_KR_KEY/KAKAO_REST_KEY가 비어 있음');
for (const n of run) {
  log(`== ${n} ==`);
  try {
    await jobs[n]();
  } catch (e) {
    log(`  ${n} 실패:`, (e as Error).stack ?? e);
  }
}
