// 크리스마스 모드의 소리: 외부 음원 없이 Web Audio로 직접 합성한 종소리.
// 곡은 「징글벨」(James Lord Pierpont, 1857년 발표 — 저작권 보호 기간이 끝난 공유 저작물) 후렴 한 번이다. 되풀이하지 않는다.
// 브라우저는 사용자가 화면을 누르기 전에는 소리를 막으므로, 반드시 누르는 순간(unlock)에 시작한다.
// 소리 끄기는 이 기기에 기억한다. 움직임 줄이기·미지원·차단이면 조용히 아무 것도 하지 않는다. 화면이 숨겨지면 멈춘다.
import { prefersCalm } from './viewPrefs'

export const XMAS_MUTE_KEY = 'wheelmap.xmasMute' // 'on'이면 소리 끔

// ───── 악보(순수 자료·함수) ─────
export type Note = [name: string, beats: number]
const A = (n: Note[]) => n
const BAR12 = A([['E5', 1], ['E5', 1], ['E5', 2], ['E5', 1], ['E5', 1], ['E5', 2]])
const BAR34 = A([['E5', 1], ['G5', 1], ['C5', 1.5], ['D5', 0.5], ['E5', 4]])
const BAR56 = A([['F5', 1], ['F5', 1], ['F5', 1.5], ['F5', 0.5], ['F5', 1], ['E5', 1], ['E5', 1], ['E5', 0.5], ['E5', 0.5]])
/** 징글벨 후렴(다장조, 4/4, 16마디 = 64박) */
export const JINGLE: Note[] = [
  ...BAR12, ...BAR34, ...BAR56, ['E5', 1], ['D5', 1], ['D5', 1], ['E5', 1], ['D5', 2], ['G5', 2],
  ...BAR12, ...BAR34, ...BAR56, ['G5', 1], ['G5', 1], ['F5', 1], ['D5', 1], ['C5', 4],
]
/** 마디마다 낮은 음(1·3박) */
export const JINGLE_BASS = ['C3', 'C3', 'C3', 'C3', 'F3', 'C3', 'D3', 'G3', 'C3', 'C3', 'C3', 'C3', 'F3', 'C3', 'G3', 'C3']
export const JINGLE_BPM = 196
/** 누를 때마다 차례로 나는 종소리 음(5음 음계라 어떤 순서로 눌러도 어울린다) */
export const DING_SCALE = ['C5', 'D5', 'E5', 'G5', 'A5', 'C6', 'A5', 'G5', 'E5', 'D5']

const SEMI: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 }
/** 음 이름(C5, F#4)을 주파수(Hz)로. 모르는 이름은 0. */
export function noteFreq(name: string): number {
  const m = /^([A-G])(#?)(\d)$/.exec(name)
  if (!m) return 0
  const midi = 12 * (Number(m[3]) + 1) + SEMI[m[1]] + (m[2] ? 1 : 0)
  return 440 * 2 ** ((midi - 69) / 12)
}
export type Timed = { t: number; dur: number; freq: number }
/** 악보를 시작 시각(초)·길이·주파수 목록으로 바꾼다. */
export function schedule(notes: Note[], bpm: number): Timed[] {
  const beat = 60 / bpm
  let t = 0
  return notes.map(([name, beats]) => {
    const n = { t, dur: beats * beat, freq: noteFreq(name) }
    t += beats * beat
    return n
  })
}
export const songSeconds = (notes: Note[] = JINGLE, bpm = JINGLE_BPM) => notes.reduce((s, n) => s + n[1], 0) * (60 / bpm)

// ───── 상태(구독용) ─────
export type SoundState = { muted: boolean; playing: boolean }
let muted = (() => {
  try {
    return localStorage.getItem(XMAS_MUTE_KEY) === 'on'
  } catch {
    return false
  }
})()
let playing = false
let snap: SoundState = { muted, playing }
const subs = new Set<() => void>()
const emit = () => {
  snap = { muted, playing }
  subs.forEach((f) => f())
}
export const soundSnapshot = () => snap
export function subscribeSound(fn: () => void): () => void {
  subs.add(fn)
  return () => void subs.delete(fn)
}

// ───── 소리 내기 ─────
type Ctx = AudioContext
let ctx: Ctx | null = null
let songGain: GainNode | null = null
let songNodes: AudioScheduledSourceNode[] = []
let endTimer: ReturnType<typeof setTimeout> | undefined
let autoDone = false
let dingAt = 0
let watching = false

const quiet = () => muted || prefersCalm()

/** 누르는 순간에 부른다: 소리 장치를 만들고(또는 깨우고) 쓸 수 있으면 돌려준다. */
function unlock(): Ctx | null {
  try {
    if (!ctx) {
      const C = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
      if (!C) return null
      ctx = new C()
    }
    if (ctx.state === 'suspended' && !document.hidden) void ctx.resume().catch(() => undefined)
    if (!watching) {
      watching = true
      // 화면이 숨겨지면(탭 전환·화면 꺼짐) 멈추고, 돌아오면 이어서 낸다
      document.addEventListener('visibilitychange', () => {
        if (!ctx) return
        if (document.hidden) void ctx.suspend().catch(() => undefined)
        else if (playing) void ctx.resume().catch(() => undefined)
      })
    }
    return ctx
  } catch {
    return null
  }
}

// 종소리 한 음: 기본음 + 배음 둘, 빠르게 울리고 길게 사그라든다
function bell(c: Ctx, out: AudioNode, freq: number, at: number, dur: number, vol: number, keep?: AudioScheduledSourceNode[]) {
  if (!freq) return
  const g = c.createGain()
  const len = Math.max(0.5, Math.min(1.8, dur * 1.6 + 0.35))
  g.gain.setValueAtTime(0.0001, at)
  g.gain.exponentialRampToValueAtTime(vol, at + 0.008)
  g.gain.exponentialRampToValueAtTime(0.0001, at + len)
  g.connect(out)
  for (const [mul, type, amp] of [[1, 'sine', 1], [2, 'sine', 0.32], [3.01, 'sine', 0.12], [4.2, 'triangle', 0.05]] as const) {
    const o = c.createOscillator()
    const og = c.createGain()
    o.type = type
    o.frequency.value = freq * mul
    og.gain.value = amp
    o.connect(og)
    og.connect(g)
    o.start(at)
    o.stop(at + len + 0.05)
    keep?.push(o)
  }
}

function clearSong() {
  clearTimeout(endTimer)
  endTimer = undefined
  const g = songGain
  const nodes = songNodes
  songGain = null
  songNodes = []
  if (g && ctx) {
    try {
      g.gain.cancelScheduledValues(ctx.currentTime)
      g.gain.setTargetAtTime(0, ctx.currentTime, 0.04)
    } catch {
      /* 무시 */
    }
    setTimeout(() => {
      for (const n of nodes) {
        try {
          n.stop()
        } catch {
          /* 이미 끝남 */
        }
      }
      try {
        g.disconnect()
      } catch {
        /* 무시 */
      }
    }, 300)
  }
}

/** 곡을 한 번 연주한다(누르는 순간에만 부른다). 이미 연주 중이면 그대로 둔다. */
export function playSong(): void {
  if (quiet() || playing) return
  const c = unlock()
  if (!c) return
  try {
    const out = c.createGain()
    out.gain.value = 0.5
    out.connect(c.destination)
    const nodes: AudioScheduledSourceNode[] = []
    const t0 = c.currentTime + 0.08
    const beat = 60 / JINGLE_BPM
    for (const n of schedule(JINGLE, JINGLE_BPM)) bell(c, out, n.freq, t0 + n.t, n.dur, 0.36, nodes)
    JINGLE_BASS.forEach((name, bar) => {
      for (const b of [0, 2]) bell(c, out, noteFreq(name), t0 + (bar * 4 + b) * beat, 2 * beat, 0.3, nodes)
    })
    // 썰매 방울: 박마다 아주 짧은 높은 소리
    const total = songSeconds()
    for (let i = 0; i < Math.round(total / beat); i++) {
      const at = t0 + i * beat
      const o = c.createOscillator()
      const g = c.createGain()
      o.type = 'square'
      o.frequency.value = i % 2 ? 6300 : 5400
      g.gain.setValueAtTime(0.0001, at)
      g.gain.exponentialRampToValueAtTime(i % 2 ? 0.012 : 0.02, at + 0.004)
      g.gain.exponentialRampToValueAtTime(0.0001, at + 0.07)
      o.connect(g)
      g.connect(out)
      o.start(at)
      o.stop(at + 0.09)
      nodes.push(o)
    }
    songGain = out
    songNodes = nodes
    playing = true
    emit()
    endTimer = setTimeout(() => {
      clearSong()
      playing = false
      emit()
    }, (total + 1.6) * 1000)
  } catch {
    /* 소리를 못 내도 연출은 그대로 */
  }
}
export function stopSong(): void {
  clearSong()
  if (playing) {
    playing = false
    emit()
  }
}
/** 처음 누를 때 한 번만 곡을 시작한다(그 뒤에 다시 듣는 것은 소리 버튼으로). */
export function autoSong(): void {
  if (autoDone) return
  autoDone = true
  playSong()
}

/** 누를 때 나는 종소리 한 음(음계를 차례로). */
export function ding(vol = 0.22): void {
  if (quiet()) return
  const c = unlock()
  if (!c) return
  try {
    bell(c, c.destination, noteFreq(DING_SCALE[dingAt++ % DING_SCALE.length]) * (playing ? 2 : 1), c.currentTime + 0.005, 0.5, playing ? vol * 0.5 : vol)
  } catch {
    /* 무시 */
  }
}
/** 선물 상자·별: 위로 올라가는 화음 */
export function fanfare(): void {
  if (quiet()) return
  const c = unlock()
  if (!c) return
  try {
    ;['C5', 'E5', 'G5', 'C6', 'E6', 'G6'].forEach((n, i) => bell(c, c.destination, noteFreq(n), c.currentTime + 0.01 + i * 0.07, 0.9, 0.2))
  } catch {
    /* 무시 */
  }
}

/** 소리 버튼: 연주 중이면 끄고(기억), 꺼져 있거나 곡이 끝났으면 켜고 한 번 연주한다. */
export function toggleSound(): void {
  if (playing && !muted) {
    setMuted(true)
    return
  }
  setMuted(false)
  autoDone = true
  playSong()
}
export function setMuted(v: boolean): void {
  muted = v
  try {
    if (v) localStorage.setItem(XMAS_MUTE_KEY, 'on')
    else localStorage.removeItem(XMAS_MUTE_KEY)
  } catch {
    /* 저장하지 못해도 이번 방문 동안은 유지 */
  }
  if (v) clearSong()
  if (v) playing = false
  emit()
}
