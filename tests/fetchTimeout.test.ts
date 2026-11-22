import test from 'node:test'
import assert from 'node:assert/strict'
import { fetchWithTimeout } from '../src/lib/fetchTimeout.ts'

test('시간이 지나면 끊고 예외를 던진다(호출하는 쪽 catch가 네트워크 실패로 처리)', async () => {
  const orig = globalThis.fetch
  globalThis.fetch = ((_u: unknown, init?: RequestInit) =>
    new Promise((_res, rej) => init?.signal?.addEventListener('abort', () => rej(new DOMException('aborted', 'AbortError'))))) as typeof fetch
  try {
    await assert.rejects(fetchWithTimeout('http://x.test/', {}, 20), { name: 'AbortError' })
  } finally {
    globalThis.fetch = orig
  }
})

test('제한 안에 오면 응답을 그대로 돌려준다', async () => {
  const orig = globalThis.fetch
  globalThis.fetch = (async () => new Response('ok')) as typeof fetch
  try {
    const r = await fetchWithTimeout('http://x.test/', {}, 1000)
    assert.equal(await r.text(), 'ok')
  } finally {
    globalThis.fetch = orig
  }
})

test('바깥 signal이 끊기면 같이 끊긴다', async () => {
  const orig = globalThis.fetch
  globalThis.fetch = ((_u: unknown, init?: RequestInit) =>
    new Promise((_res, rej) => init?.signal?.addEventListener('abort', () => rej(new DOMException('aborted', 'AbortError'))))) as typeof fetch
  try {
    const c = new AbortController()
    const p = fetchWithTimeout('http://x.test/', { signal: c.signal }, 5000)
    c.abort()
    await assert.rejects(p, { name: 'AbortError' })
  } finally {
    globalThis.fetch = orig
  }
})
