import { DatabaseSync } from 'node:sqlite'
import { readdirSync, readFileSync } from 'node:fs'
import type { D1Db, D1Statement } from '../src/types'

// node:sqlite(SQLite)로 만든 가짜 D1. 실제 마이그레이션 SQL을 그대로 적용해 쿼리까지 함께 시험한다.
export function fakeD1(): D1Db & { raw: DatabaseSync } {
  const raw = new DatabaseSync(':memory:')
  const dir = new URL('../migrations/', import.meta.url)
  for (const f of readdirSync(dir).filter((n) => n.endsWith('.sql')).sort()) raw.exec(readFileSync(new URL(f, dir), 'utf8'))
  const make = (sql: string, values: unknown[] = []): D1Statement => ({
    bind: (...v: unknown[]) => make(sql, v),
    first: async <T>() => ((raw.prepare(sql).get(...(values as never[])) as T | undefined) ?? null) as T | null,
    all: async <T>() => ({ results: raw.prepare(sql).all(...(values as never[])) as T[] }),
    run: async () => {
      const r = raw.prepare(sql).run(...(values as never[]))
      return { meta: { changes: Number(r.changes) } }
    },
  })
  return { raw, prepare: (sql: string) => make(sql), batch: async () => [] }
}
