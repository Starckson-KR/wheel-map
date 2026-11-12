// 혜택·행사 출처 페이지 변경 감시 (AI 없음, Node 내장 fetch만 사용)
// 사용: node scripts/watchBenefits.mjs [--update] [--report <파일>]
//  - 기본: 기준 파일(data/benefits/watch-state.json)과 비교만 한다(수정 안 함).
//  - --update: 사람이 확인한 뒤 기준 파일을 현재 상태로 갱신한다.
//  - --report <파일>: 결과를 마크다운으로 저장한다.
// 종료 코드: 0 = 모두 같음, 1 = 바뀜·깨짐·막힘 의심 있음(워크플로가 이슈를 만듦), 2 = 실행 오류
import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const BENEFITS = join(ROOT, 'data/benefits/benefits.json')
const STATE = join(ROOT, 'data/benefits/watch-state.json')
const USER_AGENT = 'wheelmap-benefit-watch/1.0 (compatible; Starckson-KR/wheel-map)'
const TIMEOUT_MS = 15000
const GAP_MS = 1500

// 지문 비교를 하지 않고 상태(응답 코드)만 감시하는 주소. 이유는 data/benefits/README.md 참고.
// 키는 정확한 URL. 값은 이유(보고서에 표시).
export const STATUS_ONLY = {}

// 주요 콘텐츠 영역만 쓰고 싶은 주소: URL -> 정규식 문자열(첫 매치 그룹 1을 본문으로 사용)
export const CONTENT_SELECTORS = {}

// ---------- 순수 함수 ----------
const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' }
export function decodeEntities(s) {
  return s
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&([a-z]+);/gi, (m, n) => ENT[n.toLowerCase()] ?? m)
}

export function extractTitle(html) {
  const m = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)
  return m ? decodeEntities(m[1]).replace(/\s+/g, ' ').trim() : ''
}

// 본문 텍스트 정규화: script/style/주석/태그 제거 후 잡음(날짜·시각·조회수·긴 숫자열·토큰) 제거
export function normalizeText(html, selector) {
  let h = html
  if (selector) {
    const m = new RegExp(selector, 'i').exec(h)
    if (m) h = m[1] ?? m[0]
  }
  h = h
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<(script|style|noscript|svg|head)\b[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
  h = decodeEntities(h)
  h = h
    // 줄 단위 잡음: 조회수·방문자·등록/수정일 표시
    .split(/\r?\n/)
    .filter((l) => !/(조회\s*수?|방문자|hits?|views?)\s*[:：]?\s*[\d,]+/i.test(l))
    .join(' ')
    // 날짜·시각
    .replace(/\d{4}\s*[-./년]\s*\d{1,2}\s*[-./월]\s*\d{1,2}\s*일?/g, ' ')
    .replace(/\d{1,2}\s*:\s*\d{2}(\s*:\s*\d{2})?/g, ' ')
    // 세션 토큰·긴 영숫자 해시
    .replace(/\b[0-9a-f]{16,}\b/gi, ' ')
    .replace(/\b[A-Za-z0-9_-]{24,}\b/g, ' ')
    // 6자리 이상 숫자열(번호·타임스탬프)
    .replace(/\d[\d,]{5,}/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  return h
}

export function fingerprint(text) {
  return createHash('sha256').update(text, 'utf8').digest('hex')
}

// 응답 한 건을 분류. res: {ok:boolean, status?, finalUrl?, error?}
// 분류: ok | broken(404·410·5xx 등) | blocked(네트워크 오류·401·403·429)
export function classifyResponse(res) {
  if (res.error) return 'blocked'
  const s = res.status
  if (s >= 200 && s < 300) return 'ok'
  if (s === 401 || s === 403 || s === 429) return 'blocked'
  return 'broken'
}

// 새 관측(cur)과 기준(base)을 비교 -> {verdict, reason}
// verdict: same | changed | broken | blocked | new
export function judge(cur, base, opts = {}) {
  const cls = classifyResponse(cur)
  if (cls === 'blocked') return { verdict: 'blocked', reason: cur.error ? `네트워크 오류(${cur.error})` : `HTTP ${cur.status}` }
  if (cls === 'broken') return { verdict: 'broken', reason: `HTTP ${cur.status}` }
  if (!base) return { verdict: 'new', reason: '기준 파일에 없는 주소' }
  const reasons = []
  if (base.status !== cur.status) reasons.push(`상태 ${base.status} → ${cur.status}`)
  if (base.finalUrl && cur.finalUrl && base.finalUrl !== cur.finalUrl) reasons.push(`최종 주소 변경 ${base.finalUrl} → ${cur.finalUrl}`)
  if (!opts.statusOnly) {
    if (base.fingerprint !== cur.fingerprint) reasons.push('본문 내용 지문 변경')
    if (base.title && cur.title && base.title !== cur.title) reasons.push(`제목 변경 "${base.title}" → "${cur.title}"`)
  }
  return reasons.length ? { verdict: 'changed', reason: reasons.join('; ') } : { verdict: 'same', reason: '' }
}

// ---------- 네트워크 ----------
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function fetchOnce(url) {
  const ctl = new AbortController()
  const t = setTimeout(() => ctl.abort(), TIMEOUT_MS)
  try {
    const r = await fetch(url, {
      redirect: 'follow',
      signal: ctl.signal,
      headers: { 'user-agent': USER_AGENT, accept: 'text/html,application/xhtml+xml', 'accept-language': 'ko,en;q=0.5' },
    })
    const buf = Buffer.from(await r.arrayBuffer())
    const ct = r.headers.get('content-type') ?? ''
    let charset = /charset=([\w-]+)/i.exec(ct)?.[1]?.toLowerCase()
    let html = buf.toString('latin1')
    if (!charset) charset = /<meta[^>]+charset=["']?([\w-]+)/i.exec(html)?.[1]?.toLowerCase() ?? 'utf-8'
    try {
      html = new TextDecoder(charset).decode(buf)
    } catch {
      html = buf.toString('utf8')
    }
    return { status: r.status, finalUrl: r.url, html }
  } catch (e) {
    const cause = e?.cause?.code ?? e?.name ?? 'error'
    return { error: String(cause) }
  } finally {
    clearTimeout(t)
  }
}

export async function observe(url) {
  let res = await fetchOnce(url)
  if (res.error || res.status >= 400) {
    await sleep(2000)
    const again = await fetchOnce(url)
    res = again
  }
  if (res.error) return { error: res.error }
  const out = { status: res.status, finalUrl: res.finalUrl }
  if (res.status >= 200 && res.status < 300) {
    const text = normalizeText(res.html, CONTENT_SELECTORS[url])
    out.title = extractTitle(res.html)
    out.fingerprint = fingerprint(text)
    out.textLength = text.length
  }
  return out
}

// ---------- 실행 ----------
function loadUrls() {
  const items = JSON.parse(readFileSync(BENEFITS, 'utf8')).items
  const map = new Map()
  for (const it of items) {
    if (!map.has(it.sourceUrl)) map.set(it.sourceUrl, [])
    map.get(it.sourceUrl).push(it.id)
  }
  return map
}

const LABEL = { same: '같음', changed: '바뀜', broken: '깨짐', blocked: '접속 막힘 의심', new: '새 주소' }

// 문제 상태의 서명: 같은 URL·같은 판정·같은 새 지문·같은 상태면 같은 서명 -> 이미 알린 변경은 다시 알리지 않는다.
export function problemSignature(results) {
  const parts = results
    .filter((r) => r.verdict !== 'same')
    .map((r) => [r.url, r.verdict, r.cur.status ?? r.cur.error ?? '', r.cur.fingerprint ?? ''].join('|'))
    .sort()
  return parts.length ? fingerprint(parts.join(';')).slice(0, 16) : ''
}

export function buildReport(results, checkedAt) {
  const count = (v) => results.filter((r) => r.verdict === v).length
  const lines = [
    `# 혜택·행사 출처 변경 감시 결과`,
    '',
    `확인 시각: ${checkedAt} · 같음 ${count('same')} · 바뀜 ${count('changed')} · 깨짐 ${count('broken')} · 접속 막힘 의심 ${count('blocked')} · 새 주소 ${count('new')}`,
    '',
  ]
  const problems = results.filter((r) => r.verdict !== 'same')
  if (!problems.length) lines.push('바뀐 곳이 없습니다.')
  else {
    lines.push('| 상태 | 주소 | 항목 | 내용 |', '|---|---|---|---|')
    for (const r of problems) lines.push(`| ${LABEL[r.verdict]} | ${r.url} | ${r.ids.join(', ')} | ${r.reason} |`)
    if (results.some((r) => r.verdict === 'blocked'))
      lines.push('', '> 접속 막힘 의심은 한국 공공 누리집이 해외 IP(GitHub 서버)를 막았을 수도 있습니다. **로컬(한국 네트워크)에서 `node scripts/watchBenefits.mjs`로 다시 확인**하세요.')
  }
  const so = results.filter((r) => r.statusOnly)
  if (so.length) lines.push('', `상태만 감시하는 주소: ${so.map((r) => r.url).join(', ')}`)
  return lines.join('\n') + '\n'
}

async function main() {
  const args = process.argv.slice(2)
  const update = args.includes('--update')
  const ri = args.indexOf('--report')
  const reportPath = ri >= 0 ? args[ri + 1] : null
  const urls = loadUrls()
  const state = existsSync(STATE) ? JSON.parse(readFileSync(STATE, 'utf8')) : { pages: {} }
  const checkedAt = new Date().toISOString()
  const results = []
  let first = true
  for (const [url, ids] of urls) {
    if (!first) await sleep(GAP_MS)
    first = false
    const cur = await observe(url)
    const statusOnly = url in STATUS_ONLY
    const j = judge(cur, state.pages?.[url], { statusOnly })
    results.push({ url, ids, statusOnly, cur, ...j })
    console.log(`[${LABEL[j.verdict]}] ${url}${j.reason ? ' — ' + j.reason : ''}`)
  }
  if (update) {
    const pages = {}
    for (const r of results) {
      if (r.cur.error || r.cur.status >= 400) {
        // 받지 못한 주소는 기존 기준을 유지한다.
        if (state.pages?.[r.url]) pages[r.url] = state.pages[r.url]
        continue
      }
      pages[r.url] = {
        items: r.ids,
        status: r.cur.status,
        finalUrl: r.cur.finalUrl,
        title: r.cur.title ?? '',
        fingerprint: r.cur.fingerprint ?? '',
        statusOnly: r.statusOnly,
        checkedAt,
      }
    }
    writeFileSync(STATE, JSON.stringify({ updatedAt: checkedAt, pages }, null, 2) + '\n')
    console.log(`기준 파일 갱신: ${STATE}`)
  }
  const report = buildReport(results, checkedAt)
  if (reportPath) writeFileSync(reportPath, report)
  const bad = results.some((r) => r.verdict !== 'same')
  process.exitCode = update ? 0 : bad ? 1 : 0
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((e) => {
    console.error(e)
    process.exitCode = 2
  })
}
