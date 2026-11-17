import { authenticate, fail, reply } from './account.ts'
import { randomHex, sha256Hex } from './auth.ts'
import { windowAllowed } from './limit.ts'
import { hubStub } from './notify.ts'
import type { D1Db, Env } from './types'

// 실시간 연결(WebSocket) 입구와 알림 보내기.
//  - POST /rt/ticket : 기존 로그인 토큰(Authorization 헤더)으로 30초짜리 1회용 티켓을 받는다. 오래 쓰는 토큰은 주소에 넣지 않는다.
//  - GET  /rt?ticket=… (Upgrade: websocket) : 티켓을 한 번 쓰고 허브(Durable Object)에 연결한다. 출처는 index.ts에서 이미 확인했다.
//  - 「바뀌었다」 신호 보내기는 notify.ts.
export const TICKET_TTL_MS = 30_000
export const TICKET_PER_MINUTE = 20
export const isRtPath = (p: string) => p === '/rt' || p === '/rt/ticket'

async function issueTicket(db: D1Db, userId: string, now: number): Promise<string> {
  const ticket = randomHex(16)
  await db.prepare('DELETE FROM rt_tickets WHERE expires_at < ?').bind(now).run()
  await db.prepare('INSERT INTO rt_tickets(hash, user_id, expires_at) VALUES(?,?,?)').bind(await sha256Hex(ticket), userId, now + TICKET_TTL_MS).run()
  return ticket
}
// 티켓을 한 번 쓰고 지운다(DELETE … RETURNING으로 한 번에: 두 번 쓰면 두 번째는 실패).
async function useTicket(db: D1Db, ticket: string, now: number): Promise<string | null> {
  const r = await db.prepare('DELETE FROM rt_tickets WHERE hash = ? RETURNING user_id AS userId, expires_at AS exp').bind(await sha256Hex(ticket)).first<{ userId: string; exp: number }>()
  return r && r.exp > now ? r.userId : null
}

export async function handleRt(request: Request, env: Env, origin: string, deps: { now?: () => number } = {}): Promise<Response> {
  const db = env.DB
  if (!db || !env.HUB) return fail(503, 'not_configured', '실시간 연결이 아직 준비되지 않았어요.', origin)
  const now = (deps.now ?? Date.now)()
  const url = new URL(request.url)
  try {
    if (url.pathname === '/rt/ticket') {
      if (request.method !== 'POST') return fail(405, 'method_not_allowed', '허용되지 않는 요청이에요.', origin)
      const a = await authenticate(db, request, now)
      if (!a) return fail(401, 'unauthorized', '다시 로그인해 주세요.', origin)
      const ip = request.headers.get('cf-connecting-ip') ?? 'unknown'
      if (!(await windowAllowed(db, 'rt', ip, now, TICKET_PER_MINUTE))) return fail(429, 'rate_limited', '잠시 뒤에 다시 해 주세요.', origin)
      return reply({ ok: true, ticket: await issueTicket(db, a.user.id, now), ttl: TICKET_TTL_MS / 1000 }, 200, origin)
    }
    // /rt: WebSocket 연결
    if (request.method !== 'GET' || request.headers.get('upgrade')?.toLowerCase() !== 'websocket') return new Response('Expected WebSocket', { status: 426 })
    const ticket = url.searchParams.get('ticket') ?? ''
    if (!/^[0-9a-f]{32}$/.test(ticket)) return new Response('unauthorized', { status: 401 })
    const userId = await useTicket(db, ticket, now)
    if (!userId) return new Response('unauthorized', { status: 401 })
    const h = new Headers(request.headers)
    h.set('x-rt-user', userId) // 허브는 이 Worker로만 부를 수 있다. 밖에서 온 같은 이름의 헤더는 위에서 덮어쓴다.
    return await hubStub(env)!.fetch(new Request(request, { headers: h }))
  } catch {
    console.log('wheelmap-ai error: rt_internal')
    return fail(500, 'server_error', '서버에 문제가 생겼어요.', origin)
  }
}
