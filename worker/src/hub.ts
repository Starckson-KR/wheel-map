// 실시간 알림 허브(Durable Object, SQLite 기반 클래스, WebSocket Hibernation).
// 메시지에는 내용이 없고 「바뀌었다」 신호만 실린다: {"t":"reports"} 또는 {"t":"prefs"}. 데이터는 앱이 기존 경로(/reports?since 등)로 당겨 간다.
// 저장소(SQL)는 쓰지 않는다. 연결 정보는 WebSocket 태그(u:<사용자 id>)에만 있고, 잠들었다 깨어나도 유지된다.
// 앱은 25초마다 "ping"을 보내고, 서버는 깨우지 않고 "pong"으로 답한다(setWebSocketAutoResponse).

export type Signal = 'reports' | 'prefs'

type WsLike = { send(data: string): void; close(code?: number, reason?: string): void }
type CtxLike = { getWebSockets(tag?: string): WsLike[] }

export const MAX_PER_USER = 6 // 한 사용자의 동시 연결(기기·탭) 상한. 넘으면 가장 오래된 것부터 닫는다
export const MAX_TOTAL = 400 // 허브 전체 동시 연결 상한(넘으면 새 연결을 받지 않는다)

export const userTag = (userId: string) => `u:${userId}`

/** 신호를 보낸다. userId가 있으면 그 계정의 연결에만, 없으면 모든 연결에. 보낸 연결 수를 돌려준다. */
export function broadcast(ctx: CtxLike, signal: Signal, userId?: string): number {
  const msg = JSON.stringify({ t: signal })
  let n = 0
  for (const ws of ctx.getWebSockets(userId ? userTag(userId) : undefined)) {
    try {
      ws.send(msg)
      n++
    } catch {
      /* 이미 끊긴 연결은 무시 */
    }
  }
  return n
}

declare const WebSocketPair: { new (): { 0: unknown; 1: WsLike } }
declare const WebSocketRequestResponsePair: { new (req: string, res: string): unknown }

type HubCtx = CtxLike & { acceptWebSocket(ws: unknown, tags?: string[]): void; setWebSocketAutoResponse(p?: unknown): void }

export class RealtimeHub {
  ctx: HubCtx
  constructor(ctx: HubCtx) {
    this.ctx = ctx
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('ping', 'pong'))
  }

  async fetch(request: Request): Promise<Response> {
    const path = new URL(request.url).pathname
    if (path === '/publish' && request.method === 'POST') {
      let m: { t?: unknown; user?: unknown } = {}
      try {
        m = (await request.json()) as typeof m
      } catch {
        return new Response('bad', { status: 400 })
      }
      if (m.t !== 'reports' && m.t !== 'prefs') return new Response('bad', { status: 400 })
      const n = broadcast(this.ctx, m.t, typeof m.user === 'string' && m.user ? m.user : undefined)
      return new Response(String(n), { status: 200 })
    }
    // 지금 연결 수(개발자 관리의 「접속 중」 표시용). 연결 내용은 알려 주지 않고 개수만.
    if (path === '/count' && request.method === 'GET') {
      const user = new URL(request.url).searchParams.get('user') ?? ''
      if (!/^[A-Za-z0-9_-]{1,64}$/.test(user)) return new Response('bad', { status: 400 })
      return new Response(String(this.ctx.getWebSockets(userTag(user)).length), { status: 200 })
    }
    if (path === '/rt' && request.headers.get('upgrade')?.toLowerCase() === 'websocket') {
      const user = request.headers.get('x-rt-user') ?? ''
      if (!/^[A-Za-z0-9_-]{1,64}$/.test(user)) return new Response('bad', { status: 400 })
      if (this.ctx.getWebSockets().length >= MAX_TOTAL) return new Response('busy', { status: 503 })
      const mine = this.ctx.getWebSockets(userTag(user))
      for (const old of mine.slice(0, Math.max(0, mine.length - (MAX_PER_USER - 1)))) {
        try {
          old.close(1000, 'replaced')
        } catch {
          /* 무시 */
        }
      }
      const pair = new WebSocketPair()
      this.ctx.acceptWebSocket(pair[1], [userTag(user)])
      return new Response(null, { status: 101, webSocket: pair[0] } as ResponseInit)
    }
    return new Response('not found', { status: 404 })
  }

  // 앱은 "ping" 말고는 보내지 않는다(그것도 자동 응답이 처리). 그 외 메시지는 무시한다.
  webSocketMessage(): void {}
  webSocketClose(ws: WsLike): void {
    try {
      ws.close(1000, 'bye')
    } catch {
      /* 이미 닫힘 */
    }
  }
  webSocketError(ws: WsLike): void {
    try {
      ws.close(1011, 'error')
    } catch {
      /* 이미 닫힘 */
    }
  }
}
