import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { sheetHost } from '../lib/sheetHost'
import { logOut, useAccount } from '../lib/account/api'
import { clearAllLocks, deleteReport, deleteUser, loadReports, loadSummary, loadUsers, resetPin, unlockUser } from '../lib/account/admin'
import type { AdminReport, AdminSummary, AdminUser } from '../lib/account/admin'
import { confirmSheet, toast } from '../lib/uiStore'
import Icon from './Icon'
import SheetHandle from './SheetHandle'

type Tab = 'users' | 'reports'

const shortDate = (v: string | number) => {
  const d = new Date(v)
  return Number.isNaN(d.getTime()) ? '' : `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getDate()).padStart(2, '0')}`
}

// 개발자 관리: 현황 숫자, 계정·신고 목록, 지우기. 설정 시트의 행에서만 열리고, role이 'dev'인 계정에게만 행이 보인다(서버도 한 번 더 확인한다).
function AdminSheet({ onClose }: { onClose: () => void }) {
  const myId = useAccount((s) => s.user?.id)
  const [sum, setSum] = useState<AdminSummary | null>(null)
  const [tab, setTab] = useState<Tab>('users')
  const [users, setUsers] = useState<AdminUser[]>([])
  const [reports, setReports] = useState<AdminReport[]>([])
  const [more, setMore] = useState({ users: false, reports: false })
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(true)
  // 새 임시 PIN: 이 화면 상태에만 두고, 닫으면 지운다(다시 볼 수 없다)
  const [shownPin, setShownPin] = useState<{ name: string; pin: string; self: boolean } | null>(null)

  const [stamp, setStamp] = useState(0) // 값이 바뀌면 처음부터 다시 불러온다
  const reload = () => setStamp((n) => n + 1)
  useEffect(() => {
    let alive = true
    void Promise.all([loadSummary(), loadUsers(0), loadReports(0)]).then(([s, u, r]) => {
      if (!alive) return
      setBusy(false)
      if (!s.ok || !u.ok || !r.ok) {
        setErr((!s.ok && s.message) || (!u.ok && u.message) || (!r.ok && r.message) || '')
        return
      }
      setErr('')
      setSum(s.value)
      setUsers(u.value.items)
      setReports(r.value.items)
      setMore({ users: u.value.more, reports: r.value.more })
    })
    return () => {
      alive = false
    }
  }, [stamp])
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', k)
    return () => window.removeEventListener('keydown', k)
  }, [onClose])

  const loadMore = async () => {
    setBusy(true)
    if (tab === 'users') {
      const r = await loadUsers(users.length)
      if (r.ok) {
        setUsers((p) => [...p, ...r.value.items])
        setMore((m) => ({ ...m, users: r.value.more }))
      } else setErr(r.message)
    } else {
      const r = await loadReports(reports.length)
      if (r.ok) {
        setReports((p) => [...p, ...r.value.items])
        setMore((m) => ({ ...m, reports: r.value.more }))
      } else setErr(r.message)
    }
    setBusy(false)
  }

  const removeUser = async (u: AdminUser) => {
    if (!(await confirmSheet({ title: `${u.name} 계정을 지울까요?`, body: '되돌릴 수 없어요. 이 계정의 로그인·설정·신고·사진이 모두 지워져요.', confirmLabel: '지우기', danger: true }))) return
    const e = await deleteUser(u.id)
    if (e) return setErr(e)
    toast('계정을 지웠어요.')
    reload()
  }
  const unlock = async (u: AdminUser) => {
    if (!(await confirmSheet({ title: `${u.name} 로그인 잠금을 풀까요?`, body: '이름 기준 잠금만 풀려요. 계속 안 되면 모든 잠금을 풀어 주세요.', confirmLabel: '잠금 풀기' }))) return
    const e = await unlockUser(u.id)
    if (e) return setErr(e)
    setErr('')
    toast('잠금을 풀었어요.')
  }
  const unlockAll = async () => {
    if (!(await confirmSheet({ title: '모든 로그인 잠금을 풀까요?', body: '모든 계정의 로그인·가입 시도 제한이 풀려요.', confirmLabel: '모두 풀기' }))) return
    const e = await clearAllLocks()
    if (e) return setErr(e)
    setErr('')
    toast('모든 잠금을 풀었어요.')
  }
  const newPin = async (u: AdminUser) => {
    const self = u.id === myId
    if (!(await confirmSheet({ title: `${u.name} PIN을 다시 정할까요?`, body: `새 임시 PIN이 만들어지고, 이 계정은 모두 로그아웃돼요.${self ? ' 내 계정이라 다시 로그인해야 해요.' : ''}`, confirmLabel: '다시 정하기', danger: true }))) return
    const r = await resetPin(u.id)
    if (!r.ok) return setErr(r.message)
    setErr('')
    setShownPin({ name: u.name, pin: r.pin, self: r.self })
  }
  const closePin = () => {
    const self = shownPin?.self
    setShownPin(null)
    if (self) {
      onClose()
      void logOut() // 서버 세션이 이미 끊겼으므로 이 기기도 로그아웃 상태로 맞춘다
    }
  }
  const copyPin = async () => {
    try {
      await navigator.clipboard.writeText(shownPin?.pin ?? '')
      toast('복사했어요.')
    } catch {
      toast('복사하지 못했어요. 직접 적어 주세요.')
    }
  }
  const removeReport = async (r: AdminReport) => {
    if (!(await confirmSheet({ title: '이 신고를 지울까요?', body: '되돌릴 수 없어요. 신고와 붙은 사진이 지워져요.', confirmLabel: '지우기', danger: true }))) return
    const e = await deleteReport(r.id)
    if (e) return setErr(e)
    toast('신고를 지웠어요.')
    reload()
  }

  const stats: [string, number | undefined][] = [
    ['계정', sum?.users],
    ['로그인 중', sum?.sessions],
    ['신고', sum?.reports],
    ['사진', sum?.photos],
  ]
  return (
    <>
      <div className="ms-dim" onClick={onClose} />
      <div className="ms dv" data-sheet role="dialog" aria-modal="true" aria-label="개발자 관리">
        <SheetHandle onDown={onClose} />
        <div className="ms-head">
          <div>
            <h2>개발자 관리</h2>
          </div>
          <button type="button" className="bm-close" onClick={onClose}>
            닫기
          </button>
        </div>
        <dl className="dv-stats">
          {stats.map(([label, n]) => (
            <div key={label}>
              <dt>{label}</dt>
              <dd>{n === undefined ? '-' : n.toLocaleString('ko-KR')}</dd>
            </div>
          ))}
        </dl>
        <button type="button" className="dv-all" onClick={() => void unlockAll()}>
          모든 로그인 잠금 풀기
        </button>
        <div className="rf-seg" role="group" aria-label="목록 구분">
          <button type="button" className={tab === 'users' ? 'on' : ''} aria-pressed={tab === 'users'} onClick={() => setTab('users')}>
            계정
          </button>
          <button type="button" className={tab === 'reports' ? 'on' : ''} aria-pressed={tab === 'reports'} onClick={() => setTab('reports')}>
            신고
          </button>
        </div>
        {err && (
          <p className="rf-notice" role="alert">
            {err}
          </p>
        )}
        <ul className="dv-list">
          {tab === 'users' &&
            users.map((u) => (
              <li key={u.id}>
                <div className="dv-main">
                  <strong>
                    {u.name}
                    {u.role === 'dev' && <span className="dv-tag">개발자</span>}
                  </strong>
                  <small>
                    가입 {shortDate(u.createdAt)} · 신고 {u.reportCount}건
                  </small>
                </div>
                <div className="dv-acts">
                  <button type="button" className="dv-act" onClick={() => void unlock(u)} aria-label={`${u.name} 로그인 잠금 풀기`}>
                    잠금 풀기
                  </button>
                  <button type="button" className="dv-act" onClick={() => void newPin(u)} aria-label={`${u.name} PIN 다시 정하기`}>
                    PIN 다시 정하기
                  </button>
                  {u.id === myId ? (
                    <span className="dv-me">나</span>
                  ) : (
                    <button type="button" className="dv-del" onClick={() => void removeUser(u)} aria-label={`${u.name} 계정 지우기`}>
                      지우기
                    </button>
                  )}
                </div>
              </li>
            ))}
          {tab === 'reports' &&
            reports.map((r) => (
              <li key={r.id}>
                <div className="dv-main">
                  <strong>{r.type || '유형 없음'}</strong>
                  {r.text && <span className="dv-text">{r.text}</span>}
                  <small>
                    {r.authorName || '알 수 없음'} · {shortDate(r.createdAt)}
                    {r.hasPhoto ? ' · 사진 있음' : ''}
                  </small>
                </div>
                <button type="button" className="dv-del" onClick={() => void removeReport(r)} aria-label="이 신고 지우기">
                  지우기
                </button>
              </li>
            ))}
        </ul>
        {!busy && !err && (tab === 'users' ? users : reports).length === 0 && <p className="dv-empty">{tab === 'users' ? '계정이 없어요.' : '신고가 없어요.'}</p>}
        {more[tab] && (
          <button type="button" className="dv-more" onClick={() => void loadMore()} disabled={busy}>
            더 보기
          </button>
        )}
      </div>
      {shownPin && (
        <>
          <div className="ms-dim dv-pin-dim" onClick={closePin} />
          <div className="ms dv-pin" data-sheet role="dialog" aria-modal="true" aria-label="새 임시 PIN">
            <SheetHandle onDown={closePin} />
            <h2>{shownPin.name} 새 PIN</h2>
            <output className="dv-pin-num" aria-label={`새 PIN ${shownPin.pin.split('').join(' ')}`}>
              {shownPin.pin}
            </output>
            <p className="dv-pin-note">
              닫으면 다시 볼 수 없어요.{shownPin.self ? ' 닫으면 로그아웃되니 새 PIN으로 다시 로그인해 주세요.' : ''}
            </p>
            <div className="rf-actions">
              <button type="button" onClick={() => void copyPin()}>
                복사
              </button>
              <button type="button" className="rf-primary" onClick={closePin}>
                닫기
              </button>
            </div>
          </div>
        </>
      )}
    </>
  )
}

// 설정 시트의 한 행. role이 'dev'가 아니면 아무것도 그리지 않는다.
export default function DevAdmin() {
  const dev = useAccount((s) => s.user?.role === 'dev')
  const [open, setOpen] = useState(false)
  if (!dev) return null
  return (
    <li>
      <span>
        개발자 관리<small>계정·신고를 보고 지워요</small>
      </span>
      <button type="button" className="hm-tool hm-tool-row" aria-haspopup="dialog" aria-label="개발자 관리 열기" onClick={() => setOpen(true)}>
        <Icon name="chev" size={18} />
      </button>
      {open && createPortal(<AdminSheet onClose={() => setOpen(false)} />, sheetHost())}
    </li>
  )
}
