// Android Chrome의 설치 창(beforeinstallprompt)을 받아 둔다. 이벤트는 앱이 열린 직후 한 번만 오므로 모듈이 불러지는 즉시 듣는다.
// 조건(web.dev/articles/install-criteria): HTTPS, manifest의 name·192/512 아이콘·start_url·display, 아직 설치 전, 페이지를 누르고 30초 이상 봄.
import { useSyncExternalStore } from 'react'

type PromptEvent = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }> }

let deferred: PromptEvent | null = null
let installed = false
let version = 0
const subs = new Set<() => void>()
const emit = () => {
  version += 1
  subs.forEach((f) => f())
}

if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault()
    deferred = e as PromptEvent
    emit()
  })
  window.addEventListener('appinstalled', () => {
    deferred = null
    installed = true
    emit()
  })
}

const subscribe = (f: () => void) => {
  subs.add(f)
  return () => void subs.delete(f)
}
const snapshot = () => version

export function useInstallPrompt(): { available: boolean; installed: boolean; install: () => Promise<boolean> } {
  useSyncExternalStore(subscribe, snapshot, snapshot)
  return {
    available: deferred !== null,
    installed,
    install: async () => {
      const e = deferred
      if (!e) return false
      deferred = null // 설치 창은 한 번만 쓸 수 있다
      emit()
      try {
        await e.prompt()
        const c = await e.userChoice
        return c.outcome === 'accepted'
      } catch {
        return false
      }
    },
  }
}
