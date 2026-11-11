import { guardIntent, isBlockedQuestion, keywordIntent, candidatesFor } from './keywords'
import type { AiIntent, MovableIntent, Slots } from './intents'
import { cleanQuestion, verifyResponse } from './validate'

export const AI_TIMEOUT_MS = 4000
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

type Options = { url: string; enabled: boolean; fetchImpl?: typeof fetch; timeoutMs?: number; now?: () => number }

type Cached = { at: number; value: Understood }
const cache = new Map<string, Cached>()
const inflight = new Map<string, Promise<Understood>>()
export function clearAiCache() {
  cache.clear()
  inflight.clear()
}

function byKeyword(question: string, reason: FallbackReason): Understood {
  const k = keywordIntent(question)
  return { intent: k.intent, slots: {}, source: 'keyword', reason, candidates: candidatesFor(question), question }
}

async function callWorker(question: string, o: Options): Promise<Understood> {
  const f = o.fetchImpl ?? fetch
  const ctl = new AbortController()
  let timedOut = false
  const timer = setTimeout(() => {
    timedOut = true
    ctl.abort()
  }, o.timeoutMs ?? AI_TIMEOUT_MS)
  try {
    const res = await f(o.url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ question }),
      signal: ctl.signal,
    })
    if (res.status === 429) return byKeyword(question, 'limit')
    let body: unknown = null
    try {
      body = await res.json()
    } catch {
      return byKeyword(question, 'error')
    }
    const v = verifyResponse(body, question)
    if (!v) return byKeyword(question, 'error')
    const intent = guardIntent(question, v.intent)
    return { intent, slots: intent === v.intent ? v.slots : {}, source: 'ai', candidates: candidatesFor(question), question }
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
