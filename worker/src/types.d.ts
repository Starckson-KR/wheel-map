// wrangler 타입을 설치하지 않으려고 필요한 만큼만 직접 선언한다.
export interface AiBinding {
  run(model: string, input: { messages: { role: 'system' | 'user' | 'assistant'; content: string }[]; max_tokens?: number; temperature?: number }): Promise<unknown>
}

export interface Env {
  AI: AiBinding
  AI_MODEL?: string
  ALLOWED_ORIGINS?: string
  RATE_PER_MINUTE?: string
  DAILY_LIMIT?: string
}
