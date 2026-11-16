import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { Barrier } from '../types'
import { sheetHost } from '../lib/sheetHost'
import DemoTools, { MockStrip } from './DemoTools'
import Icon from './Icon'
import SheetHandle from './SheetHandle'
import ViewSettings from './ViewSettings'

type Which = 'menu' | 'view' | 'demo' | null

// 행정 화면 머리줄: 한 줄(‹ 지도 · 제목 · 도구) + 가상 데이터일 때만 보이는 얇은 띠.
// 좁은 화면에서는 화면 설정·시연 도구를 "⋯" 메뉴 시트 하나로 묶고, 넓은 화면에서는 두 버튼을 그대로 펼쳐 둔다.
export default function AdminHeader({ onReset, barriers }: { onReset: () => void; barriers: Barrier[] }) {
  const [which, setWhich] = useState<Which>(null)
  const moreRef = useRef<HTMLButtonElement>(null)
  const firstRef = useRef<HTMLButtonElement>(null)
  const wasMenu = useRef(false)

  // 메뉴가 열리면 첫 항목으로, 시트가 모두 닫히면 ⋯ 버튼으로 초점을 돌려 키보드·화면 읽기에서 길을 잃지 않게 한다.
  useEffect(() => {
    if (which === 'menu') {
      wasMenu.current = true
      firstRef.current?.focus()
    } else if (which === null && wasMenu.current) {
      wasMenu.current = false
      moreRef.current?.focus()
    }
  }, [which])
  useEffect(() => {
    if (which !== 'menu') return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setWhich(null)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [which])

  return (
    <>
      <header className="adm-top">
        <button type="button" className="adm-tomap" aria-label="지도로 돌아가기" onClick={() => (location.hash = '#/map')}>
          <Icon name="chevL" size={20} />
          <span>지도</span>
        </button>
        <h1>
          <span className="adm-brand-name">이의있음! · </span>행정
        </h1>
        <div className="adm-tools">
          <button ref={moreRef} type="button" className="adm-more" aria-haspopup="dialog" aria-label="도구 열기" onClick={() => setWhich('menu')}>
            <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" focusable="false">
              <circle cx="5" cy="12" r="1.8" />
              <circle cx="12" cy="12" r="1.8" />
              <circle cx="19" cy="12" r="1.8" />
            </svg>
          </button>
          <ViewSettings open={which === 'view'} onOpenChange={(o) => setWhich(o ? 'view' : null)} triggerClass="adm-wide" />
          <DemoTools page="admin" onReset={onReset} barriers={barriers} open={which === 'demo'} onOpenChange={(o) => setWhich(o ? 'demo' : null)} triggerClass="adm-wide" />
        </div>
      </header>
      <div className="adm-strip">
        <MockStrip />
      </div>
      {which === 'menu' &&
        createPortal(
          <>
            <div className="ms-dim" onClick={() => setWhich(null)} />
            <div className="ms" data-sheet role="dialog" aria-modal="true" aria-label="도구">
              <SheetHandle onDown={() => setWhich(null)} />
              <div className="ms-head">
                <h2>도구</h2>
                <button type="button" className="bm-close" onClick={() => setWhich(null)}>
                  닫기
                </button>
              </div>
              <button ref={firstRef} type="button" className="adm-menu-row" onClick={() => setWhich('view')}>
                <span>화면 설정</span>
                <Icon name="chev" size={18} />
              </button>
              <button type="button" className="adm-menu-row" onClick={() => setWhich('demo')}>
                <span>시연 도구</span>
                <Icon name="chev" size={18} />
              </button>
            </div>
          </>,
          sheetHost(),
        )}
    </>
  )
}
