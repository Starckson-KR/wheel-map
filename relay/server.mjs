// 국내 중계 서버: Worker(/transit) → 이 서버 → ODsay(대중교통 길찾기 한 곳)
// 의존성 없음(Node 18 이상 내장 기능만). 실행: node server.mjs
// 환경변수
//   RELAY_SECRET     (필수) Worker가 헤더 x-relay-secret으로 보내는 값. 맞지 않으면 401.
//   ODSAY_KEY        (필수) ODsay 키. 이 서버에서만 ODsay 헤더로 붙인다. 로그·응답에 쓰지 않는다.
//   PORT             (선택) 기본 8787
//   HOST             (선택) 기본 0.0.0.0 (Tunnel/Caddy 뒤에 둘 때는 127.0.0.1 권장)
//   PER_MINUTE       (선택) 분당 전체 요청 상한, 기본 30
//   TIMEOUT_MS       (선택) ODsay 응답 대기, 기본 8000
//   ODSAY_ENDPOINT   (선택) 시험용. 기본은 실제 ODsay 주소
import http from 'node:http'
import { timingSafeEqual } from 'node:crypto'

const SECRET = process.env.RELAY_SECRET ?? ''
const KEY = process.env.ODSAY_KEY ?? ''
const PORT = Number(process.env.PORT) || 8787
const HOST = process.env.HOST || '0.0.0.0'
const PER_MINUTE = Number(process.env.PER_MINUTE) > 0 ? Math.floor(Number(process.env.PER_MINUTE)) : 30
const TIMEOUT_MS = Number(process.env.TIMEOUT_MS) > 0 ? Math.floor(Number(process.env.TIMEOUT_MS)) : 8000
const ENDPOINT = process.env.ODSAY_ENDPOINT || 'https://api.koreaconnect.kr/01/1/2604071749001710344ODS/LOGIS/v1/api/searchPubTransPathT'
const KEY_HEADER = 'api_user_key_id'

if (!SECRET || !KEY) {
  console.error('relay: RELAY_SECRET, ODSAY_KEY 환경변수가 필요합니다(값은 출력하지 않음).')
  process.exit(1)
}

const send = (res, status, obj) => {
  const body = JSON.stringify(obj)
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'content-length': Buffer.byteLength(body), 'cache-control': 'no-store' })
  res.end(body)
}

function secretOk(got) {
  const a = Buffer.from(String(got ?? ''))
  const b = Buffer.from(SECRET)
  return a.length === b.length && timingSafeEqual(a, b)
}

// 분당 상한(전체 합산, 메모리). 상한을 넘으면 429. 비밀이 맞는 요청만 센다.
let windowStart = 0
let count = 0
function takeSlot(now) {
  if (now - windowStart >= 60_000) {
    windowStart = now
    count = 0
  }
  if (count >= PER_MINUTE) return false
  count += 1
  return true
}

// 허용 파라미터: 출발·도착 좌표 4개뿐(한국 범위 숫자). 나머지 ODsay 인자는 여기서 고정한다(SearchPathType=2 버스만).
const NUM = /^\d{1,3}(?:\.\d{1,8})?$/
function buildUpstream(q) {
  const out = {}
  for (const k of ['SX', 'SY', 'EX', 'EY']) {
    const v = q.get(k)
    if (v == null || !NUM.test(v)) return null
    out[k] = Number(v)
  }
  for (const k of q.keys()) if (!(k in out)) return null // 허용 안 된 파라미터가 하나라도 있으면 거절
  if ([...q.keys()].length !== 4) return null // 같은 이름 중복 금지
  const lngOk = (n) => n > 124 && n < 132
  const latOk = (n) => n > 33 && n < 39
  if (!lngOk(out.SX) || !lngOk(out.EX) || !latOk(out.SY) || !latOk(out.EY)) return null
  const u = new URL(ENDPOINT)
  u.search = `SX=${out.SX.toFixed(6)}&SY=${out.SY.toFixed(6)}&EX=${out.EX.toFixed(6)}&EY=${out.EY.toFixed(6)}&OPT=0&SearchType=0&SearchPathType=2`
  return u
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', 'http://relay.local')
  if (url.pathname === '/health') return send(res, 200, { ok: true }) // 비밀·키 없이 살아 있는지만
  if (url.pathname !== '/odsay/path') return send(res, 404, { ok: false })
  if (req.method !== 'GET') return send(res, 405, { ok: false })
  if (!secretOk(req.headers['x-relay-secret'])) return send(res, 401, { ok: false })
  const target = buildUpstream(url.searchParams)
  if (!target) return send(res, 400, { ok: false })
  if (!takeSlot(Date.now())) return send(res, 429, { ok: false })
  const ctl = new AbortController()
  const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS)
  try {
    const r = await fetch(target, { headers: { [KEY_HEADER]: KEY, accept: 'application/json', 'user-agent': 'Mozilla/5.0 (compatible; wheelmap-relay/1.0)', 'accept-language': 'ko-KR,ko;q=0.9' }, signal: ctl.signal })
    const text = await r.text()
    if (text.length > 2_000_000) return send(res, 502, { ok: false })
    // ODsay 응답을 그대로 돌려준다(Worker가 해석). 상태는 200 고정: 오류 판단은 Worker가 본문으로 한다.
    res.writeHead(200, { 'content-type': r.headers.get('content-type') ?? 'application/json', 'cache-control': 'no-store' })
    res.end(text)
    console.log(`relay ok upstream_http=${r.status}`) // 종류만
  } catch (e) {
    console.log(`relay upstream_fail ${ctl.signal.aborted ? 'timeout' : e?.name ?? 'error'}`) // 종류만(주소·키 없음)
    send(res, 502, { ok: false })
  } finally {
    clearTimeout(timer)
  }
})
server.requestTimeout = 15_000
server.listen(PORT, HOST, () => console.log(`relay listening ${HOST}:${PORT}`))
