// wrangler 타입을 설치하지 않으려고 필요한 만큼만 직접 선언한다.
export interface AiBinding {
  run(model: string, input: { messages: { role: 'system' | 'user' | 'assistant'; content: string }[]; max_tokens?: number; temperature?: number }): Promise<unknown>
}

// D1(SQLite) 최소 선언. 시험에서는 node:sqlite로 같은 모양의 가짜를 만든다.
export interface D1Statement {
  bind(...values: unknown[]): D1Statement
  first<T = Record<string, unknown>>(): Promise<T | null>
  all<T = Record<string, unknown>>(): Promise<{ results: T[] }>
  run(): Promise<{ meta?: { changes?: number } }>
}
export interface D1Db {
  prepare(sql: string): D1Statement
  batch(statements: D1Statement[]): Promise<unknown[]>
}

// Durable Object 최소 선언(허브: worker/src/hub.ts)
export interface DoStub {
  fetch(input: string | Request, init?: RequestInit): Promise<Response>
}
export interface DoNamespace {
  idFromName(name: string): unknown
  get(id: unknown, opts?: { locationHint?: string }): DoStub
}

export interface Env {
  AI: AiBinding
  DB?: D1Db
  HUB?: DoNamespace // 실시간 알림 허브. 없으면(시험·미설정) 알림만 건너뛴다
  AI_MODEL?: string
  ALLOWED_ORIGINS?: string
  RATE_PER_MINUTE?: string
  DAILY_LIMIT?: string
  DAILY_WRITE_LIMIT?: string
  // 광주 BIS 중계: 키는 secret(wrangler secret put DATA_GO_KR_KEY)으로만 넣는다.
  DATA_GO_KR_KEY?: string
  BIS_DAILY_CAP?: string
  BIS_PER_MINUTE?: string
}
