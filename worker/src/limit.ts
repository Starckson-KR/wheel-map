import { sha256Hex } from './auth.ts'
import { getThrottle, putThrottle } from './account.ts'
import type { D1Db } from './types'

// IP별 분당 제한: 기존 throttle 표를 1분 창으로 쓴다(키는 범위 이름+IP의 해시, IP 원문은 저장하지 않는다).
export async function windowAllowed(db: D1Db, scope: string, ip: string, now: number, limit: number): Promise<boolean> {
  const k = await sha256Hex(`${scope}|${ip}`)
  const t = await getThrottle(db, k)
  if (t && now >= t.windowStart && now - t.windowStart < 60_000) {
    if (t.fails >= limit) return false
    await putThrottle(db, k, { fails: t.fails + 1, windowStart: t.windowStart, lockedUntil: 0 })
    return true
  }
  await putThrottle(db, k, { fails: 1, windowStart: now, lockedUntil: 0 })
  return true
}
