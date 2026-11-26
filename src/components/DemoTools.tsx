import { useEffect, useRef, useState } from 'react'
import { useSheetFocus } from '../lib/useSheetFocus'
import { createPortal } from 'react-dom'
import { sheetHost } from '../lib/sheetHost'
import { DEMO_USERS, useReports } from '../lib/reportStore'
import type { Barrier } from '../types'
import Icon from './Icon'
import SheetHandle from './SheetHandle'
import { SegBg } from './motionKit'
import { confirmSheet, toast } from '../lib/uiStore'
import { getMotionReduce, setMotionReduce } from '../lib/viewPrefs'
import { getAiEnabled, setAiEnabled } from '../lib/aiSearch/aiPref'
import { loadPubDataset } from '../lib/publicLayers'
import { BADGE_TEXT, FILE_MAX_BYTES, pickCandidates } from '../lib/demoLarge'
import { Sentences } from './Sentences'
import { DEMO_WEATHER_LABEL, DEMO_WEATHER_ORDER } from '../lib/weather/model'
import { setDemoWeather, useDemoWeather } from '../lib/weather/store'
import { getXmasDemo, setXmasDemo } from '../lib/xmas'

// 시연용 모의 연동·가상 데이터 표시: 모의 접수 모드에서는 홈·내 정보·행정 화면에 계속 보인다.
// onMap: 지도 화면은 두 표시를 모두 보이지 않는다(저장 오류 알림만 남김, 제보 안내에는 모의 연동 문구가 따로 있다).
export function MockStrip({ onMap = false }: { onMap?: boolean } = {}) {
  const mode = useReports((s) => s.complaintMode)
  const storageError = useReports((s) => s.storageError)
  const hasLarge = useReports((s) => s.reports.some((r) => r.demoSet === 'large'))
  return (
    <>
      {hasLarge && !onMap && (
        <div className="mock-strip mock-strip-large" role="note">
          {BADGE_TEXT}
        </div>
      )}
      {mode === 'mock' && !onMap && (
        <div className="mock-strip" role="note">
          시연용 모의 연동 · 실제 접수는 되지 않아요
        </div>
      )}
      {storageError && (
        <div className="rf-notice" role="alert">
          {storageError}
        </div>
      )}
    </>
  )
}

type Props = {
  row?: boolean // 설정 시트의 행 오른쪽: 화살표 아이콘만
  page: 'map' | 'admin'
  onReset: () => void
  barriers: Barrier[]
  open?: boolean // 바깥에서 열고 닫을 때(행정 도구 메뉴)
  onOpenChange?: (o: boolean) => void
  triggerClass?: string
}

// 발표용 장치(시연 사용자·접수 방식·시간 앞당기기·시연 데이터)를 한곳에 모았다. 일반 화면에는 버튼 하나만 보인다.
export default function DemoTools({ page, onReset, barriers, row = false, open: openProp, onOpenChange, triggerClass }: Props) {
  const [openSelf, setOpenSelf] = useState(false)
  const open = openProp ?? openSelf
  const setOpen = onOpenChange ?? setOpenSelf
  useEffect(() => {
    if (!open) return
    const k = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    window.addEventListener('keydown', k)
    return () => window.removeEventListener('keydown', k)
  }, [open, setOpen])
  const [msg, setMsg] = useState('')
  const [motion, setMotion] = useState(getMotionReduce)
  const [ai, setAi] = useState(getAiEnabled)
  const [xmasDemo, setXmasDemoState] = useState(getXmasDemo)
  const wx = useDemoWeather()
  const userId = useReports((s) => s.userId)
  const setUser = useReports((s) => s.setUser)
  const mode = useReports((s) => s.complaintMode)
  const setMode = useReports((s) => s.setComplaintMode)
  const offset = useReports((s) => s.offsetDays)
  const advanceDays = useReports((s) => s.advanceDays)
  const fillDemo = useReports((s) => s.fillDemo)
  const fillLargeDemo = useReports((s) => s.fillLargeDemo)
  const exportDemo = useReports((s) => s.exportDemo)
  const importDemo = useReports((s) => s.importDemo)
  const [busy, setBusy] = useState(false)
  const [shift, setShift] = useState(true)
  const fileRef = useRef<HTMLInputElement>(null)

  // 대규모 시연 데이터: 용봉동 안 횡단보도·정류장·편의시설 위치에 가상 지점을 얹는다(위치 자료는 이 버튼을 누를 때 불러온다).
  const onFillLarge = async () => {
    setBusy(true)
    setMsg('위치 자료를 불러와 가상 데이터를 만드는 중이에요…')
    try {
      const [cw, bus, fac] = await Promise.all([loadPubDataset('crosswalk'), loadPubDataset('bus'), loadPubDataset('facility')])
      const n = fillLargeDemo(pickCandidates({ crosswalk: cw.items, bus: bus.items, facility: fac.items }), barriers)
      setMsg('')
      toast(n > 0 ? `대규모 시연 데이터 ${n}건을 채웠어요.` : '대규모 시연 데이터가 이미 있어요.')
    } catch {
      setMsg('위치 자료를 불러오지 못해 만들지 못했어요. 인터넷 연결을 확인해 주세요.')
    } finally {
      setBusy(false)
    }
  }

  const onExport = () => {
    const json = exportDemo()
    if (!json) {
      setMsg('내보낼 시연 데이터가 없어요.')
      return
    }
    const url = URL.createObjectURL(new Blob([json], { type: 'application/json' }))
    const a = document.createElement('a')
    a.href = url
    a.download = `wheelmap-demo-${new Date().toLocaleDateString('sv-SE').replace(/-/g, '')}.json`
    a.click()
    URL.revokeObjectURL(url)
    setMsg('')
    toast(`시연 데이터 파일을 내보냈어요(${Math.round(json.length / 1024)}KB).`)
  }

  const onImport = async (file: File | undefined) => {
    if (!file) return
    if (file.size > FILE_MAX_BYTES) {
      setMsg(`파일이 너무 커요(${Math.round(FILE_MAX_BYTES / 1048576)}MB까지).`)
      return
    }
    if (!(await confirmSheet({ title: '시연 데이터를 바꿀까요?', body: '지금 있는 시연 데이터가 파일 내용으로 바뀌어요. 직접 만든 제보는 그대로예요.', confirmLabel: '바꾸기' }))) return
    try {
      const res = importDemo(await file.text(), shift)
      if (res.ok) {
        setMsg('')
        toast(`시연 데이터 ${res.count}건을 가져왔어요${res.replaced > 0 ? ` (기존 ${res.replaced}건은 바뀌었어요)` : ''}${shift ? ` · 날짜를 ${res.shiftedDays}일 옮겼어요` : ''}.`)
      } else setMsg(res.message)
    } catch {
      setMsg('파일을 읽지 못했어요.')
    }
  }
  const officer = userId === 'officer'
  const sheetRef = useRef<HTMLDivElement>(null)
  useSheetFocus(open, sheetRef)

  return (
    <>
      <button type="button" className={(row ? 'hm-tool hm-tool-row' : 'hm-tool') + (triggerClass ? ' ' + triggerClass : '')} onClick={() => setOpen(true)} aria-haspopup="dialog" aria-label={row ? '시연 도구 열기' : undefined}>
        {row ? <Icon name="chev" size={18} /> : '시연 도구'}
      </button>
      {open &&
        createPortal(
        <>
          <div className="ms-dim" onClick={() => setOpen(false)} />
          <div className="ms" data-sheet ref={sheetRef} role="dialog" aria-modal="true" aria-label="시연 도구">
            <SheetHandle onDown={() => setOpen(false)} />
            <div className="ms-head">
              <div>
                <h2>시연 도구</h2>
                <Sentences as="p" className="ms-sub">발표용 설정이에요.</Sentences>
              </div>
              <button type="button" className="bm-close" onClick={() => setOpen(false)}>
                닫기
              </button>
            </div>

            <div className="ms-sec">
              <h3>누구로 볼까요</h3>
              <select value={userId} onChange={(e) => setUser(e.target.value)} aria-label="시연 사용자">
                {DEMO_USERS.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.name}
                  </option>
                ))}
              </select>
            </div>

            <div className="ms-sec">
              <h3>접수 방식</h3>
              <div className="rf-seg" role="group" aria-label="접수 방식">
                <button type="button" className={mode === 'link' ? 'on' : ''} aria-pressed={mode === 'link'} onClick={() => setMode('link')}>
                  {mode === 'link' && <SegBg group="seg-demo-mode" />}
                  링크(실제)
                </button>
                <button type="button" className={mode === 'mock' ? 'on' : ''} aria-pressed={mode === 'mock'} onClick={() => setMode('mock')}>
                  {mode === 'mock' && <SegBg group="seg-demo-mode" />}
                  모의 연동(시연)
                </button>
              </div>
              <p className="bm-meta">모의 연동은 신문고에 실제로 접수하지 않아요.</p>
            </div>

            <div className="ms-sec">
              <h3>시간 앞당기기</h3>
              <div className="ms-row">
                <Sentences key={offset} as="span" className="bm-meta fx-fade">{`앱 안의 날짜만 움직여요. 지금 +${offset}일`}</Sentences>
                <span className="rf-actions">
                  <button type="button" onClick={() => advanceDays(7)}>
                    +7일
                  </button>
                  <button type="button" onClick={() => advanceDays(30)}>
                    +30일
                  </button>
                </span>
              </div>
            </div>

            <div className="ms-sec">
              <h3>움직임 줄이기</h3>
              <div className="rf-seg" role="group" aria-label="움직임 줄이기">
                <button type="button" className={!motion ? 'on' : ''} aria-pressed={!motion} onClick={() => { setMotion(false); setMotionReduce(false) }}>
                  {!motion && <SegBg group="seg-demo-calm" />}
                  꺼짐
                </button>
                <button type="button" className={motion ? 'on' : ''} aria-pressed={motion} onClick={() => { setMotion(true); setMotionReduce(true) }}>
                  {motion && <SegBg group="seg-demo-calm" />}
                  켜짐
                </button>
              </div>
              <p className="bm-meta">켜면 화면 움직임을 줄여요.</p>
            </div>

            <div className="ms-sec">
              <h3>AI 검색</h3>
              <div className="rf-seg" role="group" aria-label="AI 검색">
                <button type="button" className={ai ? 'on' : ''} aria-pressed={ai} onClick={() => { setAi(true); setAiEnabled(true) }}>
                  {ai && <SegBg group="seg-demo-ai" />}
                  켜짐
                </button>
                <button type="button" className={!ai ? 'on' : ''} aria-pressed={!ai} onClick={() => { setAi(false); setAiEnabled(false) }}>
                  {!ai && <SegBg group="seg-demo-ai" />}
                  꺼짐(키워드만)
                </button>
              </div>
              <Sentences as="p" className="bm-meta">끄면 홈 검색창이 키워드로만 찾아요.</Sentences>
            </div>

            <div className="ms-sec">
              <h3>크리스마스</h3>
              <div className="rf-seg" role="group" aria-label="크리스마스">
                <button type="button" className={!xmasDemo ? 'on' : ''} aria-pressed={!xmasDemo} onClick={() => { setXmasDemoState(false); setXmasDemo(false) }}>
                  {!xmasDemo && <SegBg group="seg-demo-xmas" />}
                  자동
                </button>
                <button type="button" className={xmasDemo ? 'on' : ''} aria-pressed={xmasDemo} onClick={() => { setXmasDemoState(true); setXmasDemo(true) }}>
                  {xmasDemo && <SegBg group="seg-demo-xmas" />}
                  켬
                </button>
              </div>
            </div>

            <div className="ms-sec">
              <h3>날씨</h3>
              <div className="rf-seg" role="group" aria-label="날씨">
                {DEMO_WEATHER_ORDER.map((k) => (
                  <button key={k} type="button" className={wx === k ? 'on' : ''} aria-pressed={wx === k} onClick={() => setDemoWeather(k)}>
                    {wx === k && <SegBg group="seg-demo-wx" />}
                    {DEMO_WEATHER_LABEL[k]}
                  </button>
                ))}
              </div>
              <Sentences as="p" className="bm-meta">비·눈·더움을 고르면 홈과 길찾기에 주의가 떠요.</Sentences>
            </div>

            <div className="ms-sec">
              <h3>시연 데이터</h3>
              <div className="rf-actions">
                <button
                  type="button"
                  onClick={() => {
                    const n = fillDemo(barriers)
                    setMsg(n > 0 ? `시연 데이터 ${n}건을 채웠어요.` : '시연 데이터가 이미 있어요.')
                  }}
                >
                  시연 데이터 채우기
                </button>
                <button type="button" disabled={busy} onClick={onFillLarge}>
                  대규모 시연 데이터 채우기
                </button>
                <button
                  type="button"
                  className="rf-danger"
                  onClick={() => {
                    setOpen(false)
                    onReset()
                  }}
                >
                  초기화
                </button>
              </div>
              <div className="rf-actions">
                <button type="button" onClick={onExport}>
                  시연 데이터 내보내기
                </button>
                <button type="button" onClick={() => fileRef.current?.click()}>
                  시연 데이터 가져오기
                </button>
                <input
                  ref={fileRef}
                  type="file"
                  accept=".json,application/json"
                  hidden
                  onChange={(e) => {
                    const f = e.target.files?.[0]
                    e.target.value = ''
                    void onImport(f)
                  }}
                />
              </div>
              <label className="bm-meta">
                <input type="checkbox" checked={shift} onChange={(e) => setShift(e.target.checked)} /> 가져올 때 날짜를 오늘 기준으로 옮기기
              </label>
              <Sentences as="p" className="bm-meta">대규모 데이터는 가상 사용자 약 300명의 가상 제보예요.</Sentences>
              {msg && (
                <Sentences as="p" className="rf-notice" role="status">
                  {msg}
                </Sentences>
              )}
            </div>

            <div className="ms-sec">
              <h3>화면 이동</h3>
              {page === 'map' ? (
                <button
                  type="button"
                  className={officer ? 'rf-primary' : ''}
                  onClick={() => {
                    setOpen(false)
                    location.hash = '#/admin'
                  }}
                >
                  행정 화면 열기{officer ? ' (담당 공무원)' : ''}
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => {
                    setOpen(false)
                    location.hash = '#/map'
                  }}
                >
                  지도로 돌아가기
                </button>
              )}
            </div>
          </div>
        </>,
          sheetHost(),
        )}
    </>
  )
}
