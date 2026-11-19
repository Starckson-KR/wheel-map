// ODsay 대중교통 길찾기 호출(디지털융합플랫폼 경유, 서버·스크립트 전용 — 브라우저 번들에 들어가지 않는다).
// 개발 서버 중계(vite.config.ts)와 scripts/prefetch.ts가 함께 쓴다. 키(KOREACONNECT_KEY)는 호출하는 쪽이 .env에서 읽어 넘기고, 오류 문구에는 넣지 않는다.
// 같은 요청은 data/routes/.cache/에 저장해 호출 수를 아끼고, 하루 호출 수는 odsay-calls.json으로 센다.
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import type { Pt } from '../src/lib/routing/engine.ts'
import { isNoRouteCode, ODSAY_KEY_HEADER, odsayUrl, parseOdsay } from '../src/lib/transit/odsay.ts'
import type { TItinerary } from '../src/lib/transit/parse.ts'

// 포털 상세에 일 한도 표기가 없다(확인 필요). 이 프로젝트가 스스로 거는 상한이다.
export const ODSAY_DAILY_CAP = 200

export type OdsayOut =
  | { ok: true; itineraries: TItinerary[]; fromCache: boolean }
  | { ok: false; error: string; code?: string; status: 'nokey' | 'limit' | 'noroute' | 'upstream' }

const dirOf = (root: string) => path.join(root, 'data', 'routes', '.cache')
const keyOf = (from: Pt, to: Pt) => {
  const f = (p: Pt) => `${p[1].toFixed(6)},${p[0].toFixed(6)}`
  return 'odsay-' + crypto.createHash('sha1').update(`${f(from)}|${f(to)}`).digest('hex').slice(0, 20)
}
const dayNow = () => new Date().toISOString().slice(0, 10)

export function odsayCallsToday(root: string): number {
  try {
    const v = JSON.parse(fs.readFileSync(path.join(dirOf(root), 'odsay-calls.json'), 'utf8')) as { days: Record<string, number> }
    return v.days[dayNow()] ?? 0
  } catch {
    return 0
  }
}
function bump(root: string) {
  try {
    const p = path.join(dirOf(root), 'odsay-calls.json')
    let v: { total: number; days: Record<string, number> } = { total: 0, days: {} }
    try {
      v = JSON.parse(fs.readFileSync(p, 'utf8'))
    } catch {
      /* 처음 */
    }
    v.total++
    v.days[dayNow()] = (v.days[dayNow()] ?? 0) + 1
    fs.writeFileSync(p, JSON.stringify(v))
  } catch {
    /* 무시 */
  }
}

// 캐시 → (없으면) 실제 호출. 길을 못 찾은 경우도 잠깐 안 부르려고 캐시하지는 않는다(실패는 캐시하지 않는다).
export async function callOdsay(from: Pt, to: Pt, key: string, root: string): Promise<OdsayOut> {
  const dir = dirOf(root)
  fs.mkdirSync(dir, { recursive: true })
  const file = path.join(dir, keyOf(from, to) + '.json')
  try {
    return { ok: true, itineraries: JSON.parse(fs.readFileSync(file, 'utf8')) as TItinerary[], fromCache: true }
  } catch {
    /* 캐시 없음 */
  }
  if (!key) return { ok: false, status: 'nokey', error: '버스 경로 중계가 아직 준비되지 않았어요.' }
  if (odsayCallsToday(root) >= ODSAY_DAILY_CAP) return { ok: false, status: 'limit', error: '오늘 버스 경로 조회 한도에 닿았어요.' }
  bump(root)
  try {
    const r = await fetch(odsayUrl(from, to), { headers: { [ODSAY_KEY_HEADER]: key, Accept: 'application/json' } })
    const text = await r.text()
    let json: unknown = null
    try {
      json = JSON.parse(text)
    } catch {
      /* 아래에서 처리 */
    }
    const p = parseOdsay(json, from, to)
    if (!p.ok) {
      console.log(`[odsay] 경로 없음/오류 HTTP ${r.status}, 코드 ${p.code || '-'}`) // 이용자 화면에는 사용자용 문장만 보낸다
      return { ok: false, code: p.code, status: isNoRouteCode(p.code) || p.code === '-99' ? 'noroute' : 'upstream', error: p.message }
    }
    fs.writeFileSync(file, JSON.stringify(p.itineraries))
    return { ok: true, itineraries: p.itineraries, fromCache: false }
  } catch (e) {
    console.log('[odsay] 호출 실패: ' + (e instanceof Error ? e.message : String(e)).split(key).join('<KEY>'))
    return { ok: false, status: 'upstream', error: '지금은 버스 경로를 찾지 못했어요.' }
  }
}
