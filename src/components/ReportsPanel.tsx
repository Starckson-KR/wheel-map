import { useState } from 'react'
import { go, TO } from '../lib/nav'
import { ReportThumb } from './ReportPhotos'
import { RiseLi, SegBg } from './motionKit'
import { useRiseOnce } from '../lib/useRiseOnce'
import { STATUS_LABEL, isDone, useReports, userName } from '../lib/reportStore'
import { coordText, useVisibleAddress } from '../lib/addressCache'
import { isSampleReport } from '../lib/samplePhotos'
import { realFirstReports } from '../lib/realFirst'
import type { Report } from '../types'
import { Sentences } from './Sentences'
import '../styles/review.css'

type Props = { onOpen: (id: string) => void; onClose?: () => void; embedded?: boolean }
type Tab = 'all' | 'doing' | 'done'
const TABS: { id: Tab; label: string }[] = [
  { id: 'all', label: '전체' },
  { id: 'doing', label: '진행 중' },
  { id: 'done', label: '완료' },
]

const fmtShort = (iso: string) => new Date(iso).toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: 'numeric', minute: '2-digit' })

// 목록 한 줄: 유형 · 주소(보이는 항목만 조회) · 접수일 · 상태가 모두 달라서 서로 구분된다.
function ReportRow({ r, i, first, onOpen }: { r: Report; i: number; first: boolean; onOpen: (id: string) => void }) {
  const [ref, addr] = useVisibleAddress<HTMLLIElement>(r.lat, r.lng)
  const place = addr.short ?? (addr.status === 'loading' ? '주소를 찾고 있어요…' : (r.locationKind ?? coordText(r.lat, r.lng)))
  return (
    <RiseLi ref={ref} first={first} i={i}>
      <button type="button" className="rp-row" onClick={() => onOpen(r.id)}>
        <ReportThumb photoKey={r.photos[0]} alt={`${r.type} 제보 사진`} />
        <span className="rp-row-text">
          <strong>{r.type}</strong>
          <span className="rv-addr">{place}</span>
          <span className="rp-desc">{r.description}</span>
          <span className="bm-meta">
            {userName(r.userId)} · {fmtShort(r.createdAt)} 접수{isSampleReport(r) ? ' · 샘플 사진' : ''}
          </span>
        </span>
        <span className={'rp-badge rp-' + r.status}>{STATUS_LABEL[r.status]}</span>
      </button>
    </RiseLi>
  )
}

export default function ReportsPanel({ onOpen, onClose, embedded = false }: Props) {
  const reports = useReports((s) => s.reports)
  const userId = useReports((s) => s.userId)
  const [section, setSection] = useState<'mine' | 'todo'>('mine')
  const [tab, setTab] = useState<Tab>('all')

  const mine = reports.filter((r) => r.userId === userId)
  const shown = realFirstReports(mine.filter((r) => tab === 'all' || (tab === 'done') === isDone(r.status)).slice().reverse())
  // 검증하기: 다른 사람의 검증 대기 제보
  const todo = realFirstReports(reports.filter((r) => r.userId !== userId && r.status === 'pending').slice().reverse())

  const riseRows = useRiseOnce('reports-panel')
  const row = (r: Report, i: number) => <ReportRow key={r.id} r={r} i={i} first={riseRows} onOpen={onOpen} />

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
          {section === 'mine' && <SegBg group="seg-reports" />}
          내 제보 {mine.length}
        </button>
        <button type="button" role="tab" aria-selected={section === 'todo'} className={section === 'todo' ? 'on' : ''} onClick={() => setSection('todo')}>
          {section === 'todo' && <SegBg group="seg-reports" />}
          검증 대기 {todo.length}
        </button>
      </div>

      {section === 'mine' ? (
        <>
          <div className="rp-tabs rp-tabs--chips" role="tablist" aria-label="상태 필터">
            {TABS.map((t) => (
              <button key={t.id} type="button" role="tab" aria-selected={tab === t.id} className={tab === t.id ? 'on' : ''} onClick={() => setTab(t.id)}>
                {t.label}
              </button>
            ))}
          </div>
          {shown.length === 0 ? (
            <div className="rp-empty">
              <p>
                {tab === 'all' ? '아직 올린 제보가 없어요.' : '이 상태의 제보가 없어요.'}
                <br />
                {tab === 'all' ? '첫 제보를 남겨 보세요.' : '다른 상태 탭을 눌러 보세요.'}
              </p>
              {tab === 'all' && (
                <div className="empty-act">
                  <button type="button" className="rf-primary" onClick={() => go(TO.newReport)}>문제 신고하러 가기</button>
                </div>
              )}
            </div>
          ) : (
            <ul className="rp-list">{shown.map(row)}</ul>
          )}
        </>
      ) : (
        <>
          {todo.length === 0 ? (
            <div className="rp-empty">
              <p>검증을 기다리는 제보가 없어요.</p>
              <div className="empty-act">
                <button type="button" className="rf-primary" onClick={() => go(TO.map)}>지도 보기</button>
              </div>
            </div>
          ) : (
            <>
              <Sentences as="p" className="bm-meta">다른 사용자가 올린 제보예요. 눌러서 확인하거나 검증할 수 있어요.</Sentences>
              <ul className="rp-list">{todo.map(row)}</ul>
            </>
          )}
        </>
      )}
    </div>
  )
}
