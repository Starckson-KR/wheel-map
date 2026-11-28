import Anthropic from '@anthropic-ai/sdk'
import { INTENT_IDS } from './intents.ts'

// 질문 분류를 Claude(Anthropic API)로 부르는 길. AI_PROVIDER=anthropic 이고 키가 있을 때만 쓰인다(src/index.ts).
// 분류는 짧고 빨라야 해서 생각을 끄고(thinking disabled, effort low), JSON은 구조화 출력(json_schema)으로 받는다.
// Haiku 5.5는 temperature·top_p·top_k를 보내면 400이 나므로 보내지 않는다.

export const DEFAULT_CLAUDE_MODEL = 'claude-haiku-5-5'
export const CLAUDE_MAX_TOKENS = 200 // 분류 JSON은 60토큰 안팎

// 모델이 고르는 모양만 정한다(허용 값 검증은 validateResult가 한다). 빈칸은 모두 선택 사항.
export const CLASSIFY_SCHEMA = {
  type: 'object',
  properties: {
    intent: { type: 'string', enum: [...INTENT_IDS] },
    slots: {
      type: 'object',
      properties: {
        type: { type: 'string' },
        place: { type: 'string' },
        from: { type: 'string' },
        to: { type: 'string' },
        topic: { type: 'string' },
        query: { type: 'string' },
      },
      additionalProperties: false,
    },
    confidence: { type: 'number' },
  },
  required: ['intent', 'slots', 'confidence'],
  additionalProperties: false,
} as const

export type ClaudeUsage = { input: number; output: number; cacheRead: number; cacheWrite: number }
export type ClaudeReply = { text: string; usage: ClaudeUsage }

export type ClaudeOpts = {
  apiKey: string
  model?: string
  system: string
  question: string
  timeoutMs: number
  fetch?: typeof fetch
}

// 성공하면 JSON 글자와 토큰 사용량을 돌려준다. 실패·시간 초과·거절·잘림이면 던진다(호출한 쪽이 Workers AI로 넘어간다).
export async function askClaude(o: ClaudeOpts): Promise<ClaudeReply> {
  const client = new Anthropic({ apiKey: o.apiKey, maxRetries: 0, timeout: o.timeoutMs, ...(o.fetch ? { fetch: o.fetch } : {}) })
  const res = await client.messages.create(
    {
      model: o.model || DEFAULT_CLAUDE_MODEL,
      max_tokens: CLAUDE_MAX_TOKENS,
      thinking: { type: 'disabled' },
      output_config: { effort: 'low', format: { type: 'json_schema', schema: CLASSIFY_SCHEMA as unknown as Record<string, unknown> } },
      // 지시문은 질문과 상관없이 같으므로 캐시한다(512토큰 이상이면 적용, 아니면 조용히 건너뛴다).
      system: [{ type: 'text', text: o.system, cache_control: { type: 'ephemeral' } }],
      messages: [{ role: 'user', content: o.question }],
    },
    { signal: AbortSignal.timeout(o.timeoutMs) },
  )
  if (res.stop_reason === 'refusal') throw new Error('claude refusal')
  if (res.stop_reason === 'max_tokens') throw new Error('claude max_tokens')
  const block = res.content.find((b) => b.type === 'text')
  if (!block || block.type !== 'text' || !block.text.trim()) throw new Error('claude empty')
  const u = res.usage
  return {
    text: block.text,
    usage: { input: u.input_tokens, output: u.output_tokens, cacheRead: u.cache_read_input_tokens ?? 0, cacheWrite: u.cache_creation_input_tokens ?? 0 },
  }
}
