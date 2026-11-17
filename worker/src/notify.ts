import type { Signal } from './hub.ts'
import type { Env } from './types'

// 허브(Durable Object) 위치: 사용자가 광주(한국)이고 D1도 APAC이라 Asia-Pacific 힌트를 준다(허브를 처음 만들 때만 적용되는 best effort).
const HUB_NAME = 'main'
const HUB_HINT = 'apac'

export function hubStub(env: Env) {
  if (!env.HUB) return null
  return env.HUB.get(env.HUB.idFromName(HUB_NAME), { locationHint: HUB_HINT })
}

export type NotifyDeps = { waitUntil?: (p: Promise<unknown>) => void }

/** 「바뀌었다」 신호 보내기. userId가 있으면 그 계정의 연결에만. 절대 던지지 않는다. waitUntil이 있으면 응답을 기다리지 않는다. */
export async function notify(env: Env, deps: NotifyDeps, signal: Signal, userId?: string): Promise<void> {
  const stub = hubStub(env)
  if (!stub) return
  const p = (async () => {
    try {
      await stub.fetch('https://hub/publish', { method: 'POST', body: JSON.stringify({ t: signal, ...(userId ? { user: userId } : {}) }) })
    } catch {
      console.log('wheelmap-ai error: rt_publish') // 오류 종류만 남긴다
    }
  })()
  if (deps.waitUntil) deps.waitUntil(p)
  else await p
}
