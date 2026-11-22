import { guardIntent, isBlockedQuestion, keywordIntent, keywordSlots, candidatesFor } from './keywords'
import type { AiIntent, MovableIntent, Slots } from './intents'
import { cleanQuestion, verifyResponse } from './validate'

export const AI_TIMEOUT_MS = 6500 // 모델 답이 가끔 5초 넘게 걸린다(Worker는 6초에 포기하고 알려 준다). 첫 시도와 다시 시도를 합친 제한
const RETRY_WAIT_MS = 400
const RETRY_MIN_LEFT_MS = 2500 // 남은 시간이 이보다 적으면 다시 시도하지 않는다
const CACHE_MS = 5 * 60_000
const CACHE_MAX = 40

// source: 어떻게 정했는가. reason: 키워드로 넘어간 까닭(화면의 작은 안내에 쓴다).
export type FallbackReason = 'off' | 'offline' | 'timeout' | 'limit' | 'error' | 'blocked'
export type Understood = {
  intent: AiIntent
  slots: Slots
  source: 'ai' | 'keyword'
  reason?: FallbackReason
  candidates: MovableIntent[] // 모름일 때 보여 줄 후보
  question: string // 마스킹한 질문
}

type Options = { url: string; enabled: boolean; token?: string; fetchImpl?: typeof fetch; timeoutMs?: number; now?: () => number }

type Cached = { at: number; value: Understood }
const cache = new Map<string, Cached>()
const inflight = new Map<string, Promise<Understood>>()
export function clearAiCache() {
  cache.clear()
  inflight.clear()
}

function byKeyword(question: string, reason: FallbackReason): Understood {
  const k = keywordIntent(question)
  return { intent: k.intent, slots: keywordSlots(question, k.intent), source: 'keyword', reason, candidates: candidatesFor(question), question }
}

async function callWorker(question: string, o: Options): Promise<Understood> {
  const f = o.fetchImpl ?? fetch
  const ctl = new AbortController()
  let timedOut = false
  const timer = setTimeout(() => {
    timedOut = true
    ctl.abort()
  }, o.timeoutMs ?? AI_TIMEOUT_MS)
  const started = Date.now()
  const total = o.timeoutMs ?? AI_TIMEOUT_MS
  try {
    let res: Response
    let body: unknown = null
    // 일시적인 오류(네트워크 끊김·모델 오류·깨진 답)는 시간이 남으면 한 번만 다시 시도한다. 한도(429)·시간 초과는 다시 하지 않는다.
    for (let attempt = 0; ; attempt++) {
      let retryable = false
      try {
        res = await f(o.url, {
          method: 'POST',
          headers: o.token ? { 'Content-Type': 'application/json', Authorization: `Bearer ${o.token}` } : { 'Content-Type': 'application/json' }, // 로그인한 경우에만 토큰을 붙인다(개발자 계정의 사용 한도 면제용)
          body: JSON.stringify({ question }),
          signal: ctl.signal,
        })
      } catch (e) {
        if (timedOut || attempt >= 1 || Date.now() - started > total - RETRY_MIN_LEFT_MS) throw e
        await new Promise((r) => setTimeout(r, RETRY_WAIT_MS))
        continue
      }
      if (res.status === 429) return byKeyword(question, 'limit')
      try {
        body = await res.json()
      } catch {
        body = null
      }
      const b = body as { ok?: unknown; fallback?: unknown } | null
      retryable = !b || (b.ok !== true && b.fallback === true) || res.status >= 500
      if (!retryable || attempt >= 1 || Date.now() - started > total - RETRY_MIN_LEFT_MS) break
      await new Promise((r) => setTimeout(r, RETRY_WAIT_MS))
    }
    const v = verifyResponse(body, question)
    if (!v) return byKeyword(question, 'error')
    let intent = guardIntent(question, v.intent)
    // 아직 날씨를 모르는 옛 Worker가 unknown으로 답해도, 날씨를 묻는 말이면 날씨 카드로 답한다
    if (intent === 'unknown' && keywordIntent(question).intent === 'weather') intent = 'weather'
    // AI가 빈칸을 못 채웠거나 검증에서 버려진 경우에만 키워드 규칙(같은 검증)으로 보충한다
    const slots = intent === v.intent ? { ...keywordSlots(question, intent), ...v.slots } : {}
    return { intent, slots, source: 'ai', candidates: candidatesFor(question), question }
  } catch {
    const offline = typeof navigator !== 'undefined' && navigator.onLine === false
    return byKeyword(question, timedOut ? 'timeout' : offline ? 'offline' : 'error')
  } finally {
    clearTimeout(timer)
  }
}

// 질문을 이해한다. 항상 값을 돌려주고 던지지 않는다(실패하면 키워드 결과).
export async function understand(raw: string, o: Options): Promise<Understood> {
  const question = cleanQuestion(raw)
  if (!question) return byKeyword('', 'blocked')
  if (isBlockedQuestion(question)) return byKeyword(question, 'blocked') // 지시 변경·내부 탐색·뜻 없는 입력은 AI를 부르지 않는다
  if (!o.enabled) return byKeyword(question, 'off')
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return byKeyword(question, 'offline')

  const now = (o.now ?? Date.now)()
  const hit = cache.get(question)
  if (hit && now - hit.at < CACHE_MS) return hit.value
  const pending = inflight.get(question)
  if (pending) return pending

  const p = callWorker(question, o).then((value) => {
    if (value.source === 'ai') {
      if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value as string)
      cache.set(question, { at: now, value })
    }
    return value
  })
  inflight.set(question, p)
  try {
    return await p
  } finally {
    inflight.delete(question)
  }
}
