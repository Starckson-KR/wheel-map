// 실시간 알림 허브(Durable Object, SQLite 기반 클래스, WebSocket Hibernation).
// 메시지에는 내용이 없고 「바뀌었다」 신호만 실린다: {"t":"reports"}, {"t":"prefs"}, {"t":"presence"}(개발자 연결에만). 데이터는 앱이 기존 경로(/reports?since 등)로 당겨 간다.
// 저장소(SQL)는 쓰지 않고, 마지막 접속 시각(seen:)만 KV로 둔다. 연결 정보는 WebSocket 태그(u:<사용자 id>, 개발자는 dev)와 수락 시각(attachment)에 있고, 잠들었다 깨어나도 유지된다.
// 앱은 25초마다 "ping"을 보내고, 서버는 깨우지 않고 "pong"으로 답한다(setWebSocketAutoResponse).

export type Signal = 'reports' | 'prefs' | 'presence'

type WsLike = {
  send(data: string): void
  close(code?: number, reason?: string): void
  serializeAttachment?(v: unknown): void
  deserializeAttachment?(): unknown
  readyState?: number
}
type CtxLike = { getWebSockets(tag?: string): WsLike[] }

export const MAX_PER_USER = 6 // 한 사용자의 동시 연결(기기·탭) 상한. 넘으면 가장 오래된 것부터 닫는다
export const MAX_TOTAL = 400 // 허브 전체 동시 연결 상한(넘으면 새 연결을 받지 않는다)

export const STALE_MS = 70_000 // 이보다 오래 아무 소식(수락·ping)이 없는 연결은 끊긴 것으로 본다(앱은 25초마다 ping)
export const SEEN_KEEP_MS = 90 * 24 * 60 * 60 * 1000 // 마지막 접속 시각 보관

export const userTag = (userId: string) => `u:${userId}`
export const DEV_TAG = 'dev'
const userOfTags = (tags: string[]) => tags.find((t) => t.startsWith('u:'))?.slice(2)

export type PresenceSocket = { userId: string; at: number; ping: number | null; open: boolean }
export type Presence = { online: Record<string, number>; seen: Record<string, number> }

/** 연결 목록과 저장된 마지막 접속 시각으로 현재 접속 상황을 판정한다(순수 함수). stale에는 오래된 연결의 사용자·시각을 담는다. */
export function presenceOf(sockets: PresenceSocket[], stored: Record<string, number>, now: number): { presence: Presence; stale: number[] } {
  const online: Record<string, number> = {}
  const seen: Record<string, number> = { ...stored }
  const stale: number[] = []
  sockets.forEach((s, i) => {
    const lastAlive = Math.max(s.at, s.ping ?? 0)
    if (s.open && now - lastAlive <= STALE_MS) {
      online[s.userId] = (online[s.userId] ?? 0) + 1
    } else {
      stale.push(i)
      seen[s.userId] = Math.max(seen[s.userId] ?? 0, lastAlive)
    }
  })
  return { presence: { online, seen }, stale }
}

/** 신호를 보낸다. userId가 있으면 그 계정의 연결에만, tag가 있으면 그 태그 연결에만, 없으면 모든 연결에. 보낸 연결 수를 돌려준다. */
export function broadcast(ctx: CtxLike, signal: Signal, userId?: string, tag?: string): number {
  const msg = JSON.stringify({ t: signal })
  let n = 0
  for (const ws of ctx.getWebSockets(userId ? userTag(userId) : tag)) {
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

type HubCtx = CtxLike & {
  acceptWebSocket(ws: unknown, tags?: string[]): void
  setWebSocketAutoResponse(p?: unknown): void
  getTags?(ws: WsLike): string[]
  getWebSocketAutoResponseTimestamp?(ws: WsLike): Date | null
  storage?: { put(k: string, v: unknown): Promise<void>; list(o: { prefix: string }): Promise<Map<string, unknown>>; delete(k: string | string[]): Promise<unknown> }
}

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
      if (m.t !== 'reports' && m.t !== 'prefs' && m.t !== 'presence') return new Response('bad', { status: 400 })
      if (m.t === 'presence') return new Response(String(this.notifyDev()), { status: 200 }) // 개발자 연결에만
      const n = broadcast(this.ctx, m.t, typeof m.user === 'string' && m.user ? m.user : undefined)
      return new Response(String(n), { status: 200 })
    }
    // 계정 삭제·PIN 다시 정하기 뒤에 그 사용자의 연결을 모두 닫는다(Worker 안에서만 부른다: 밖에서 온 요청은 /rt 연결만 허브로 전달된다).
    if (path === '/close' && request.method === 'POST') {
      const user = new URL(request.url).searchParams.get('user') ?? ''
      if (!/^[A-Za-z0-9_-]{1,64}$/.test(user)) return new Response('bad', { status: 400 })
      let n = 0
      for (const ws of this.ctx.getWebSockets(userTag(user))) {
        try {
          ws.close(1008, 'gone')
          n++
        } catch {
          /* 이미 닫힘 */
        }
      }
      return new Response(String(n), { status: 200 })
    }
    // 지금 연결 수(개발자 관리의 「접속 중」 표시용). 연결 내용은 알려 주지 않고 개수만.
    if (path === '/count' && request.method === 'GET') {
      const user = new URL(request.url).searchParams.get('user') ?? ''
      if (!/^[A-Za-z0-9_-]{1,64}$/.test(user)) return new Response('bad', { status: 400 })
      return new Response(String(this.ctx.getWebSockets(userTag(user)).length), { status: 200 })
    }
    // 접속 현황(개발자 관리용): 사용자별 연결 수와 마지막 접속 시각만. 연결 내용은 내보내지 않는다.
    if (path === '/presence' && request.method === 'GET') return new Response(JSON.stringify(await this.presence()), { status: 200, headers: { 'content-type': 'application/json' } })
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
      this.ctx.acceptWebSocket(pair[1], request.headers.get('x-rt-dev') === '1' ? [userTag(user), DEV_TAG] : [userTag(user)])
      try {
        pair[1].serializeAttachment?.({ at: Date.now() })
      } catch {
        /* 수락 시각은 없어도 동작한다 */
      }
      this.notifyDev()
      return new Response(null, { status: 101, webSocket: pair[0] } as ResponseInit)
    }
    return new Response('not found', { status: 404 })
  }

  notifyDev(): number {
    return broadcast(this.ctx, 'presence', undefined, DEV_TAG)
  }

  async presence(): Promise<Presence> {
    const now = Date.now()
    const ctx = this.ctx
    const list = ctx.getWebSockets()
    const infos: { ws: WsLike; s: PresenceSocket }[] = []
    for (const ws of list) {
      const userId = userOfTags(ctx.getTags?.(ws) ?? [])
      if (!userId) continue
      let at = 0
      try {
        const a = ws.deserializeAttachment?.() as { at?: unknown } | null | undefined
        if (a && typeof a.at === 'number') at = a.at
      } catch {
        /* 무시 */
      }
      let ping: number | null = null
      try {
        ping = ctx.getWebSocketAutoResponseTimestamp?.(ws)?.getTime() ?? null
      } catch {
        /* 무시 */
      }
      infos.push({ ws, s: { userId, at, ping, open: ws.readyState === undefined || ws.readyState === 1 } })
    }
    const stored: Record<string, number> = {}
    const old: string[] = []
    try {
      for (const [k, v] of (await ctx.storage?.list({ prefix: 'seen:' })) ?? []) {
        if (typeof v !== 'number') continue
        if (now - v > SEEN_KEEP_MS) old.push(k)
        else stored[k.slice(5)] = v
      }
      if (old.length) await ctx.storage?.delete(old)
    } catch {
      /* 저장소가 안 되면 연결 정보만으로 */
    }
    const { presence, stale } = presenceOf(infos.map((i) => i.s), stored, now)
    for (const i of stale) {
      try {
        infos[i].ws.close(1011, 'stale')
      } catch {
        /* 무시 */
      }
    }
    return presence
  }

  async markSeen(ws: WsLike): Promise<void> {
    try {
      const userId = userOfTags(this.ctx.getTags?.(ws) ?? [])
      if (userId) await this.ctx.storage?.put('seen:' + userId, Date.now())
    } catch {
      /* 기록하지 못해도 연결 정리는 계속 */
    }
    this.notifyDev()
  }

  // 앱은 "ping" 말고는 보내지 않는다(그것도 자동 응답이 처리). 그 외 메시지는 무시한다.
  webSocketMessage(): void {}
  async webSocketClose(ws: WsLike): Promise<void> {
    try {
      ws.close(1000, 'bye')
    } catch {
      /* 이미 닫힘 */
    }
    await this.markSeen(ws)
  }
  async webSocketError(ws: WsLike): Promise<void> {
    try {
      ws.close(1011, 'error')
    } catch {
      /* 이미 닫힘 */
    }
    await this.markSeen(ws)
  }
}
