// 지도 화면(BarrierMap)은 첫 묶음에서 빼고 따로 내려받는다.
// 앱이 뜬 뒤 한가할 때·지도로 가는 버튼에 손이 닿을 때 미리 받아 두어, 첫 전환에서 기다리지 않게 한다.
import { lazy, type ComponentType } from 'react'

type MapModule = typeof import('../pages/BarrierMap')
export type MapComponent = ComponentType<{ intent?: string; active?: boolean }>

const RETRY_MS = 800
let pending: Promise<MapModule> | null = null
let loaded: MapComponent | null = null

/** 지도 묶음을 받는다. 실패하면 한 번 다시 시도하고, 그래도 안 되면 다음 호출이 새로 시도할 수 있게 비운다. */
export function loadMap(): Promise<MapModule> {
  pending ??= import('../pages/BarrierMap')
    .catch(() => new Promise<void>((r) => setTimeout(r, RETRY_MS)).then(() => import('../pages/BarrierMap')))
    .then(
      (mod) => {
        loaded = mod.default
        return mod
      },
      (e: unknown) => {
        pending = null
        throw e
      },
    )
  return pending
}

/** 미리 받기: 실패해도 조용히 넘어간다(실제로 지도를 열 때 다시 시도한다). */
export function preloadMap(): void {
  loadMap().catch(() => {})
}

/** 이미 받아 둔 지도 컴포넌트. 있으면 Suspense를 거치지 않고 바로 그린다. */
export const loadedMap = (): MapComponent | null => loaded

export const LazyMap: MapComponent = lazy(loadMap)
