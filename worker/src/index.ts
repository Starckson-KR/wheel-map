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
import { authenticate, handleAccount, isAccountPath, isDev } from './account.ts'
import { handleAdmin, isAdminPath } from './admin.ts'
import { handleActivity, isActivityPath } from './activity.ts'
import { handleBis, isBisPath } from './bis.ts'
import { handleRt, isRtPath } from './rt.ts'
import { handleXmas, isXmasPath } from './xmas.ts'
import { handleTransit, isTransitPath } from './transit.ts'
import { handleWeather, isWeatherPath } from './weather.ts'
import { askClaude } from './claude.ts'
import { handleAnswer, isAnswerPath } from './answer.ts'
import type { ApiBody } from './intents.ts'
import type { Env } from './types'

const DEFAULT_MODEL = '@cf/google/gemma-4-26b-a4b-it' // 이전 모델(qwen3-30b-a3b-fp8)은 2026-11-20에 종료됐다(오류 5028)
const MODEL_TIMEOUT_MS = 6000 // 첫 호출과 재시도를 합친 총 제한(앱은 6.5초까지 기다린다)
const MIN_RETRY_MS = 1500 // 남은 시간이 이보다 적으면 재시도하지 않는다

type Limiter = ReturnType<typeof createRateLimiter>
type Deps = { limiter?: Limiter; answerLimiter?: Limiter; now?: () => number; fetch?: typeof fetch; waitUntil?: (p: Promise<unknown>) => void }

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

function logError(kind: string, e?: unknown) {
  // 질문 원문·IP는 남기지 않고 오류 종류와(모델 오류일 때) 오류 번호·메시지 앞부분만 남긴다.
  const why = e instanceof Error && e.message && e.message !== 'timeout' ? ` (${e.message.replace(/\s+/g, ' ').slice(0, 120)})` : ''
  console.log(`wheelmap-ai error: ${kind}${why}`)
}

async function isDevRequest(request: Request, env: Env, now: number): Promise<boolean> {
  if (!env.DB || !request.headers.get('authorization')) return false
  try {
    const a = await authenticate(env.DB, request, now)
    return !!a && isDev(a.user)
  } catch {
    return false
  }
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
        'access-control-allow-methods': 'GET, POST, PUT, DELETE, OPTIONS',
        'access-control-allow-headers': 'content-type, authorization',
        'access-control-max-age': '600',
        vary: 'Origin',
      },
    })
  }
  const path = new URL(request.url).pathname
  if (isRtPath(path)) return handleRt(request, env, origin as string, { now: deps.now })
  if (isXmasPath(path)) return handleXmas(request, env, origin as string)
  if (isAdminPath(path)) return handleAdmin(request, env, origin as string, { now: deps.now, waitUntil: deps.waitUntil })
  if (isActivityPath(path)) return handleActivity(request, env, origin as string, { now: deps.now, waitUntil: deps.waitUntil })
  if (isBisPath(path)) return handleBis(request, env, origin as string, { now: deps.now, fetch: deps.fetch })
  if (isTransitPath(path)) return handleTransit(request, env, origin as string, { now: deps.now, fetch: deps.fetch })
  if (isWeatherPath(path)) return handleWeather(request, env, origin as string, { now: deps.now, fetch: deps.fetch })
  if (isAccountPath(path)) return handleAccount(request, env, origin as string, { now: deps.now, waitUntil: deps.waitUntil })
  // AI 답변(웹 검색, 유료): ANSWER_ENABLED="1"일 때만 살아 있다. 꺼져 있으면 아래로 내려가 지금과 똑같이 답한다(POST는 404 not_found).
  if (isAnswerPath(path) && env.ANSWER_ENABLED === '1') return handleAnswer(request, env, origin as string, { now: deps.now, fetch: deps.fetch, answerLimiter: deps.answerLimiter })
  if (request.method !== 'POST') return json({ ok: false, error: 'method_not_allowed' }, 405, origin)
  if (path !== '/' && path !== '/intent') return json({ ok: false, error: 'not_found' }, 404, origin)

  const declared = Number(request.headers.get('content-length') ?? '0')
  if (declared > MAX_BODY_BYTES) return json(fallbackBody('too_large'), 413, origin)

  const ip = request.headers.get('cf-connecting-ip') ?? 'unknown'
  const limiter = deps.limiter ?? getLimiter(env)
  // 로그인 토큰이 같이 온 경우에만 개발자(role='dev')인지 확인해 사용 한도를 건너뛴다. 토큰이 없거나 틀리면 지금과 똑같이 센다.
  const dev = await isDevRequest(request, env, (deps.now ?? Date.now)())
  if (!dev) {
    const lim = limiter.check(ip, (deps.now ?? Date.now)())
    if (!lim.ok) return json(fallbackBody(lim.reason), 429, origin)
  }

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
          // Qwen3·Gemma 4는 기본이 「생각 모드」라 생각에 토큰을 다 써 JSON이 끊긴다. 끈다(다른 모델은 이 필드를 무시한다).
          chat_template_kwargs: { enable_thinking: false },
        }),
        new Promise<never>((_, rej) => {
          timer = setTimeout(() => rej(new Error('timeout')), timeoutMs)
        }),
      ])
    } finally {
      clearTimeout(timer)
    }
  }

  // AI_PROVIDER=anthropic 이고 키가 있으면 먼저 Claude로 분류한다. 실패·시간 초과면 남은 시간 안에서 기존 Workers AI 길로 넘어간다.
  // 그 밖(설정 없음·다른 값·키 없음)은 지금과 똑같이 Workers AI만 부른다.
  const useClaude = env.AI_PROVIDER === 'anthropic' && !!env.ANTHROPIC_API_KEY
  const askAny = async (strict: boolean, timeoutMs: number): Promise<unknown> => {
    if (!useClaude) return ask(strict, timeoutMs)
    const t0 = Date.now()
    try {
      return (await askClaude({ apiKey: env.ANTHROPIC_API_KEY as string, model: env.ANTHROPIC_MODEL, system: buildSystemPrompt(strict), question: cleaned, timeoutMs, fetch: deps.fetch })).text
    } catch (e) {
      logError('claude_error', e)
      const left = timeoutMs - (Date.now() - t0)
      if (left < MIN_RETRY_MS) throw e
      return ask(strict, left)
    }
  }

  let output: unknown
  try {
    output = await askAny(false, MODEL_TIMEOUT_MS)
  } catch (e) {
    logError(e instanceof Error && e.message === 'timeout' ? 'model_timeout' : 'model_error', e)
    return json(fallbackBody('model_error'), 200, origin)
  }

  let result = parseModelOutput(output, cleaned)
  let retried = false
  if (!result) {
    // JSON이 깨졌으면 "JSON만"을 강조해 1회만 다시 부른다(총 8초 안). 재시도도 하루 호출량에 센다.
    const left = MODEL_TIMEOUT_MS - (Date.now() - startedAt)
    if (left >= MIN_RETRY_MS) {
      retried = true
      if (!dev) limiter.charge((deps.now ?? Date.now)())
      try {
        result = parseModelOutput(await askAny(true, left), cleaned)
      } catch (e) {
        logError(e instanceof Error && e.message === 'timeout' ? 'model_timeout' : 'model_error', e)
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
  fetch(request: Request, env: Env, ctx?: { waitUntil(p: Promise<unknown>): void }): Promise<Response> {
    return handle(request, env, { waitUntil: ctx ? (p) => ctx.waitUntil(p) : undefined })
  },
}

// Durable Object 클래스는 Worker 진입 모듈에서 내보내야 한다(wrangler.toml의 durable_objects·migrations 참고).
export { RealtimeHub } from './hub.ts'
