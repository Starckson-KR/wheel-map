import { reply, fail } from './account.ts'
import type { D1Db, Env } from './types'

// 발표용 「크리스마스 모드」: 개발자가 켜면 앱을 연 모든 기기가 바뀐다.
//  - GET  /xmas        : 누구나(허용 출처만) 지금 값 {on, at}을 읽는다. 개인 자료가 없다.
//  - POST /admin/xmas  : 개발자만 켜고 끈다(admin.ts에서 권한 확인 뒤 setXmas를 부른다). 바꾸면 허브로 {"t":"xmas"} 신호를 보낸다.
// at은 마지막으로 바꾼 시각이다. 앱은 at이 달라졌을 때만 새로 고친다.
export type XmasFlag = { on: boolean; at: number }
export const XMAS_OFF: XmasFlag = { on: false, at: 0 }
export const isXmasPath = (p: string) => p === '/xmas'

/** 저장된 줄을 값으로 바꾼다(순수 함수). 줄이 없거나 모양이 다르면 꺼짐. */
export function flagOf(row: { value?: unknown; at?: unknown } | null | undefined): XmasFlag {
  if (!row || typeof row.at !== 'number' || !Number.isFinite(row.at) || row.at <= 0) return XMAS_OFF
  return { on: row.value === 'on', at: row.at }
}

export async function readXmas(db: D1Db): Promise<XmasFlag> {
  try {
    return flagOf(await db.prepare("SELECT value, updated_at AS at FROM app_flags WHERE key = 'xmas'").first<{ value: string; at: number }>())
  } catch {
    return XMAS_OFF // 표가 아직 없으면(마이그레이션 전) 꺼짐
  }
}

/** 켜거나 끈다. 같은 값으로 다시 눌러도 at이 새로 찍혀 모든 기기가 한 번 더 새로 고쳐진다. */
export async function setXmas(db: D1Db, on: boolean, now: number): Promise<XmasFlag> {
  await db
    .prepare("INSERT INTO app_flags(key, value, updated_at) VALUES('xmas', ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at")
    .bind(on ? 'on' : 'off', now)
    .run()
  return { on, at: now }
}

export async function handleXmas(request: Request, env: Env, origin: string): Promise<Response> {
  if (request.method !== 'GET') return fail(405, 'method_not_allowed', '허용되지 않는 요청이에요.', origin)
  const f = env.DB ? await readXmas(env.DB) : XMAS_OFF
  return reply({ ok: true, on: f.on, at: f.at }, 200, origin)
}
