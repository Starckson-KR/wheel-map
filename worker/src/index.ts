import {
  MAX_BODY_BYTES,
  MAX_QUESTION_CHARS,
  buildSystemPrompt,
  createRateLimiter,
  fallbackBody,
  isAllowedOrigin,
  okBody,
  parseModelOutput,
  parseOrigins,
  sanitizeQuestion,
} from './intents.ts'
import { applyRules, isNonsense } from './rules.ts'
import type { ApiBody } from './intents.ts'
import type { Env } from './types'

const DEFAULT_MODEL = '@cf/meta/llama-3.2-3b-instruct'
const MODEL_TIMEOUT_MS = 8000 // 첫 호출과 재시도를 합친 총 제한
const MIN_RETRY_MS = 1500 // 남은 시간이 이보다 적으면 재시도하지 않는다

type Limiter = ReturnType<typeof createRateLimiter>
type Deps = { limiter?: Limiter; now?: () => number }

let sharedLimiter: { key: string; limiter: Limiter } | null = null
function getLimiter(env: Env): Limiter {
  const perMin = Number(env.RATE_PER_MINUTE) > 0 ? Number(env.RATE_PER_MINUTE) : 10
  const perDay = Number(env.DAILY_LIMIT) > 0 ? Number(env.DAILY_LIMIT) : 500
  const key = `${perMin}/${perDay}`
  if (!sharedLimiter || sharedLimiter.key !== key) sharedLimiter = { key, limiter: createRateLimiter(perMin, perDay) }
  return sharedLimiter.limiter
}

function json(body: ApiBody | { ok: false; error: string }, status: number, origin: string | null): Response {
  const headers: Record<string, string> = { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }
  if (origin) {
    headers['access-control-allow-origin'] = origin
    headers['vary'] = 'Origin'
  }
  return new Response(JSON.stringify(body), { status, headers })
}

function logError(kind: string) {
  // 질문 원문·IP는 남기지 않고 오류 종류만 남긴다.
  console.log(`wheelmap-ai error: ${kind}`)
}

export async function handle(request: Request, env: Env, deps: Deps = {}): Promise<Response> {
  const allowed = parseOrigins(env.ALLOWED_ORIGINS ?? 'https://starckson-kr.github.io,http://localhost:5173')
  const origin = request.headers.get('origin')
  if (!isAllowedOrigin(origin, allowed)) return json({ ok: false, error: 'forbidden' }, 403, null)

  if (request.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: {
        'access-control-allow-origin': origin as string,
        'access-control-allow-methods': 'POST, OPTIONS',
        'access-control-allow-headers': 'content-type',
        'access-control-max-age': '600',
        vary: 'Origin',
      },
    })
  }
  if (request.method !== 'POST') return json({ ok: false, error: 'method_not_allowed' }, 405, origin)
  const path = new URL(request.url).pathname
  if (path !== '/' && path !== '/intent') return json({ ok: false, error: 'not_found' }, 404, origin)

  const declared = Number(request.headers.get('content-length') ?? '0')
  if (declared > MAX_BODY_BYTES) return json(fallbackBody('too_large'), 413, origin)

  const ip = request.headers.get('cf-connecting-ip') ?? 'unknown'
  const limiter = deps.limiter ?? getLimiter(env)
  const lim = limiter.check(ip, (deps.now ?? Date.now)())
  if (!lim.ok) return json(fallbackBody(lim.reason), 429, origin)

  let text: string
  try {
    text = await request.text()
  } catch {
    return json(fallbackBody('bad_request'), 400, origin)
  }
  if (new TextEncoder().encode(text).length > MAX_BODY_BYTES) return json(fallbackBody('too_large'), 413, origin)

  let question: unknown
  try {
    question = (JSON.parse(text) as { question?: unknown }).question
  } catch {
    return json(fallbackBody('bad_request'), 400, origin)
  }
  if (typeof question !== 'string') return json(fallbackBody('bad_request'), 400, origin)
  const cleaned = sanitizeQuestion(question)
  if (!cleaned) return json(fallbackBody('bad_request'), 400, origin)
  if ([...question.trim()].length > MAX_QUESTION_CHARS) return json(fallbackBody('too_long'), 400, origin)

  // 뜻 없는 입력(자음·모음뿐, 한글 음절 2개 미만)은 모델을 부르지 않고 바로 unknown.
  if (isNonsense(cleaned)) return json(okBody({ intent: 'unknown', slots: {}, confidence: 0.9 }), 200, origin)

  const startedAt = Date.now()
  const model = env.AI_MODEL || DEFAULT_MODEL
  const ask = async (strict: boolean, timeoutMs: number): Promise<unknown> => {
    let timer: ReturnType<typeof setTimeout> | undefined
    try {
      return await Promise.race([
        env.AI.run(model, {
          messages: [
            { role: 'system', content: buildSystemPrompt(strict) },
            { role: 'user', content: cleaned },
          ],
          max_tokens: 120,
          temperature: 0,
        }),
        new Promise<never>((_, rej) => {
          timer = setTimeout(() => rej(new Error('timeout')), timeoutMs)
        }),
      ])
    } finally {
      clearTimeout(timer)
    }
  }

  let output: unknown
  try {
    output = await ask(false, MODEL_TIMEOUT_MS)
  } catch (e) {
    logError(e instanceof Error && e.message === 'timeout' ? 'model_timeout' : 'model_error')
    return json(fallbackBody('model_error'), 200, origin)
  }

  let result = parseModelOutput(output, cleaned)
  let retried = false
  if (!result) {
    // JSON이 깨졌으면 "JSON만"을 강조해 1회만 다시 부른다(총 8초 안). 재시도도 하루 호출량에 센다.
    const left = MODEL_TIMEOUT_MS - (Date.now() - startedAt)
    if (left >= MIN_RETRY_MS) {
      retried = true
      limiter.charge((deps.now ?? Date.now)())
      try {
        result = parseModelOutput(await ask(true, left), cleaned)
      } catch (e) {
        logError(e instanceof Error && e.message === 'timeout' ? 'model_timeout' : 'model_error')
      }
    }
    if (!result) {
      logError('bad_output')
      return json(fallbackBody('bad_output', retried), 200, origin)
    }
  }
  return json(okBody(applyRules(cleaned, result), retried), 200, origin)
}

export default {
  fetch(request: Request, env: Env): Promise<Response> {
    return handle(request, env)
  },
}
