// wrangler 타입을 설치하지 않으려고 필요한 만큼만 직접 선언한다.
export interface AiBinding {
  run(model: string, input: { messages: { role: 'system' | 'user' | 'assistant'; content: string }[]; max_tokens?: number; temperature?: number; chat_template_kwargs?: { enable_thinking?: boolean } }): Promise<unknown>
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
  // AI 검색 제공자: 'anthropic'이면 Claude로 먼저 분류(없거나 다른 값이면 Workers AI). 키는 secret으로만(wrangler secret put ANTHROPIC_API_KEY)
  AI_PROVIDER?: string
  ANTHROPIC_API_KEY?: string
  ANTHROPIC_MODEL?: string // 기본 claude-haiku-5-5
  // AI 답변(POST /answer, 웹 검색·유료): '1'일 때만 경로가 살아 있다(없거나 다른 값이면 404). 키는 위 ANTHROPIC_API_KEY를 같이 쓴다.
  ANSWER_ENABLED?: string
  ANSWER_PER_MINUTE?: string // IP별 분당 횟수(없으면 5)
  ANSWER_DAILY_LIMIT?: string // 전체 하루 상한(없으면 200)
  ALLOWED_ORIGINS?: string
  RATE_PER_MINUTE?: string
  DAILY_LIMIT?: string
  DAILY_WRITE_LIMIT?: string
  // 광주 BIS 중계: 키는 secret(wrangler secret put DATA_GO_KR_KEY)으로만 넣는다.
  DATA_GO_KR_KEY?: string
  BIS_DAILY_CAP?: string
  BIS_PER_MINUTE?: string
  // 대중교통(버스) 길찾기 중계: 키는 secret(wrangler secret put KOREACONNECT_KEY)으로만 넣는다.
  KOREACONNECT_KEY?: string
  TRANSIT_DAILY_CAP?: string
  TRANSIT_PER_MINUTE?: string
  // 국내 중계(relay/): 둘 다 있을 때만 /transit이 ODsay 대신 중계를 부른다. 비밀은 secret으로만(wrangler secret put TRANSIT_RELAY_SECRET)
  TRANSIT_RELAY_URL?: string
  TRANSIT_RELAY_SECRET?: string
  // 날씨 중계: IP별 분당 요청 수(없으면 30)
  WEATHER_PER_MINUTE?: string
}
