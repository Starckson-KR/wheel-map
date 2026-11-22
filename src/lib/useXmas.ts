import { useSyncExternalStore } from 'react'
import { subscribeXmas, xmasSnapshot, type XmasState } from './xmas'

/** 크리스마스 장식 상태. 설정·시연 도구에서 바꾸면 열린 화면에 바로 반영된다. */
export function useXmas(): XmasState {
  return useSyncExternalStore(subscribeXmas, xmasSnapshot)
}
