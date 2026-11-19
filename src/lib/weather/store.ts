import { useEffect, useSyncExternalStore } from 'react'
import { ACCOUNT_URL } from '../config'
import { DEMO_VALUES, isDemoWeather, parseWeather } from './model'
import type { DemoWeather, WeatherNow } from './model'

// 날씨 공급자(앱 쪽): 화면은 이 모듈의 useWeather()만 쓴다. 공급자를 바꾸려면 relayUrl과 parseWeather만 맞추면 된다.
//  - 개발 서버(npm run dev): vite 중계(/__weather)가 기상청을 부른다(키는 .env에서 서버가 읽는다).
//  - 배포: Cloudflare Worker의 /weather(10분 캐시). 키는 Worker secret.
// 실패하거나 응답이 이상하면 null → 화면은 날씨 줄을 조용히 숨긴다(오류 문구 없음).
const relayUrl: string = import.meta.env?.DEV ? '/wheel-map/__weather' : `${ACCOUNT_URL}/weather`
const FRESH_MS = 10 * 60_000
const FAIL_RETRY_MS = 2 * 60_000
const TIMEOUT_MS = 6000
const DEMO_KEY = 'wheelmap.weatherDemo'

type State = { real: WeatherNow | null; at: number; ok: boolean; demo: DemoWeather }

const readDemo = (): DemoWeather => {
  try {
    const v = localStorage.getItem(DEMO_KEY)
    return isDemoWeather(v) ? v : 'real'
  } catch {
    return 'real'
  }
}

let state: State = { real: null, at: 0, ok: false, demo: readDemo() }
let inflight: Promise<void> | null = null
const subs = new Set<() => void>()
const set = (p: Partial<State>) => {
  state = { ...state, ...p }
  subs.forEach((f) => f())
}

export function setDemoWeather(d: DemoWeather) {
  try {
    if (d === 'real') localStorage.removeItem(DEMO_KEY)
    else localStorage.setItem(DEMO_KEY, d)
  } catch {
    /* 저장하지 못해도 이번에는 바뀐다 */
  }
  set({ demo: d })
}
export const getDemoWeather = () => state.demo

export async function loadWeather(force = false): Promise<void> {
  const age = Date.now() - state.at
  if (!force && state.at && age < (state.ok ? FRESH_MS : FAIL_RETRY_MS)) return
  if (inflight) return inflight
  inflight = (async () => {
    const ctl = new AbortController()
    const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS)
    try {
      const r = await fetch(relayUrl, { signal: ctl.signal })
      const w = r.ok ? parseWeather(await r.json()) : null
      set({ real: w, at: Date.now(), ok: !!w })
    } catch {
      set({ real: null, at: Date.now(), ok: false })
    } finally {
      clearTimeout(timer)
      inflight = null
    }
  })()
  return inflight
}

const subscribe = (f: () => void) => {
  subs.add(f)
  return () => void subs.delete(f)
}

/** 지금 보여 줄 날씨. 시연 값이 켜져 있으면 그것, 아니면 실제 값. 없으면 null(줄을 숨긴다). */
export function useWeather(): WeatherNow | null {
  const s = useSyncExternalStore(subscribe, () => state)
  useEffect(() => {
    void loadWeather()
  }, [])
  return s.demo !== 'real' ? DEMO_VALUES[s.demo] : s.real
}

export function useDemoWeather(): DemoWeather {
  return useSyncExternalStore(subscribe, () => state.demo)
}
