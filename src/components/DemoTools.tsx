import { useState } from 'react'
import { createPortal } from 'react-dom'
import { DEMO_USERS, useReports } from '../lib/reportStore'
import type { Barrier } from '../types'
import SheetHandle from './SheetHandle'
import { getMotionForce, setMotionForce } from '../lib/viewPrefs'

// 시연용 모의 연동 표시: 모의 접수 모드에서는 어느 화면에서나 계속 보인다.
export function MockStrip() {
  const mode = useReports((s) => s.complaintMode)
  const storageError = useReports((s) => s.storageError)
  return (
    <>
      {mode === 'mock' && (
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
  page: 'map' | 'admin'
  onReset: () => void
  barriers: Barrier[]
}

// 발표용 장치(시연 사용자·접수 방식·시간 앞당기기·시연 데이터)를 한곳에 모았다. 일반 화면에는 버튼 하나만 보인다.
export default function DemoTools({ page, onReset, barriers }: Props) {
  const [open, setOpen] = useState(false)
  const [msg, setMsg] = useState('')
  const [motion, setMotion] = useState(getMotionForce)
  const userId = useReports((s) => s.userId)
  const setUser = useReports((s) => s.setUser)
  const mode = useReports((s) => s.complaintMode)
  const setMode = useReports((s) => s.setComplaintMode)
  const offset = useReports((s) => s.offsetDays)
  const advanceDays = useReports((s) => s.advanceDays)
  const fillDemo = useReports((s) => s.fillDemo)
  const officer = userId === 'officer'

  return (
    <>
      <button type="button" className="hm-tool" onClick={() => setOpen(true)} aria-haspopup="dialog">
        시연 도구
      </button>
      {open &&
        createPortal(
        <>
          <div className="ms-dim" onClick={() => setOpen(false)} />
          <div className="ms" data-sheet role="dialog" aria-modal="true" aria-label="시연 도구">
            <SheetHandle onDown={() => setOpen(false)} />
            <div className="ms-head">
              <div>
                <h2>시연 도구</h2>
                <p className="ms-sub">발표용 설정이에요. 실제 로그인이나 접수가 아니에요.</p>
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
                  링크(실제)
                </button>
                <button type="button" className={mode === 'mock' ? 'on' : ''} aria-pressed={mode === 'mock'} onClick={() => setMode('mock')}>
                  모의 연동(시연)
                </button>
              </div>
              <p className="bm-meta">모의 연동은 신문고에 실제로 접수하지 않고, 접수 과정만 보여 줘요.</p>
            </div>

            <div className="ms-sec">
              <h3>시간 앞당기기</h3>
              <div className="ms-row">
                <span className="bm-meta">앱 안의 날짜만 움직여요. 지금 +{offset}일</span>
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
              <h3>움직임 보기</h3>
              <div className="rf-seg" role="group" aria-label="움직임 보기">
                <button type="button" className={!motion ? 'on' : ''} aria-pressed={!motion} onClick={() => { setMotion(false); setMotionForce(false) }}>
                  꺼짐
                </button>
                <button type="button" className={motion ? 'on' : ''} aria-pressed={motion} onClick={() => { setMotion(true); setMotionForce(true) }}>
                  켜짐
                </button>
              </div>
              <p className="bm-meta">기기에서 움직임 줄이기를 켜 두었어도, 시연용으로 화면 움직임을 보여 줘요.</p>
            </div>

            <div className="ms-sec">
              <h3>시연 데이터</h3>
              <div className="rf-actions">
                <button
                  type="button"
                  onClick={() => {
                    const n = fillDemo(barriers)
                    setMsg(n > 0 ? `시연 데이터 ${n}건을 채웠어요. '시연 데이터' 표시가 붙고, 초기화하면 지워져요.` : '시연 데이터가 이미 있어요.')
                  }}
                >
                  시연 데이터 채우기
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
              {msg && (
                <p className="rf-notice" role="status">
                  {msg}
                </p>
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
          document.querySelector('.bm') ?? document.body,
        )}
    </>
  )
}
