import { test } from 'node:test'
import assert from 'node:assert/strict'

// 브라우저 없이 확인하려고 localStorage·document·window를 흉내 낸다.
const store = new Map<string, string>()
const attrs = new Map<string, string>()
const events: string[] = []
const g = globalThis as Record<string, unknown>
g.localStorage = {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => void store.set(k, v),
  removeItem: (k: string) => void store.delete(k),
}
g.document = {
  documentElement: {
    setAttribute: (k: string, v: string) => void attrs.set(k, v),
    removeAttribute: (k: string) => void attrs.delete(k),
    getAttribute: (k: string) => attrs.get(k) ?? null,
    classList: { toggle() {}, contains: () => false },
  },
}
g.window = {
  innerWidth: 375,
  matchMedia: () => ({ matches: false, addEventListener() {} }),
  dispatchEvent: (e: Event) => void events.push(e.type),
  addEventListener() {},
}
g.screen = { width: 375, height: 812 }

const { reapplyPrefs, setTextSize, setTheme, PREFS_CHANGE_EVENT } = await import('../src/lib/viewPrefs.ts')

test('저장 값이 비면 reapplyPrefs가 글자 크기·화면 색을 보통·시스템 상태로 되돌린다', () => {
  setTextSize('large')
  setTheme('dark')
  assert.equal(attrs.get('data-text'), 'large')
  assert.equal(attrs.get('data-theme'), 'dark')
  // 로그아웃·계정 전환: 저장소만 비워지고 화면 속성은 남아 있던 상태
  store.clear()
  events.length = 0
  reapplyPrefs()
  assert.equal(attrs.has('data-text'), false)
  assert.equal(attrs.get('data-theme'), 'light')
  assert.ok(events.includes(PREFS_CHANGE_EVENT))
})

test('서버 값이 저장소에 들어온 뒤 reapplyPrefs가 화면 속성에 반영한다', () => {
  store.set('wheelmap.textSize', 'large')
  store.set('wheelmap.theme', 'dark')
  store.set('wheelmap.view', 'desktop')
  reapplyPrefs()
  assert.equal(attrs.get('data-text'), 'large')
  assert.equal(attrs.get('data-theme'), 'dark')
  assert.equal(attrs.get('data-view'), 'desktop')
})
