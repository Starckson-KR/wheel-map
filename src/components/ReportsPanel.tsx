import { Fragment, useState } from 'react'
import { go, TO } from '../lib/nav'
import { ReportThumb } from './ReportPhotos'
import { RiseLi, SegBg, Swap } from './motionKit'
import { useRiseOnce } from '../lib/useRiseOnce'
import { STATUS_LABEL, isDone, useReports, userName } from '../lib/reportStore'
import { coordText, useVisibleAddress } from '../lib/addressCache'
import { isSampleReport } from '../lib/samplePhotos'
import { realFirstReports } from '../lib/realFirst'
import type { Report } from '../types'
import { fmtDateTime } from '../lib/format'
import { Sentences } from './Sentences'
import '../styles/review.css'

/** limit: 탭 화면에 끼울 때 처음 보여 줄 건수. 넘으면 「전체 보기」로 펼친다 */
type Props = { onOpen: (id: string) => void; onClose?: () => void; embedded?: boolean; limit?: number }
type Tab = 'all' | 'doing' | 'done'
const TABS: { id: Tab; label: string }[] = [
  { id: 'all', label: '전체' },
  { id: 'doing', label: '진행 중' },
  { id: 'done', label: '완료' },
]

// 예전에 채운 체험 제보의 설명 머리(「(시연) 팀 현장조사 지점 R16 · 」)는 목록에서 보이지 않게 한다.
const DEMO_HEAD = '(시연) 팀 현장조사 지점 '
const rowDesc = (d: string) => (d.startsWith(DEMO_HEAD) && d.includes(' · ') ? d.slice(d.indexOf(' · ') + 3) : d)

// 목록 한 줄: 장소(주소, 보이는 항목만 조회) · 유형(장소를 모르면 유형만) · 접수일 · 상태가 모두 달라서 서로 구분된다.
function ReportRow({ r, i, first, onOpen }: { r: Report; i: number; first: boolean; onOpen: (id: string) => void }) {
  const [ref, addr] = useVisibleAddress<HTMLLIElement>(r.lat, r.lng)
  const me = useReports((s) => s.userId)
  const place = addr.short ?? (addr.status === 'loading' ? '' : (r.locationKind ?? coordText(r.lat, r.lng)))
  return (
    <RiseLi ref={ref} first={first} i={i}>
      <button type="button" className="rp-row" onClick={() => onOpen(r.id)}>
        <ReportThumb photoKey={r.photos[0]} alt={`${r.type} 제보 사진`} />
        <span className="rp-row-text">
          <strong>{place || r.type}</strong>
          {place && <span className="rv-addr">{r.type}</span>}
          {r.description && <span className="rp-desc">{rowDesc(r.description)}</span>}
          <span className="bm-meta">
            {r.userId === me ? userName(r.userId) : '이웃 제보'} · {fmtDateTime(r.createdAt)} 접수{isSampleReport(r) ? ' · 샘플 사진' : ''}
          </span>
        </span>
        <span className={'rp-badge rp-' + r.status}><Swap k={r.status}>{STATUS_LABEL[r.status]}</Swap></span>
      </button>
    </RiseLi>
  )
}

export default function ReportsPanel({ onOpen, onClose, embedded = false, limit }: Props) {
  const reports = useReports((s) => s.reports)
  const userId = useReports((s) => s.userId)
  const [section, setSection] = useState<'mine' | 'todo'>('mine')
  const [tab, setTab] = useState<Tab>('all')
  const [full, setFull] = useState(false)

  const mine = reports.filter((r) => r.userId === userId)
  // 탭 화면: 처음에는 최근 몇 건만(상태 필터 없이), 「전체 보기」를 누르면 필터와 전체 목록
  const folds = embedded && limit !== undefined && mine.length > limit
  const brief = folds && !full
  const filtered = realFirstReports(mine.filter((r) => brief || tab === 'all' || (tab === 'done') === isDone(r.status)).slice().reverse())
  const shown = brief ? filtered.slice(0, limit) : filtered
  // 검증하기: 다른 사람의 검증 대기 제보
  const todo = realFirstReports(reports.filter((r) => r.userId !== userId && r.status === 'pending').slice().reverse())

  const riseRows = useRiseOnce('reports-panel')
  const row = (r: Report, i: number) => <ReportRow key={r.id} r={r} i={i} first={riseRows} onOpen={onOpen} />

  return (
    <div className={'rp' + (embedded ? ' rp--embedded' : '')} role={embedded ? 'region' : 'dialog'} aria-label={embedded ? '내 제보' : '제보 현황'}>
      {!embedded && (
      <div className="rf-head">
        <h2>제보 현황</h2>
        <button type="button" className="bm-close" onClick={onClose}>
          닫기
        </button>
      </div>
      )}
      {!embedded && (
      <div className="rf-seg" role="tablist" aria-label="구분">
        <button type="button" role="tab" aria-selected={section === 'mine'} className={section === 'mine' ? 'on' : ''} onClick={() => setSection('mine')}>
          {section === 'mine' && <SegBg group="seg-reports" />}
          내 제보 {mine.length}
        </button>
        <button type="button" role="tab" aria-selected={section === 'todo'} className={section === 'todo' ? 'on' : ''} onClick={() => setSection('todo')}>
          {section === 'todo' && <SegBg group="seg-reports" />}
          확인 대기 {todo.length}
        </button>
      </div>
      )}

      {embedded || section === 'mine' ? (
        <Fragment key="mine">
          {!brief && (!embedded || folds) && (
          <div className="rp-tabs rp-tabs--chips" role="tablist" aria-label="상태 필터">
            {TABS.map((t) => (
              <button key={t.id} type="button" role="tab" aria-selected={tab === t.id} className={tab === t.id ? 'on' : ''} onClick={() => setTab(t.id)}>
                {t.label}
              </button>
            ))}
          </div>
          )}
          {shown.length === 0 && embedded && tab === 'all' ? (
            <p className="bm-meta">아직 올린 제보가 없어요.</p>
          ) : shown.length === 0 ? (
            <div key={tab} className="rp-empty">
              <p>
                {tab === 'all' ? '아직 올린 제보가 없어요.' : '이 상태의 제보가 없어요.'}
                <br />
                {tab === 'all' ? '첫 제보를 남겨 보세요.' : '다른 상태 탭을 눌러 보세요.'}
              </p>
              {tab === 'all' && (
                <div className="empty-act">
                  <button type="button" className="rf-primary" onClick={() => go(TO.newReport)}>제보하기</button>
                </div>
              )}
            </div>
          ) : (
            <ul key={tab} className="rp-list">{shown.map(row)}</ul>
          )}
          {folds && (
            <button type="button" className="pg-wide" aria-expanded={full} onClick={() => setFull((v) => !v)}>
              {full ? '접기' : `전체 보기 (${mine.length}건)`}
            </button>
          )}
        </Fragment>
      ) : (
        <Fragment key="todo">
          {todo.length === 0 ? (
            <div className="rp-empty">
              <p>확인을 기다리는 제보가 없어요.</p>
              <div className="empty-act">
                <button type="button" className="rf-primary" onClick={() => go(TO.map)}>지도 보기</button>
              </div>
            </div>
          ) : (
            <>
              <Sentences as="p" className="bm-meta">다른 사용자가 올린 제보예요. 눌러서 확인할 수 있어요.</Sentences>
              <ul className="rp-list">{todo.map(row)}</ul>
            </>
          )}
        </Fragment>
      )}
    </div>
  )
}
