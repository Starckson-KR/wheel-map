import { useState } from 'react'
import { createPortal } from 'react-dom'
import { getTextSize, getTheme, getView, setTextSize, setTheme, setView, type TextSize, type ThemeMode, type ViewMode } from '../lib/viewPrefs'
import SheetHandle from './SheetHandle'

const VIEWS: { id: ViewMode; label: string }[] = [
  { id: 'auto', label: '자동' },
  { id: 'mobile', label: '모바일' },
  { id: 'desktop', label: 'PC' },
]
const THEMES: { id: ThemeMode; label: string }[] = [
  { id: 'system', label: '시스템' },
  { id: 'light', label: '라이트' },
  { id: 'dark', label: '다크' },
]

const TEXTS: { id: TextSize; label: string }[] = [
  { id: 'normal', label: '보통' },
  { id: 'large', label: '크게' },
]

// 화면 설정(보기 방식·화면 색). 처음부터 팝업으로 띄우지 않고, 버튼을 눌렀을 때만 열린다.
export default function ViewSettings({ floating = false }: { floating?: boolean }) {
  const [open, setOpen] = useState(false)
  const [view, setV] = useState(getView)
  const [theme, setT] = useState(getTheme)
  const [text, setTx] = useState(getTextSize)
  return (
    <>
      <button type="button" className={floating ? 'hm-tool vs-float' : 'hm-tool'} onClick={() => setOpen(true)} aria-haspopup="dialog">
        화면
      </button>
      {open &&
        createPortal(
          <>
            <div className="ms-dim" onClick={() => setOpen(false)} />
            <div className="ms" data-sheet role="dialog" aria-modal="true" aria-label="화면 설정">
              <SheetHandle onDown={() => setOpen(false)} />
              <div className="ms-head">
                <div>
                  <h2>화면 설정</h2>
                  <p className="ms-sub">이 기기에 저장돼요.</p>
                </div>
                <button type="button" className="bm-close" onClick={() => setOpen(false)}>
                  닫기
                </button>
              </div>
              <div className="ms-sec">
                <h3>보기 방식</h3>
                <div className="rf-seg" role="group" aria-label="보기 방식">
                  {VIEWS.map((v) => (
                    <button
                      key={v.id}
                      type="button"
                      className={view === v.id ? 'on' : ''}
                      aria-pressed={view === v.id}
                      onClick={() => {
                        setView(v.id)
                        setV(v.id)
                      }}
                    >
                      {v.label}
                    </button>
                  ))}
                </div>
                <p className="bm-meta">자동은 창 너비에 맞춰요. 모바일은 PC에서도 폰 크기로 보여 줘요.</p>
              </div>
              <div className="ms-sec">
                <h3>화면 색</h3>
                <div className="rf-seg" role="group" aria-label="화면 색">
                  {THEMES.map((v) => (
                    <button
                      key={v.id}
                      type="button"
                      className={theme === v.id ? 'on' : ''}
                      aria-pressed={theme === v.id}
                      onClick={() => {
                        setTheme(v.id)
                        setT(v.id)
                      }}
                    >
                      {v.label}
                    </button>
                  ))}
                </div>
                <p className="bm-meta">지도 바탕은 그대로 밝게 보여요.</p>
              </div>
              <div className="ms-sec">
                <h3>글자 크기</h3>
                <div className="rf-seg" role="group" aria-label="글자 크기">
                  {TEXTS.map((v) => (
                    <button
                      key={v.id}
                      type="button"
                      className={text === v.id ? 'on' : ''}
                      aria-pressed={text === v.id}
                      onClick={() => {
                        setTextSize(v.id)
                        setTx(v.id)
                      }}
                    >
                      {v.label}
                    </button>
                  ))}
                </div>
                <p className="bm-meta">크게를 고르면 화면 전체 글자가 커져요.</p>
              </div>
            </div>
          </>,
          document.querySelector('.bm') ?? document.body,
        )}
    </>
  )
}
