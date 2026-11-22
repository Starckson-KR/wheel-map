import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { sheetHost } from '../lib/sheetHost'
import { useSheetFocus } from '../lib/useSheetFocus'
import { getMotionReduce, getTextSize, getTheme, getView, PREFS_CHANGE_EVENT, setMotionReduce, setTextSize, setTheme, setView, type TextSize, type ThemeMode, type ViewMode } from '../lib/viewPrefs'
import Icon from './Icon'
import SheetHandle from './SheetHandle'
import { SegBg } from './motionKit'
import { useXmas } from '../lib/useXmas'
import { setXmasOff } from '../lib/xmas'

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
// open·onOpenChange를 주면 바깥에서 열고 닫는다(행정 도구 메뉴). triggerClass는 버튼에 덧붙일 클래스.
type VsProps = { floating?: boolean; row?: boolean; open?: boolean; onOpenChange?: (o: boolean) => void; triggerClass?: string }
export default function ViewSettings({ floating = false, row = false, open: openProp, onOpenChange, triggerClass }: VsProps) {
  const [openSelf, setOpenSelf] = useState(false)
  const open = openProp ?? openSelf
  const setOpen = onOpenChange ?? setOpenSelf
  useEffect(() => {
    if (!open) return
    const k = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    window.addEventListener('keydown', k)
    return () => window.removeEventListener('keydown', k)
  }, [open, setOpen])
  const sheetRef = useRef<HTMLDivElement>(null)
  useSheetFocus(open, sheetRef)
  const [view, setV] = useState(getView)
  const [theme, setT] = useState(getTheme)
  const [text, setTx] = useState(getTextSize)
  const [calm, setCalm] = useState(getMotionReduce)
  const xmas = useXmas() // 크리스마스 장식 스위치는 켜짐 기간(12월 또는 시연 도구에서 켬)에만 보인다
  // 로그아웃·계정 전환·서버 설정 동기화로 저장 값이 바뀌면 시트 값도 다시 읽는다
  useEffect(() => {
    const sync = () => {
      setV(getView())
      setT(getTheme())
      setTx(getTextSize())
      setCalm(getMotionReduce())
    }
    window.addEventListener(PREFS_CHANGE_EVENT, sync)
    return () => window.removeEventListener(PREFS_CHANGE_EVENT, sync)
  }, [])
  return (
    <>
      <button type="button" className={(floating ? 'hm-tool vs-float' : row ? 'hm-tool hm-tool-row' : 'hm-tool') + (triggerClass ? ' ' + triggerClass : '')} onClick={() => setOpen(true)} aria-haspopup="dialog" aria-label={row ? '화면 설정 열기' : undefined}>
        {row ? <Icon name="chev" size={18} /> : '화면'}
      </button>
      {open &&
        createPortal(
          <>
            <div className="ms-dim" onClick={() => setOpen(false)} />
            <div className="ms" data-sheet ref={sheetRef} role="dialog" aria-modal="true" aria-label="화면 설정">
              <SheetHandle onDown={() => setOpen(false)} />
              <div className="ms-head">
                <div>
                  <h2>화면 설정</h2>
                </div>
                <button type="button" className="bm-close" onClick={() => setOpen(false)}>
                  닫기
                </button>
              </div>
              <div className="ms-sec ms-view">
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
                      {view === v.id && <SegBg group="seg-set-view" />}
                      {v.label}
                    </button>
                  ))}
                </div>
                <p className="bm-meta">자동은 기기 화면 크기에 맞춰요. PC는 넓은 화면으로 보여요.</p>
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
                      {theme === v.id && <SegBg group="seg-set-theme" />}
                      {v.label}
                    </button>
                  ))}
                </div>
                <p className="bm-meta">시스템은 기기 설정을 따라요. 지도 바탕은 그대로 밝게 보여요.</p>
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
                      {text === v.id && <SegBg group="seg-set-text" />}
                      {v.label}
                    </button>
                  ))}
                </div>
                <p className="bm-meta">크게를 고르면 화면의 글자가 커져요.</p>
              </div>
              <div className="ms-sec">
                <h3>움직임 줄이기</h3>
                <div className="rf-seg" role="group" aria-label="움직임 줄이기">
                  {[{ on: false, label: '꺼짐' }, { on: true, label: '켜짐' }].map((v) => (
                    <button key={v.label} type="button" className={calm === v.on ? 'on' : ''} aria-pressed={calm === v.on} onClick={() => { setMotionReduce(v.on); setCalm(v.on) }}>
                      {calm === v.on && <SegBg group="seg-set-calm" />}
                      {v.label}
                    </button>
                  ))}
                </div>
                <p className="bm-meta">켜면 화면이 바뀔 때의 움직이는 효과를 줄여요.</p>
              </div>
              {xmas.season && (
                <div className="ms-sec">
                  <h3>크리스마스 장식</h3>
                  <div className="rf-seg" role="group" aria-label="크리스마스 장식">
                    {[{ on: true, label: '켬' }, { on: false, label: '끔' }].map((v) => (
                      <button key={v.label} type="button" className={xmas.on === v.on ? 'on' : ''} aria-pressed={xmas.on === v.on} onClick={() => setXmasOff(!v.on)}>
                        {xmas.on === v.on && <SegBg group="seg-set-xmas" />}
                        {v.label}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </>,
          sheetHost(),
        )}
    </>
  )
}
