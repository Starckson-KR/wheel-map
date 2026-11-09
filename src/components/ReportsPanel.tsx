import { useState } from 'react'
import { ReportThumb } from './ReportPhotos'
import { STATUS_LABEL, isDone, useReports, userName } from '../lib/reportStore'
import type { Report } from '../types'

type Props = { onOpen: (id: string) => void; onClose?: () => void; embedded?: boolean }
type Tab = 'all' | 'doing' | 'done'
const TABS: { id: Tab; label: string }[] = [
  { id: 'all', label: '전체' },
  { id: 'doing', label: '진행 중' },
  { id: 'done', label: '완료' },
]

export default function ReportsPanel({ onOpen, onClose, embedded = false }: Props) {
  const reports = useReports((s) => s.reports)
  const userId = useReports((s) => s.userId)
  const [section, setSection] = useState<'mine' | 'todo'>('mine')
  const [tab, setTab] = useState<Tab>('all')

  const mine = reports.filter((r) => r.userId === userId)
  const shown = mine.filter((r) => tab === 'all' || (tab === 'done') === isDone(r.status)).slice().reverse()
  // 검증하기: 다른 사람의 검증 대기 제보
  const todo = reports.filter((r) => r.userId !== userId && r.status === 'pending').slice().reverse()

  const row = (r: Report) => (
    <li key={r.id}>
      <button type="button" className="rp-row" onClick={() => onOpen(r.id)}>
        <ReportThumb photoKey={r.photos[0]} alt={`${r.type} 제보 사진`} />
        <span className="rp-row-text">
          <strong>{r.type}</strong>
          <span className="rp-desc">{r.description}</span>
          <span className="bm-meta">
            {userName(r.userId)} · {new Date(r.createdAt).toLocaleString('ko-KR', { dateStyle: 'short', timeStyle: 'short' })}
          </span>
        </span>
        <span className={'rp-badge rp-' + r.status}>{STATUS_LABEL[r.status]}</span>
      </button>
    </li>
  )

  return (
    <div className={'rp' + (embedded ? ' rp--embedded' : '')} role={embedded ? 'region' : 'dialog'} aria-label="제보 현황">
      {!embedded && (
      <div className="rf-head">
        <h2>제보 현황</h2>
        <button type="button" className="bm-close" onClick={onClose}>
          닫기
        </button>
      </div>
      )}
      <div className="rf-seg" role="tablist" aria-label="구분">
        <button type="button" role="tab" aria-selected={section === 'mine'} className={section === 'mine' ? 'on' : ''} onClick={() => setSection('mine')}>
          내 제보 {mine.length}
        </button>
        <button type="button" role="tab" aria-selected={section === 'todo'} className={section === 'todo' ? 'on' : ''} onClick={() => setSection('todo')}>
          검증 대기 {todo.length}
        </button>
      </div>

      {section === 'mine' ? (
        <>
          <div className="rp-tabs" role="tablist" aria-label="상태 필터">
            {TABS.map((t) => (
              <button key={t.id} type="button" role="tab" aria-selected={tab === t.id} className={tab === t.id ? 'on' : ''} onClick={() => setTab(t.id)}>
                {t.label}
              </button>
            ))}
          </div>
          {shown.length === 0 ? (
            <p className="rp-empty">
              {tab === 'all' ? '아직 올린 제보가 없어요.' : '이 상태의 제보가 없어요.'}
              <br />
              지도에서 &apos;문제 제보하기&apos;를 눌러 첫 제보를 남겨 보세요.
            </p>
          ) : (
            <ul className="rp-list">{shown.map(row)}</ul>
          )}
          <p className="bm-meta">
            {userName(userId)}의 제보예요. 검증이 끝난 뒤의 접수·조치 단계는 &apos;진행 중&apos;으로 보여요. 합쳐지거나 반려된 제보, 재확인까지 끝난 제보는 &apos;완료&apos;예요.
          </p>
        </>
      ) : (
        <>
          {todo.length === 0 ? (
            <p className="rp-empty">검증을 기다리는 제보가 없어요.</p>
          ) : (
            <>
              <p className="bm-meta">다른 사용자가 올린 제보예요. 눌러서 확인하거나 검증할 수 있어요.</p>
              <ul className="rp-list">{todo.map(row)}</ul>
            </>
          )}
        </>
      )}
    </div>
  )
}
