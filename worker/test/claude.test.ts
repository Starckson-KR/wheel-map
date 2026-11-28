import test from 'node:test'
import assert from 'node:assert/strict'
import { handle } from '../src/index.ts'
import { createRateLimiter } from '../src/intents.ts'
import { CLASSIFY_SCHEMA } from '../src/claude.ts'

const ORIGIN = 'http://localhost:5173'
const deps = (fetchFn?: typeof fetch) => ({ limiter: createRateLimiter(10, 500), now: () => 1_000_000, fetch: fetchFn })

function req(question: string) {
  return new Request('https://w.example/intent', {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: ORIGIN, 'cf-connecting-ip': '1.1.1.1' },
    body: JSON.stringify({ question }),
  })
}

function makeEnv(extra: Record<string, string> = {}) {
  const calls: string[] = []
  return {
    calls,
    env: {
      AI: {
        run: (async () => {
          calls.push('workers-ai')
          return { response: '{"intent":"bus","slots":{},"confidence":0.9}' }
        }) as never,
      },
      AI_MODEL: 'test-model',
      ALLOWED_ORIGINS: ORIGIN,
      ...extra,
    },
  }
}

type Sent = { url: string; headers: Headers; body: Record<string, unknown> }
function claudeFetch(reply: (sent: Sent) => Response | Promise<Response>, calls: string[], sent: Sent[] = []) {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push('claude')
    const s: Sent = { url: String(input), headers: new Headers(init?.headers), body: JSON.parse(String(init?.body)) }
    sent.push(s)
    return reply(s)
  }) as typeof fetch
}

const message = (text: string, over: Record<string, unknown> = {}) =>
  new Response(
    JSON.stringify({
      id: 'msg_1',
      type: 'message',
      role: 'assistant',
      model: 'claude-haiku-5-5',
      content: [{ type: 'text', text }],
      stop_reason: 'end_turn',
      stop_sequence: null,
      usage: { input_tokens: 10, output_tokens: 20, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
      ...over,
    }),
    { status: 200, headers: { 'content-type': 'application/json' } },
  )

const JSON_ROUTE = '{"intent":"route","slots":{"from":"용봉동","to":"북구청"},"confidence":0.9}'

test('AI_PROVIDER가 없으면 Workers AI만 부른다(Claude는 부르지 않는다)', async () => {
  const { env, calls } = makeEnv({ ANTHROPIC_API_KEY: 'k' })
  const res = await handle(req('가까운 저상버스'), env, deps(claudeFetch(() => message(JSON_ROUTE), calls)))
  assert.equal((await res.json()).intent, 'bus')
  assert.deepEqual(calls, ['workers-ai'])
})

test('AI_PROVIDER가 anthropic이 아닌 값이면 Workers AI만 부른다', async () => {
  const { env, calls } = makeEnv({ AI_PROVIDER: 'workers', ANTHROPIC_API_KEY: 'k' })
  await handle(req('가까운 저상버스'), env, deps(claudeFetch(() => message(JSON_ROUTE), calls)))
  assert.deepEqual(calls, ['workers-ai'])
})

test('anthropic이고 키가 있으면 Claude를 부르고 Workers AI는 부르지 않는다', async () => {
  const { env, calls } = makeEnv({ AI_PROVIDER: 'anthropic', ANTHROPIC_API_KEY: 'test-key' })
  const sent: Sent[] = []
  const res = await handle(req('용봉동에서 북구청 가는 길'), env, deps(claudeFetch(() => message(JSON_ROUTE), calls, sent)))
  const b = await res.json()
  assert.equal(b.intent, 'route')
  assert.deepEqual(b.slots, { from: '용봉동', to: '북구청' })
  assert.equal(b.fallback, false)
  assert.deepEqual(calls, ['claude'])
  // 요청 모양: 기본 모델, 생각 끔, 구조화 출력, 지시문 캐시, 표본 파라미터 없음
  const body = sent[0].body
  assert.match(sent[0].url, /\/v1\/messages$/)
  assert.equal(body.model, 'claude-haiku-5-5')
  assert.deepEqual(body.thinking, { type: 'disabled' })
  const oc = body.output_config as { effort: string; format: { type: string; schema: unknown } }
  assert.equal(oc.effort, 'low')
  assert.equal(oc.format.type, 'json_schema')
  assert.deepEqual(oc.format.schema, JSON.parse(JSON.stringify(CLASSIFY_SCHEMA)))
  for (const k of ['temperature', 'top_p', 'top_k']) assert.ok(!(k in body), k)
  const sys = body.system as { cache_control?: { type: string }; text: string }[]
  assert.equal(sys[0].cache_control?.type, 'ephemeral')
  assert.ok(sys[0].text.includes('질문 분류기'))
  assert.deepEqual(body.messages, [{ role: 'user', content: '용봉동에서 북구청 가는 길' }])
})

test('ANTHROPIC_MODEL로 모델을 바꿀 수 있다', async () => {
  const { env, calls } = makeEnv({ AI_PROVIDER: 'anthropic', ANTHROPIC_API_KEY: 'k', ANTHROPIC_MODEL: 'claude-sonnet-5-5' })
  const sent: Sent[] = []
  await handle(req('가까운 저상버스'), env, deps(claudeFetch(() => message(JSON_ROUTE), calls, sent)))
  assert.equal(sent[0].body.model, 'claude-sonnet-5-5')
})

test('anthropic인데 키가 없으면 Workers AI로 간다(Claude 호출 없음)', async () => {
  const { env, calls } = makeEnv({ AI_PROVIDER: 'anthropic' })
  const res = await handle(req('가까운 저상버스'), env, deps(claudeFetch(() => message(JSON_ROUTE), calls)))
  assert.equal((await res.json()).intent, 'bus')
  assert.deepEqual(calls, ['workers-ai'])
})

test('Claude 호출이 실패(500)하면 Workers AI로 넘어간다', async () => {
  const { env, calls } = makeEnv({ AI_PROVIDER: 'anthropic', ANTHROPIC_API_KEY: 'k' })
  const res = await handle(req('가까운 저상버스'), env, deps(claudeFetch(() => new Response('{"type":"error","error":{"type":"api_error","message":"boom"}}', { status: 500 }), calls)))
  const b = await res.json()
  assert.equal(b.intent, 'bus')
  assert.equal(b.fallback, false)
  assert.deepEqual(calls, ['claude', 'workers-ai'])
})

test('stop_reason이 refusal·max_tokens이면 Workers AI로 넘어간다', async () => {
  for (const stop of ['refusal', 'max_tokens']) {
    const { env, calls } = makeEnv({ AI_PROVIDER: 'anthropic', ANTHROPIC_API_KEY: 'k' })
    const res = await handle(req('가까운 저상버스'), env, deps(claudeFetch(() => message(JSON_ROUTE, { stop_reason: stop }), calls)))
    assert.equal((await res.json()).intent, 'bus', stop)
    assert.deepEqual(calls, ['claude', 'workers-ai'], stop)
  }
})

test('Claude가 느려 시간이 다 되면 기다리지 않고 지금의 model_error 안내가 나간다', async () => {
  const { env, calls } = makeEnv({ AI_PROVIDER: 'anthropic', ANTHROPIC_API_KEY: 'k' })
  const never = (async (_i: RequestInfo | URL, init?: RequestInit) => {
    calls.push('claude')
    return new Promise<Response>((_res, rej) => init?.signal?.addEventListener('abort', () => rej(new Error('aborted'))))
  }) as typeof fetch
  const t0 = Date.now()
  const res = await handle(req('가까운 저상버스'), env, deps(never))
  const b = await res.json()
  assert.ok(Date.now() - t0 < 8000)
  // 6초를 모두 쓰고 나면 남은 시간이 없어 Workers AI로 가지 않고 기존 안내가 나간다
  assert.equal(b.fallback, true)
  assert.equal(b.reason, 'model_error')
  assert.deepEqual(calls, ['claude'])
})

test('잘못된 JSON이면 다시 한 번 Claude를 부르고, 그래도 깨지면 bad_output 안내', async () => {
  const { env, calls } = makeEnv({ AI_PROVIDER: 'anthropic', ANTHROPIC_API_KEY: 'k' })
  const res = await handle(req('가까운 저상버스'), env, deps(claudeFetch(() => message('죄송합니다, JSON이 아닙니다'), calls)))
  const b = await res.json()
  assert.equal(b.fallback, true)
  assert.equal(b.reason, 'bad_output')
  assert.deepEqual(calls, ['claude', 'claude'])
})

test('첫 답이 깨지고 두 번째가 맞으면 정상 결과', async () => {
  const { env, calls } = makeEnv({ AI_PROVIDER: 'anthropic', ANTHROPIC_API_KEY: 'k' })
  let n = 0
  const res = await handle(req('용봉동에서 북구청 가는 길'), env, deps(claudeFetch(() => message(++n === 1 ? '잠시만요, 분류하겠습니다' : JSON_ROUTE), calls)))
  const b = await res.json()
  assert.equal(b.intent, 'route')
  assert.equal(b.retried, true)
  assert.deepEqual(calls, ['claude', 'claude'])
})

test('Claude가 목록 밖 의도를 내도 스키마 검증이 unknown으로 바꾼다', async () => {
  const { env } = makeEnv({ AI_PROVIDER: 'anthropic', ANTHROPIC_API_KEY: 'k' })
  const res = await handle(req('x 질문'), env, deps(claudeFetch(() => message('{"intent":"open_admin","slots":{},"confidence":0.99}'), [])))
  const b = await res.json()
  assert.equal(b.ok, true)
  assert.equal(b.intent, 'unknown')
})
