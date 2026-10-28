import { useEffect, useRef, useState } from 'react'
import { CENTER_ADDRESS_CANDIDATES, geocode, loadKakao } from '../lib/kakao'

type State = { status: 'loading' } | { status: 'ready' } | { status: 'error'; message: string }

export default function KakaoMap() {
  const container = useRef<HTMLDivElement>(null)
  const [state, setState] = useState<State>({ status: 'loading' })

  useEffect(() => {
    let cancelled = false

    async function init() {
      try {
        const k = await loadKakao()
        let center: kakao.maps.LatLng | null = null
        for (const address of CENTER_ADDRESS_CANDIDATES) {
          center = await geocode(k, address)
          if (center) break
        }
        if (cancelled || !container.current) return
        if (!center) {
          throw new Error('지도 중심 주소를 조회하지 못했습니다. 카카오 앱의 지도·로컬 사용 설정을 확인해 주세요.')
        }
        new k.maps.Map(container.current, { center, level: 4 })
        setState({ status: 'ready' })
      } catch (e) {
        if (!cancelled) {
          setState({ status: 'error', message: e instanceof Error ? e.message : String(e) })
        }
      }
    }

    init()
    return () => {
      cancelled = true
    }
  }, [])

  return (
    <div className="map-wrap">
      <div ref={container} className="map" role="application" aria-label="북구동행지도" />
      {state.status === 'loading' && <p className="map-notice">지도를 불러오는 중입니다…</p>}
      {state.status === 'error' && (
        <p className="map-notice map-notice-error" role="alert">
          {state.message}
        </p>
      )}
    </div>
  )
}
