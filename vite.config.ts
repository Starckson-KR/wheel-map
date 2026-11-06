import fs from 'node:fs'
import path from 'node:path'
import react from '@vitejs/plugin-react'
import { defineConfig, loadEnv, type Plugin } from 'vite'
import { execSync } from 'node:child_process'
import { callTmap, validateReq } from './scripts/tmapClient.ts'
import { bisArrive, bisLineLow } from './scripts/bisClient.ts'
import { callTransit, validateTransitReq } from './scripts/transitClient.ts'

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

// https://vite.dev/config/
function gitInfo() {
  let hash = 'dev'
  try {
    hash = execSync('git rev-parse --short HEAD', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim() || 'dev'
    if (execSync('git status --porcelain', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim()) hash += '+dirty'
  } catch {
    hash = 'dev'
  }
  const d = new Date()
  const p = (n: number) => String(n).padStart(2, '0')
  return { hash, time: `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}` }
}
const BUILD = gitInfo()

export default defineConfig({
  define: { __BUILD_HASH__: JSON.stringify(BUILD.hash) },
  base: '/wheel-map/', // GitHub Pages(저장소 이름)용
  plugins: [react(), devPhotos(), devTmap(), devBis(), devTransit()],
})
