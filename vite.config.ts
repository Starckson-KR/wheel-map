import fs from 'node:fs'
import path from 'node:path'
import react from '@vitejs/plugin-react'
import { defineConfig, loadEnv, type Plugin } from 'vite'
import { execSync } from 'node:child_process'
import { callTmap, validateReq } from './scripts/tmapClient.ts'
import { bisArrive, bisLineLow } from './scripts/bisClient.ts'
import { callTransit, validateTransitReq } from './scripts/transitClient.ts'
import { callOdsay } from './scripts/odsayClient.ts'
import { callWeather } from './scripts/weatherClient.ts'

// 현장 사진(data/photos)은 내부 확인용이라 개발 서버에서만 제공한다.
// apply: 'serve' 이므로 build에는 이 플러그인이 쓰이지 않고, 사진은 dist에 복사되지도 번들되지도 않는다.
const PHOTO_ROUTE = '/wheel-map/__photos'
const MIME: Record<string, string> = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.gif': 'image/gif',
  '.bmp': 'image/bmp',
}

function devPhotos(): Plugin {
  const root = path.resolve(import.meta.dirname, 'data/photos')
  return {
    name: 'dev-photos',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use(PHOTO_ROUTE, (req, res, next) => {
        try {
          const rel = decodeURIComponent((req.url ?? '').split('?')[0]).replace(/^\/+/, '')
          const file = path.resolve(root, rel)
          const type = MIME[path.extname(file).toLowerCase()]
          if (!type || !file.startsWith(root + path.sep) || !fs.statSync(file).isFile()) return next()
          res.setHeader('Content-Type', type)
          res.setHeader('Cache-Control', 'no-store')
          fs.createReadStream(file).pipe(res)
        } catch {
          next()
        }
      })
    },
  }
}


// TMAP 보행자 경로 중계(개발 서버 전용). appKey는 서버 쪽에서만 .env의 TMAP_APP_KEY를 읽어 붙이고, 브라우저에는 보내지 않는다.
// apply: 'serve' 이므로 build에는 포함되지 않는다. 같은 요청은 data/routes/.cache/에 저장해 호출 수를 아낀다.
const TMAP_ROUTE = '/wheel-map/__tmap/pedestrian'

function devTmap(): Plugin {
  return {
    name: 'dev-tmap-relay',
    apply: 'serve',
    configureServer(server) {
      const root = server.config.root
      const key = () => loadEnv(server.config.mode, server.config.envDir || root, '').TMAP_APP_KEY ?? ''
      server.middlewares.use(TMAP_ROUTE, (req, res) => {
        const send = (status: number, obj: unknown) => {
          res.statusCode = status
          res.setHeader('Content-Type', 'application/json; charset=utf-8')
          res.setHeader('Cache-Control', 'no-store')
          res.end(JSON.stringify(obj))
        }
        if (req.method !== 'POST') return send(405, { error: 'POST만 허용합니다.' })
        let raw = ''
        req.on('data', (c) => {
          raw += c
          if (raw.length > 10000) req.destroy()
        })
        req.on('end', async () => {
          try {
            const body = validateReq(JSON.parse(raw))
            if (!body) return send(400, { error: '요청 형식이 올바르지 않습니다.' })
            const r = await callTmap(body, key(), root)
            console.log(`[tmap] ${r.fromCache ? '캐시' : '호출'} 경유지 ${body.via.length}개 ${r.route ? 'ok' : '실패'}`)
            if (!r.route) return send(502, { error: r.error ?? '경로 없음' })
            res.setHeader('X-Tmap-Cache', r.fromCache ? 'hit' : 'miss')
            send(200, r.route)
          } catch {
            send(400, { error: '요청을 읽지 못했습니다.' })
          }
        })
      })
    },
  }
}

// 광주 BIS 저상버스 도착 중계(개발 서버 전용, 7단계). serviceKey는 서버 쪽에서만 .env의 DATA_GO_KR_KEY를 읽어 쓰고 브라우저·로그에는 내보내지 않는다.
// apply: 'serve' 이므로 build에는 포함되지 않는다(배포판은 미리 받아 둔 한 시점 스냅샷만 보여 준다).
// 같은 정류소는 25초 캐시(scripts/bisClient.ts), 하루 호출 상한도 거기서 센다.
// 실서비스로 가려면 이 두 경로(/__bis/arrive, /__bis/line)를 Cloudflare Workers 같은 HTTPS 중계 서버로 옮기고
// src/lib/bus/provider.ts의 RELAY_BASE만 바꾸면 된다(주석 참고).
const BIS_ROUTE = '/wheel-map/__bis'

function devBis(): Plugin {
  return {
    name: 'dev-bis-relay',
    apply: 'serve',
    configureServer(server) {
      const root = server.config.root
      const key = () => loadEnv(server.config.mode, server.config.envDir || root, '').DATA_GO_KR_KEY ?? ''
      server.middlewares.use(BIS_ROUTE, async (req, res) => {
        const send = (status: number, obj: unknown) => {
          res.statusCode = status
          res.setHeader('Content-Type', 'application/json; charset=utf-8')
          res.setHeader('Cache-Control', 'no-store')
          res.end(JSON.stringify(obj))
        }
        if (req.method !== 'GET') return send(405, { error: 'GET만 허용합니다.' })
        const u = new URL(req.url ?? '/', 'http://x')
        try {
          if (u.pathname === '/arrive') {
            const id = u.searchParams.get('station') ?? ''
            if (!/^\d{1,7}$/.test(id)) return send(400, { error: '정류소 번호 형식이 올바르지 않습니다.' })
            const r = await bisArrive(id, key(), root)
            console.log(`[bis] 도착 ${id} ${r.ok ? (r.fromCache ? '캐시' : '호출') : '실패'}`)
            if (!r.ok) return send(r.limit ? 429 : 502, { error: r.error })
            return send(200, { stationId: id, collectedAt: r.collectedAt, arrivals: r.arrivals, cached: r.fromCache })
          }
          if (u.pathname === '/line') {
            const name = u.searchParams.get('name') ?? ''
            if (!/^[\w가-힣-]{1,20}$/.test(name)) return send(400, { error: '노선 이름 형식이 올바르지 않습니다.' })
            const r = await bisLineLow(name, key(), root)
            console.log(`[bis] 노선 ${name} ${r.ok ? 'ok' : '실패'}`)
            if (!r.ok) return send(r.limit ? 429 : 502, { error: r.error })
            return send(200, r.data)
          }
          send(404, { error: '없는 경로입니다.' })
        } catch {
          send(500, { error: '중계 처리 중 문제가 생겼습니다.' })
        }
      })
    },
  }
}

// TMAP 대중교통 경로 중계(개발 서버 전용). 무료 상품은 하루 10건이라 scripts/transitClient.ts에서 하루 상한을 스스로 건다.
const TRANSIT_ROUTE = '/wheel-map/__tmap/transit'

function devTransit(): Plugin {
  return {
    name: 'dev-tmap-transit-relay',
    apply: 'serve',
    configureServer(server) {
      const root = server.config.root
      const key = () => loadEnv(server.config.mode, server.config.envDir || root, '').TMAP_APP_KEY ?? ''
      server.middlewares.use(TRANSIT_ROUTE, (req, res) => {
        const send = (status: number, obj: unknown) => {
          res.statusCode = status
          res.setHeader('Content-Type', 'application/json; charset=utf-8')
          res.setHeader('Cache-Control', 'no-store')
          res.end(JSON.stringify(obj))
        }
        if (req.method !== 'POST') return send(405, { error: 'POST만 허용합니다.' })
        let raw = ''
        req.on('data', (c) => {
          raw += c
          if (raw.length > 2000) req.destroy()
        })
        req.on('end', async () => {
          try {
            const body = validateTransitReq(JSON.parse(raw))
            if (!body) return send(400, { error: '요청 형식이 올바르지 않습니다.' })
            const r = await callTransit(body, key(), root)
            console.log(`[transit] ${r.ok ? (r.fromCache ? '캐시' : '호출') : '실패'}`)
            if (!r.ok) return send(r.limit ? 429 : 502, { error: r.error })
            send(200, { itineraries: r.itineraries, cached: r.fromCache })
          } catch {
            send(400, { error: '요청을 읽지 못했습니다.' })
          }
        })
      })
    },
  }
}

// ODsay 대중교통 길찾기 중계(개발 서버 전용). 키는 .env의 KOREACONNECT_KEY를 서버 쪽에서만 읽는다. 배포판은 Worker의 /transit을 쓴다(worker/src/transit.ts).
// 응답 형식은 TMAP 중계와 같다. 상태: 503=키 없음, 429=하루 상한, 422=경로 없음, 502=상류 오류.
const ODSAY_ROUTE = '/wheel-map/__odsay/transit'

function devOdsay(): Plugin {
  return {
    name: 'dev-odsay-relay',
    apply: 'serve',
    configureServer(server) {
      const root = server.config.root
      const key = () => (loadEnv(server.config.mode, server.config.envDir || root, '').KOREACONNECT_KEY ?? '').trim()
      server.middlewares.use(ODSAY_ROUTE, (req, res) => {
        const send = (status: number, obj: unknown) => {
          res.statusCode = status
          res.setHeader('Content-Type', 'application/json; charset=utf-8')
          res.setHeader('Cache-Control', 'no-store')
          res.end(JSON.stringify(obj))
        }
        if (req.method !== 'POST') return send(405, { error: 'POST만 허용합니다.' })
        let raw = ''
        req.on('data', (c) => {
          raw += c
          if (raw.length > 2000) req.destroy()
        })
        req.on('end', async () => {
          try {
            const body = validateTransitReq(JSON.parse(raw))
            if (!body) return send(400, { error: '요청 형식이 올바르지 않습니다.' })
            const r = await callOdsay(body.from, body.to, key(), root)
            console.log(`[odsay] ${r.ok ? (r.fromCache ? '캐시' : '호출') : '실패 ' + r.status}`)
            if (!r.ok) return send(r.status === 'nokey' ? 503 : r.status === 'limit' ? 429 : r.status === 'noroute' ? 422 : 502, { error: r.error })
            send(200, { itineraries: r.itineraries, cached: r.fromCache })
          } catch {
            send(400, { error: '요청을 읽지 못했습니다.' })
          }
        })
      })
    },
  }
}

// 기상청 날씨 중계(개발 서버 전용). 키는 .env의 DATA_GO_KR_KEY를 서버 쪽에서만 읽는다. 배포판은 Worker의 /weather를 쓴다(worker/src/weather.ts).
const WEATHER_ROUTE = '/wheel-map/__weather'

function devWeather(): Plugin {
  return {
    name: 'dev-weather-relay',
    apply: 'serve',
    configureServer(server) {
      const root = server.config.root
      const key = () => loadEnv(server.config.mode, server.config.envDir || root, '').DATA_GO_KR_KEY ?? ''
      server.middlewares.use(WEATHER_ROUTE, async (req, res) => {
        const send = (status: number, obj: unknown) => {
          res.statusCode = status
          res.setHeader('Content-Type', 'application/json; charset=utf-8')
          res.setHeader('Cache-Control', 'no-store')
          res.end(JSON.stringify(obj))
        }
        if (req.method !== 'GET') return send(405, { ok: false })
        try {
          const r = await callWeather(key())
          console.log(`[weather] ${r.ok ? (r.fromCache ? '캐시' : '호출') : '실패'}`)
          if (!r.ok) return send(502, { ok: false })
          send(200, { ok: true, ...r.w })
        } catch {
          send(500, { ok: false })
        }
      })
    },
  }
}

// https://vite.dev/config/
function gitInfo() {
  let hash = 'dev'
  try {
    hash = execSync('git rev-parse --short HEAD', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim() || 'dev'
    // 배포(CI)에서는 npm ci가 추적 파일을 바꿔도 +dirty를 붙이지 않는다(붙으면 새 버전 자동 적용이 꺼진다).
    if (!process.env.CI && execSync('git status --porcelain', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim()) hash += '+dirty'
  } catch {
    hash = 'dev'
  }
  // 빌드 서버는 UTC일 수 있어 시간대를 한국(KST)으로 고정해 표시한다.
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Seoul', hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
      .formatToParts(new Date())
      .map((x) => [x.type, x.value]),
  )
  return { hash, time: `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}` }
}
const BUILD = gitInfo()

// 배포마다 dist/version.json({build, time})을 만든다. build는 번들에 박힌 __BUILD_HASH__와 같은 값이라 앱이 새 버전 여부를 비교한다.
function versionFile(): Plugin {
  return {
    name: 'version-file',
    apply: 'build',
    generateBundle() {
      this.emitFile({ type: 'asset', fileName: 'version.json', source: JSON.stringify({ build: BUILD.hash, time: BUILD.time }) })
    },
  }
}

export default defineConfig({
  define: { __BUILD_HASH__: JSON.stringify(BUILD.hash), __BUILD_TIME__: JSON.stringify(BUILD.time) },
  base: '/wheel-map/', // GitHub Pages(저장소 이름)용
  // Worker 허용 출처가 localhost:5173뿐이라 포트를 고정한다. 이미 쓰는 중이면 다른 번호로 옮겨 가지 않고 실패한다.
  server: { port: 5173, strictPort: true },
  plugins: [react(), versionFile(), devPhotos(), devTmap(), devBis(), devTransit(), devOdsay(), devWeather()],
})
