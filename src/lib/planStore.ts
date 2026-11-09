import { create } from 'zustand'

// 개선계획·예산 연결 기록. 서버가 없으므로 localStorage에 둔다. 금액·사업명은 담당자가 직접 입력하며 앱이 정하지 않는다.
const KEY = 'wheelmap.plan.v1'

export const STAGES = ['미반영', '검토', '계획 반영', '집행'] as const
export type Stage = (typeof STAGES)[number]

export type PlanEntry = {
  stage: Stage
  program: string // 연결 사업(자유 입력)
  budgetItem: string // 세부 예산 항목(자유 입력)
  amount: number | null // 원 단위
  year: number | null // 반영 연도
  memo: string
  updatedAt: string
}

export const EMPTY_ENTRY: PlanEntry = { stage: '미반영', program: '', budgetItem: '', amount: null, year: null, memo: '', updatedAt: '' }

type Entries = Record<string, PlanEntry>

function sanitize(v: unknown): PlanEntry | null {
  if (!v || typeof v !== 'object') return null
  const o = v as Partial<PlanEntry>
  const num = (x: unknown) => (typeof x === 'number' && Number.isFinite(x) ? x : null)
  return {
    stage: STAGES.includes(o.stage as Stage) ? (o.stage as Stage) : '미반영',
    program: typeof o.program === 'string' ? o.program : '',
    budgetItem: typeof o.budgetItem === 'string' ? o.budgetItem : '',
    amount: num(o.amount),
    year: num(o.year),
    memo: typeof o.memo === 'string' ? o.memo : '',
    updatedAt: typeof o.updatedAt === 'string' ? o.updatedAt : '',
  }
}

function load(): { entries: Entries; error: string | null } {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return { entries: {}, error: null }
    const v: unknown = JSON.parse(raw)
    if (!v || typeof v !== 'object' || Array.isArray(v)) throw new Error('형식 오류')
    const entries: Entries = {}
    for (const [k, e] of Object.entries(v)) {
      const s = sanitize(e)
      if (s) entries[k] = s
    }
    return { entries, error: null }
  } catch {
    return { entries: {}, error: '저장된 개선계획 기록을 불러오지 못했어요. 브라우저 저장소 설정을 확인해 주세요.' }
  }
}

const isBlank = (e: PlanEntry) => e.stage === '미반영' && !e.program && !e.budgetItem && e.amount === null && e.year === null && !e.memo

type State = {
  entries: Entries
  storageError: string | null
  patch: (key: string, p: Partial<Omit<PlanEntry, 'updatedAt'>>) => void
  setStageMany: (keys: string[], stage: Stage) => void
  reset: () => void
}

const initial = load()

export const usePlan = create<State>((set) => {
  const apply = (entries: Entries, key: string, p: Partial<Omit<PlanEntry, 'updatedAt'>>) => {
    const next = { ...(entries[key] ?? EMPTY_ENTRY), ...p, updatedAt: new Date().toISOString() }
    const out = { ...entries }
    if (isBlank(next)) delete out[key]
    else out[key] = next
    return out
  }
  return {
    entries: initial.entries,
    storageError: initial.error,
    patch: (key, p) => set((s) => ({ entries: apply(s.entries, key, p) })),
    setStageMany: (keys, stage) =>
      set((s) => {
        let entries = s.entries
        for (const k of keys) entries = apply(entries, k, { stage })
        return { entries }
      }),
    reset: () => {
      try {
        localStorage.removeItem(KEY)
      } catch {
        /* 저장소를 못 써도 화면 상태는 비운다 */
      }
      set({ entries: {}, storageError: null })
    },
  }
})

export const entryOf = (entries: Entries, key: string): PlanEntry => entries[key] ?? EMPTY_ENTRY

const SAVE_ERR = '개선계획 기록을 저장하지 못했어요. 브라우저 저장소가 막혀 있거나 가득 찼을 수 있어요. 새로고침하면 입력한 내용이 사라져요.'
let lastSaved = ''
usePlan.subscribe((s) => {
  try {
    const json = JSON.stringify(s.entries)
    if (json !== lastSaved) {
      if (Object.keys(s.entries).length === 0) localStorage.removeItem(KEY)
      else localStorage.setItem(KEY, json)
      lastSaved = json
    }
    if (s.storageError === SAVE_ERR) usePlan.setState({ storageError: null })
  } catch {
    if (s.storageError !== SAVE_ERR) usePlan.setState({ storageError: SAVE_ERR })
  }
})
