// 광주 BIS(광주버스정보) 호출(서버·스크립트 전용, 브라우저 번들에 들어가지 않는다).
// 개발 서버 중계(vite.config.ts)와 scripts/prefetch.ts가 함께 쓴다. serviceKey는 호출하는 쪽이 .env에서 읽어 넘기고, 오류 문구에는 넣지 않는다.
// 같은 요청은 data/public/.cache/bis/에 잠깐(ttl) 저장해 호출 수를 아끼고, 하루 호출 수는 bis-calls.json으로 센다.
import fs from 'node:fs'
import path from 'node:path'
import type { Arrival, LineLow } from '../src/lib/bus/types.ts'

const BASE = 'http://apis.data.go.kr/6290000/gj_bis/'

// 도착정보(arriveInfo) 캐시 시간. 요구: 20~30초.
export const ARRIVE_TTL_MS = 25_000
export const LINE_TTL_MS = 10 * 60_000
export const LINEINFO_TTL_MS = 24 * 3_600_000
// 하루 호출 상한(개발 중계). 공공데이터 개발계정 한도와 별개로 이 프로젝트가 스스로 거는 상한이다.
export const BIS_DAILY_CAP = 200

const cacheDir = (root: string) => path.join(root, 'data', 'public', '.cache', 'bis')

export function bisCallsToday(root: string): number {
  try {
    const v = JSON.parse(fs.readFileSync(path.join(cacheDir(root), 'bis-calls.json'), 'utf8')) as { days: Record<string, number> }
    return v.days[new Date().toISOString().slice(0, 10)] ?? 0
  } catch {
    return 0
  }
}

function bump(root: string) {
  try {
    const dir = cacheDir(root)
    fs.mkdirSync(dir, { recursive: true })
    const p = path.join(dir, 'bis-calls.json')
    let v: { total: number; days: Record<string, number> } = { total: 0, days: {} }
    try {
      v = JSON.parse(fs.readFileSync(p, 'utf8'))
    } catch {
      /* 처음 */
    }
    const day = new Date().toISOString().slice(0, 10)
    v.total++
    v.days[day] = (v.days[day] ?? 0) + 1
    fs.writeFileSync(p, JSON.stringify(v))
  } catch {
    /* 카운터 실패는 무시 */
  }
}

type Raw = { RESPONSE?: { RESULT?: { RESULT_CODE?: string; RESULT_MSG?: string }; [k: string]: unknown } }
type Fetched = { ok: true; json: Raw; fromCache: boolean } | { ok: false; error: string; limit?: boolean }

async function bisGet(op: string, params: Record<string, string>, key: string, root: string, ttlMs: number, capOverride?: number): Promise<Fetched> {
  const dir = cacheDir(root)
  fs.mkdirSync(dir, { recursive: true })
  const file = path.join(dir, `${op}-${Object.values(params).join('_').replace(/[^\w가-힣-]/g, '')}.json`)
  try {
    if (Date.now() - fs.statSync(file).mtimeMs < ttlMs) return { ok: true, json: JSON.parse(fs.readFileSync(file, 'utf8')) as Raw, fromCache: true }
  } catch {
    /* 캐시 없음·만료 */
  }
  if (!key) return { ok: false, error: 'DATA_GO_KR_KEY가 .env에 없습니다.' }
  if (bisCallsToday(root) >= (capOverride ?? BIS_DAILY_CAP)) return { ok: false, error: '오늘 BIS 호출 상한에 닿았습니다.', limit: true }
  bump(root)
  const qs = Object.entries(params)
    .map(([k, v]) => `${k}=${encodeURIComponent(v)}`)
    .join('&')
  try {
    const r = await fetch(`${BASE}${op}?serviceKey=${encodeURIComponent(key)}&${qs}&resultType=json`)
    const text = await r.text()
    if (!r.ok) return { ok: false, error: `BIS 응답 오류 HTTP ${r.status}` }
    let json: Raw
    try {
      json = JSON.parse(text) as Raw
    } catch {
      return { ok: false, error: 'BIS 응답을 읽지 못했습니다(JSON 아님).' }
    }
    const code = json.RESPONSE?.RESULT?.RESULT_CODE
    if (code !== 'SUCCESS') return { ok: false, error: `BIS 결과 ${code ?? '알 수 없음'}: ${json.RESPONSE?.RESULT?.RESULT_MSG ?? ''}`.split(key).join('<KEY>') }
    fs.writeFileSync(file, JSON.stringify(json))
    return { ok: true, json, fromCache: false }
  } catch (e) {
    return { ok: false, error: 'BIS 호출 실패: ' + (e instanceof Error ? e.message : String(e)).split(key).join('<KEY>') }
  }
}

const asArray = <T>(x: T | T[] | undefined): T[] => (Array.isArray(x) ? x : x ? [x] : [])
// RESPONSE 아래 *_LIST.ITEM을 이름에 상관없이 찾는다(오퍼레이션마다 목록 이름이 다름)
function listOf(json: Raw): Record<string, unknown>[] {
  const resp = json.RESPONSE ?? {}
  for (const [k, v] of Object.entries(resp)) {
    if (k === 'RESULT' || !v || typeof v !== 'object') continue
    const item = (v as { ITEM?: unknown }).ITEM
    if (item) return asArray(item as Record<string, unknown> | Record<string, unknown>[])
  }
  return []
}
const num = (v: unknown): number | null => (v === null || v === undefined || v === '' || Number.isNaN(Number(v)) ? null : Number(v))

export type ArriveOut = { ok: true; arrivals: Arrival[]; fromCache: boolean; collectedAt: string } | { ok: false; error: string; limit?: boolean }

export async function bisArrive(stationId: string, key: string, root: string, ttlMs = ARRIVE_TTL_MS): Promise<ArriveOut> {
  const r = await bisGet('arriveInfo', { BUSSTOP_ID: stationId }, key, root, ttlMs)
  if (!r.ok) return r
  const list = listOf(r.json)
  const arrivals: Arrival[] = list.map((x) => ({
    lineId: String(x.LINE_ID ?? ''),
    lineName: String(x.SHORT_LINE_NAME ?? x.LINE_NAME ?? ''),
    remainMin: num(x.REMAIN_MIN),
    remainStop: num(x.REMAIN_STOP),
    low: String(x.LOW_BUS) === '1',
    kind: num(x.LINE_KIND),
    ...(x.DIR_END ? { dirEnd: String(x.DIR_END) } : {}),
  }))
  arrivals.sort((a, b) => (a.remainMin ?? 9999) - (b.remainMin ?? 9999))
  return { ok: true, arrivals, fromCache: r.fromCache, collectedAt: new Date().toISOString() }
}

export type LineLowOut = { ok: true; data: LineLow; fromCache: boolean } | { ok: false; error: string; limit?: boolean }

// 노선 이름(예: 419)으로 지금 운행 중인 버스 중 저상 수를 센다. lineInfo(노선 목록)는 하루 한 번만 받는다.
export async function bisLineLow(lineName: string, key: string, root: string): Promise<LineLowOut> {
  const li = await bisGet('lineInfo', { _: 'all' }, key, root, LINEINFO_TTL_MS)
  if (!li.ok) return li
  const lines = listOf(li.json)
  const same = lines.filter((l) => String(l.SHORT_LINE_NAME ?? l.LINE_NAME) === lineName || String(l.LINE_NAME) === lineName)
  if (same.length === 0) return { ok: false, error: `노선 ${lineName}을 BIS 노선 목록에서 찾지 못했습니다.` }
  let total = 0
  let low = 0
  for (const l of same.slice(0, 2)) {
    const r = await bisGet('busLocationInfo', { LINE_ID: String(l.LINE_ID) }, key, root, LINE_TTL_MS)
    if (!r.ok) return r
    const buses = listOf(r.json)
    total += buses.length
    low += buses.filter((b) => String(b.LOW_BUS) === '1').length
  }
  return { ok: true, data: { lineName, total, low, collectedAt: new Date().toISOString() }, fromCache: false }
}
