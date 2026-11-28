import Anthropic from '@anthropic-ai/sdk'
import { DEFAULT_CLAUDE_MODEL } from './claude.ts'
import { MAX_QUESTION_CHARS, createRateLimiter, sanitizeQuestion } from './intents.ts'
import { isNonsense } from './rules.ts'
import { ALLOWED_DOMAINS, siteOf } from './answerSources.ts'
import { assembleAnswer, buildAnswerSystem, buildUserMessage, cleanHistory, cleanNeed, createSplitter } from './answerCore.ts'
import type { AnswerFinal, Citation, HistoryTurn } from './answerCore.ts'
import type { Env } from './types'

// 수요응답형 AI 답변: POST /answer (ANSWER_ENABLED="1"일 때만 살아 있다 — src/index.ts).
// Claude Haiku 5.5 + Anthropic 웹 검색 서버 도구를 공공 사이트 목록(answerSources.ts)으로 묶어 부르고, 결과를 SSE로 흘려보낸다.
// 질문 원문·IP·답은 저장하지도 로그에 남기지도 않는다(오류 종류만 남긴다).

export const ANSWER_MAX_BODY_BYTES = 4096
export const ANSWER_MAX_TOKENS = 4000 // 생각 + 필요 한 줄 + 답 2~3문장 + 꼬리 JSON. 1500에서는 생각이 길어진 질문의 답·꼬리가 잘렸다(2026-11-28 실측)
export const ANSWER_MAX_SEARCHES = 2
export const ANSWER_TIMEOUT_MS = 30_000
export const DEFAULT_ANSWER_PER_MINUTE = 5
export const DEFAULT_ANSWER_DAILY_LIMIT = 200 // 검색 1번에 약 1센트라 하루 상한을 낮게 둔다
const MAX_TURN_RESUMES = 1 // pause_turn이면 한 번만 이어 받는다

// 기본 웹 검색(web_search_20250305)을 쓴다: 모델이 직접 검색하고 결과 블록이 그대로 온다.
// _20260209 이후 버전은 기본이 「코드 실행 안에서 검색」(dynamic filtering)이라 블록 모양이 달라지고 한 단계가 더 붙는다. 짧은 답 1~2번 검색에는 필요 없다.
const SEARCH_TOOL: Anthropic.WebSearchTool20250305 = {
  type: 'web_search_20250305',
  name: 'web_search',
  max_uses: ANSWER_MAX_SEARCHES,
  allowed_domains: ALLOWED_DOMAINS,
  user_location: { type: 'approximate', city: 'Gwangju', region: 'Gwangju', country: 'KR', timezone: 'Asia/Seoul' },
}

export type AnswerEvent =
  | { type: 'need'; text: string }
  | { type: 'status'; phase: 'searching'; query: string }
  | { type: 'status'; phase: 'reading'; sites: { name: string; domain: string }[] }
  | { type: 'delta'; text: string }
  | { type: 'reset' } // 지금까지 흘린 답 글자를 지운다(모델이 글을 쓰다 다시 검색했을 때)
  | ({ type: 'done' } & AnswerFinal)
  | { type: 'error'; reason: AnswerErrorReason }
export type AnswerErrorReason = 'timeout' | 'busy' | 'upstream'

export type AnswerUsage = { input: number; output: number; cacheRead: number; cacheWrite: number; searches: number }
export type AnswerRun = { final: AnswerFinal; usage: AnswerUsage }

export type AnswerOpts = {
  apiKey: string
  model?: string
  question: string // 정리(sanitizeQuestion)된 질문
  history?: HistoryTurn[]
  timeoutMs?: number
  effort?: 'low' | 'medium' | 'high'
  thinking?: 'adaptive' | 'disabled'
  fetch?: typeof fetch
  signal?: AbortSignal
}

// 모델을 부르고, 흘러오는 블록을 화면용 조각(AnswerEvent)으로 바꿔 emit한다. 끝나면 검증된 최종 조각과 사용량을 돌려준다.
// API 오류·시간 초과는 던진다(부른 쪽이 error 조각으로 바꾼다).
export async function runAnswer(o: AnswerOpts, emit: (e: AnswerEvent) => void): Promise<AnswerRun> {
  const timeoutMs = o.timeoutMs ?? ANSWER_TIMEOUT_MS
  const client = new Anthropic({ apiKey: o.apiKey, maxRetries: 0, timeout: timeoutMs, ...(o.fetch ? { fetch: o.fetch } : {}) })
  const signal = o.signal ? AbortSignal.any([o.signal, AbortSignal.timeout(timeoutMs)]) : AbortSignal.timeout(timeoutMs)
  const messages: Anthropic.MessageParam[] = [{ role: 'user', content: buildUserMessage(o.question, o.history ?? []) }]
  const usage: AnswerUsage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, searches: 0 }

  let need = ''
  let answerText = ''
  let searched = false
  let refused = false
  let streamed = false // 답 글자를 화면에 흘린 적이 있는가
  let heldSpace = ''
  const citations: Citation[] = []
  const splitter = createSplitter({
    need: (t) => {
      if (need) return
      need = cleanNeed(t)
      if (need) emit({ type: 'need', text: need })
    },
    // 검색 결과를 받기 전에 쓴 글은 답이 아니다(검색으로 찾은 내용만 답으로 친다).
    text: (t) => {
      if (!searched) return
      // 앞머리 공백은 버리고, 끝의 공백·줄바꿈은 뒤에 글이 더 올 때만 내보낸다(꼬리 앞 빈 줄이 화면에 남지 않게).
      const joined = heldSpace + t
      const body = joined.trimEnd()
      heldSpace = joined.slice(body.length)
      const piece = answerText ? body : body.trimStart()
      if (!piece) {
        if (!answerText) heldSpace = ''
        return
      }
      answerText += piece
      streamed = true
      emit({ type: 'delta', text: piece })
    },
  })

  for (let turn = 0; ; turn++) {
    const stream = client.messages.stream(
      {
        model: o.model || DEFAULT_CLAUDE_MODEL,
        max_tokens: ANSWER_MAX_TOKENS,
        // Haiku 5.5는 생각이 기본으로 켜져 있다(adaptive). 깊이는 effort로만 조절한다. temperature 등은 보내면 400.
        ...(o.thinking === 'disabled' ? { thinking: { type: 'disabled' as const } } : {}),
        output_config: { effort: o.effort ?? 'low' },
        // 지시문과 도구 목록은 질문과 상관없이 같으므로 캐시한다.
        system: [{ type: 'text', text: buildAnswerSystem(), cache_control: { type: 'ephemeral' } }],
        tools: [SEARCH_TOOL],
        messages,
      },
      { signal },
    )

    const queries = new Map<number, string>() // 검색 블록 번호 → 지금까지 받은 입력 JSON
    const textBlocks = new Set<number>()
    for await (const ev of stream) {
      if (ev.type === 'content_block_start') {
        const b = ev.content_block
        if (b.type === 'text') textBlocks.add(ev.index)
        else if (b.type === 'server_tool_use') {
          queries.set(ev.index, '')
          // 답을 쓰다가 다시 검색하면 앞의 글은 버린다.
          if (streamed) {
            answerText = ''
            streamed = false
            heldSpace = ''
            citations.length = 0
            emit({ type: 'reset' })
          }
        } else if (b.type === 'web_search_tool_result') {
          // 성공이면 결과 목록(배열), 실패면 오류 객체 하나다.
          if (Array.isArray(b.content)) {
            searched = true
            const sites: { name: string; domain: string }[] = []
            for (const r of b.content) {
              const s = siteOf(r.url)
              if (s && !sites.some((x) => x.domain === s.domain)) sites.push({ name: s.name, domain: s.domain })
            }
            if (sites.length) emit({ type: 'status', phase: 'reading', sites: sites.slice(0, 3) })
          }
        }
      } else if (ev.type === 'content_block_delta') {
        const d = ev.delta
        if (d.type === 'text_delta') splitter.feed(d.text)
        else if (d.type === 'input_json_delta' && queries.has(ev.index)) queries.set(ev.index, queries.get(ev.index) + d.partial_json)
        else if (d.type === 'citations_delta' && d.citation.type === 'web_search_result_location') {
          citations.push({ url: d.citation.url, title: d.citation.title ?? '', citedText: d.citation.cited_text })
        }
      } else if (ev.type === 'content_block_stop' && textBlocks.has(ev.index)) {
        splitter.flush()
      } else if (ev.type === 'content_block_stop' && queries.has(ev.index)) {
        let query = ''
        try {
          const q = (JSON.parse(queries.get(ev.index) || '{}') as { query?: unknown }).query
          if (typeof q === 'string') query = q.slice(0, 80)
        } catch {
          // 검색어를 못 읽어도 진행 알림만 빈 채로 보낸다
        }
        queries.delete(ev.index)
        emit({ type: 'status', phase: 'searching', query })
      }
    }

    const msg = await stream.finalMessage()
    usage.input += msg.usage.input_tokens
    usage.output += msg.usage.output_tokens
    usage.cacheRead += msg.usage.cache_read_input_tokens ?? 0
    usage.cacheWrite += msg.usage.cache_creation_input_tokens ?? 0
    usage.searches += msg.usage.server_tool_use?.web_search_requests ?? 0
    if (msg.stop_reason === 'refusal') refused = true
    // 서버가 긴 턴을 잠깐 멈춘 경우: 받은 내용을 그대로 돌려보내면 이어서 한다(같은 도구 목록 유지).
    if (msg.stop_reason === 'pause_turn' && turn < MAX_TURN_RESUMES) {
      messages.push({ role: 'assistant', content: msg.content as Anthropic.ContentBlockParam[] })
      continue
    }
    break
  }

  splitter.flush()
  const final = assembleAnswer({ need, answerText, tail: splitter.tail, citations, searched, refused })
  return { final, usage }
}

// ---------- HTTP ----------
export const isAnswerPath = (p: string) => p === '/answer'

type Limiter = ReturnType<typeof createRateLimiter>
export type AnswerDeps = { now?: () => number; fetch?: typeof fetch; answerLimiter?: Limiter }

let sharedLimiter: { key: string; limiter: Limiter } | null = null
function getLimiter(env: Env): Limiter {
  const perMin = Number(env.ANSWER_PER_MINUTE) > 0 ? Number(env.ANSWER_PER_MINUTE) : DEFAULT_ANSWER_PER_MINUTE
  const perDay = Number(env.ANSWER_DAILY_LIMIT) > 0 ? Number(env.ANSWER_DAILY_LIMIT) : DEFAULT_ANSWER_DAILY_LIMIT
  const key = `${perMin}/${perDay}`
  if (!sharedLimiter || sharedLimiter.key !== key) sharedLimiter = { key, limiter: createRateLimiter(perMin, perDay) }
  return sharedLimiter.limiter
}

const cors = (origin: string) => ({ 'access-control-allow-origin': origin, vary: 'Origin', 'cache-control': 'no-store' })
const fail = (error: string, status: number, origin: string) =>
  new Response(JSON.stringify({ ok: false, error }), { status, headers: { 'content-type': 'application/json; charset=utf-8', ...cors(origin) } })

function errorReason(e: unknown): AnswerErrorReason {
  if (e instanceof Anthropic.APIConnectionTimeoutError || e instanceof Anthropic.APIUserAbortError) return 'timeout'
  if (e instanceof Error && (e.name === 'TimeoutError' || e.name === 'AbortError')) return 'timeout'
  if (e instanceof Anthropic.RateLimitError) return 'busy'
  if (e instanceof Anthropic.APIError && (e.status ?? 0) >= 500) return 'busy'
  return 'upstream'
}

function logError(e: unknown) {
  // 질문·답은 남기지 않는다. 오류 종류와 상태 번호만.
  const kind = e instanceof Anthropic.APIError ? `api_${e.status ?? 'conn'}` : e instanceof Error ? e.name : 'unknown'
  console.log(`wheelmap-ai answer error: ${kind}`)
}

// 요청 본문: { question: string, history?: { q: string, a: string }[] } (history는 직전 1~2번, 서버에 저장하지 않는다)
// 응답: 검사에서 걸리면 JSON({ ok:false, error }), 통과하면 text/event-stream(조각마다 `event: 종류` + `data: JSON`).
export async function handleAnswer(request: Request, env: Env, origin: string, deps: AnswerDeps = {}): Promise<Response> {
  if (request.method !== 'POST') return fail('method_not_allowed', 405, origin)
  if (!env.ANTHROPIC_API_KEY) return fail('not_configured', 503, origin)
  if (Number(request.headers.get('content-length') ?? '0') > ANSWER_MAX_BODY_BYTES) return fail('too_large', 413, origin)

  let text: string
  try {
    text = await request.text()
  } catch {
    return fail('bad_request', 400, origin)
  }
  if (new TextEncoder().encode(text).length > ANSWER_MAX_BODY_BYTES) return fail('too_large', 413, origin)
  let body: { question?: unknown; history?: unknown }
  try {
    body = JSON.parse(text) as { question?: unknown; history?: unknown }
  } catch {
    return fail('bad_request', 400, origin)
  }
  if (!body || typeof body.question !== 'string') return fail('bad_request', 400, origin)
  const question = sanitizeQuestion(body.question)
  if (!question) return fail('bad_request', 400, origin)
  if ([...body.question.trim()].length > MAX_QUESTION_CHARS) return fail('too_long', 400, origin)
  const history = cleanHistory(body.history, sanitizeQuestion)

  // 모델을 부르기 전에 횟수를 센다(IP별 분당, 전체 하루).
  const now = (deps.now ?? Date.now)()
  const lim = (deps.answerLimiter ?? getLimiter(env)).check(request.headers.get('cf-connecting-ip') ?? 'unknown', now)
  if (!lim.ok) return fail(lim.reason, 429, origin)

  const enc = new TextEncoder()
  const abort = new AbortController()
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (e: AnswerEvent) => {
        try {
          controller.enqueue(enc.encode(`event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`))
        } catch {
          abort.abort() // 받는 쪽이 닫았다
        }
      }
      try {
        // 뜻 없는 입력(자음·모음뿐 등)은 모델을 부르지 않는다.
        if (isNonsense(question)) {
          send({ type: 'done', ...assembleAnswer({ need: '', answerText: '', tail: '{"kind":"out_of_scope"}', citations: [], searched: false }) })
        } else {
          const run = await runAnswer({ apiKey: env.ANTHROPIC_API_KEY as string, model: env.ANTHROPIC_MODEL, question, history, fetch: deps.fetch, signal: abort.signal }, send)
          send({ type: 'done', ...run.final })
        }
      } catch (e) {
        logError(e)
        send({ type: 'error', reason: errorReason(e) })
      } finally {
        try {
          controller.close()
        } catch {
          // 이미 닫힘
        }
      }
    },
    cancel() {
      abort.abort()
    },
  })
  return new Response(stream, { status: 200, headers: { 'content-type': 'text/event-stream; charset=utf-8', ...cors(origin) } })
}
