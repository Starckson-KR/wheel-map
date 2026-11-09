import { useMemo, useState } from 'react'
import { AdminDashboard, AdminPriority } from '../components/AdminDashboard'
import AdminRoute from '../components/AdminRoute'
import ReportDetail from '../components/ReportDetail'
import ViewSettings from '../components/ViewSettings'
import DemoTools, { MockStrip } from '../components/DemoTools'
import { findAgencyName } from '../lib/agencyName'
import { listAgencies } from '../lib/agencyGuide'
import { agencyOf, fmtDate, flagsOf, nextInspection, pendingTransfer, tabOf, type InboxTab } from '../lib/caseMetrics'
import { STATUS_LABEL, nowMs, useReports } from '../lib/reportStore'
import { loadBarriers } from '../lib/seed'
import type { Report } from '../types'

const BARRIERS = loadBarriers()
const BY_ID = new Map(BARRIERS.map((b) => [b.id, b]))

type Section = 'inbox' | 'route' | 'dash' | 'prio' | 'inspect'
const SECTIONS: { id: Section; label: string }[] = [
  { id: 'inbox', label: '민원함' },
  { id: 'route', label: '경로 보기' },
  { id: 'dash', label: '지역 현황' },
  { id: 'prio', label: '우선순위' },
  { id: 'inspect', label: '사후 점검' },
]
const TABS: { id: InboxTab; label: string }[] = [
  { id: 'new', label: '신규' },
  { id: 'doing', label: '처리 중' },
  { id: 'done', label: '조치 완료' },
  { id: 'transfer', label: '이관 요청' },
]

const caseName = (r: Report) => (r.seedId ? `${r.seedId} · ${BY_ID.get(r.seedId)?.name ?? ''}` : `${r.type} (시민 제보)`)

export default function AdminPage() {
  const reports = useReports((s) => s.reports)
  const userId = useReports((s) => s.userId)
  const offset = useReports((s) => s.offsetDays)
  const decideTransfer = useReports((s) => s.decideTransfer)
  const resetAll = useReports((s) => s.resetAll)
  const [section, setSection] = useState<Section>('inbox')
  const [tab, setTab] = useState<InboxTab>('new')
  const [agency, setAgency] = useState('')
  const [selected, setSelected] = useState<string | null>(null)
  const officer = userId === 'officer'
  void offset // 시간 앞당기기가 바뀌면 다시 계산
  const now = nowMs()

  const cases = reports.filter((r) => r.complaint)
  const scoped = useMemo(
    () =>
      cases.filter((r) => {
        if (!agency) return true
        const t = pendingTransfer(r)
        return agencyOf(r) === agency || t?.toAgencyId === agency
      }),
    [cases, agency],
  )
  const inTab = (t: InboxTab) =>
    scoped.filter((r) => {
      if (tabOf(r) !== t) return false
      if (!agency || t !== 'transfer') return !agency || agencyOf(r) === agency
      return true
    })
  const list = inTab(tab).slice().reverse()
  const overdue = scoped.filter((r) => flagsOf(r, now).some((f) => f.startsWith('처리기한'))).length

  const onReset = async () => {
    if (!window.confirm('시연 중에 만든 제보와 시연 데이터, 사진을 모두 지워요. 팀 조사 데이터는 그대로예요. 계속할까요?')) return
    setSelected(null)
    const err = await resetAll()
    if (err) window.alert(err)
  }

  const row = (r: Report) => {
    const t = pendingTransfer(r)
    const flags = flagsOf(r, now)
    const c = r.complaint
    return (
      <li key={r.id} className="adm-case">
        <button type="button" className={'adm-row' + (selected === r.id ? ' on' : '')} onClick={() => setSelected(r.id)}>
          <span className="adm-row-main">
            <strong>{caseName(r)}</strong>
            <span className="bm-meta">
              {r.type} · 접수 {c ? fmtDate(new Date(c.submittedAt).getTime()) : '—'} · 처리기한{' '}
              {c ? fmtDate(new Date(c.submittedAt).getTime() + c.deadlineDays * 86400000) : '—'} · {findAgencyName(agencyOf(r) ?? '')}
            </span>
            {t && (
              <span className="bm-meta">
                이관 요청: {findAgencyName(t.fromAgencyId)} → {findAgencyName(t.toAgencyId)} · 사유 {t.reason}
              </span>
            )}
          </span>
          <span className="adm-badges">
            <span className={'rp-badge rp-' + r.status}>{STATUS_LABEL[r.status]}</span>
            {flags.map((f) => (
              <span key={f} className="adm-flag">
                ⚠ {f}
              </span>
            ))}
            {r.demo && <span className="adm-demo">시연 데이터</span>}
          </span>
        </button>
        {t && officer && (!agency || t.toAgencyId === agency) && (
          <span className="adm-actions">
            <button type="button" className="rf-primary" onClick={() => decideTransfer(r.id, true)}>
              수락
            </button>
            <button type="button" onClick={() => decideTransfer(r.id, false)}>
              반려
            </button>
          </span>
        )}
      </li>
    )
  }

  const inspect = cases
    .filter((r) => r.lastCheckedAt)
    .map((r) => ({ r, ni: nextInspection(r, now) }))
    .filter((x): x is { r: Report; ni: NonNullable<ReturnType<typeof nextInspection>> } => !!x.ni)
    .sort((a, b) => a.ni.dueMs - b.ni.dueMs)

  return (
    <div className="bm adm">
      <header className="adm-top">
        <div className="adm-brand">
          <button type="button" onClick={() => (location.hash = '#/map')}>
            지도로
          </button>
          <h1>북구동행지도 · 행정</h1>
        </div>
        <div className="adm-top-tools">
          <MockStrip />
          <ViewSettings />
          <DemoTools page="admin" onReset={onReset} barriers={BARRIERS} />
        </div>
      </header>
      <div className="adm-main">
        <div className="adm-body">
          <div className="adm-wrap">
          <div className="adm-head">
            <h2>민원 처리 현황</h2>
            <span className="bm-meta">{officer ? '담당 공무원으로 보고 있어요. 처리 버튼을 쓸 수 있어요.' : '지금은 열람만 할 수 있어요. 처리 버튼은 시연 도구에서 담당 공무원으로 바꾸면 쓸 수 있어요.'}</span>
            {offset > 0 && <span className="adm-demo" style={{ alignSelf: 'flex-start' }}>앱 안 날짜 +{offset}일 (시간 앞당기기)</span>}
          </div>
          <div className="rp-tabs adm-sections" role="tablist" aria-label="행정 화면 구분">
            {SECTIONS.map((s) => (
              <button key={s.id} type="button" role="tab" aria-selected={section === s.id} className={section === s.id ? 'on' : ''} onClick={() => setSection(s.id)}>
                {s.label}
              </button>
            ))}
          </div>

          {section === 'inbox' && (
            <div className="adm-sec">
              <label className="rf-field adm-agency">
                담당 기관
                <select value={agency} onChange={(e) => setAgency(e.target.value)}>
                  <option value="">전체 기관</option>
                  {listAgencies().map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name}
                    </option>
                  ))}
                </select>
              </label>
              {overdue > 0 && (
                <p className="ps-flag" role="alert">
                  ⚠ 처리기한이 지난 민원이 {overdue}건 있어요.
                </p>
              )}
              <div className="rp-tabs" role="tablist" aria-label="민원 상태">
                {TABS.map((t) => (
                  <button key={t.id} type="button" role="tab" aria-selected={tab === t.id} className={tab === t.id ? 'on' : ''} onClick={() => setTab(t.id)}>
                    {t.label} ({inTab(t.id).length})
                  </button>
                ))}
              </div>
              {list.length === 0 ? (
                <p className="rp-empty">이 상태의 민원이 없어요.<br />접수된 민원이 없다면 시연 도구에서 '시연 데이터 채우기'를 눌러 보세요.</p>
              ) : (
                <ul className="rp-list">{list.map(row)}</ul>
              )}
              <span className="bm-meta">신규는 접수·배정만 되고 시작하기 전이에요. 처리 중은 조치 중, 조치 완료는 조치와 재확인을 마친 건이에요. 이관 요청은 수락을 기다리는 건이고, 보낸 기관과 받는 기관 모두에 보여요.</span>
            </div>
          )}

          {section === 'route' && <AdminRoute barriers={BARRIERS} onOpen={setSelected} />}
          {section === 'dash' && <AdminDashboard barriers={BARRIERS} />}
          {section === 'prio' && <AdminPriority barriers={BARRIERS} />}

          {section === 'inspect' && (
            <div className="adm-sec">
              <p className="bm-meta">마지막 점검일(조치를 마치거나 재확인을 통과하면 바뀌어요)에 주기를 더해 다음 점검일을 계산해요. 주기는 고정형 6개월, 일시형 1개월이에요.</p>
              {inspect.length === 0 ? (
                <p className="rp-empty">점검 기록이 있는 건이 없어요.</p>
              ) : (
                <ul className="rp-list">
                  {inspect.map(({ r, ni }) => (
                    <li key={r.id}>
                      <button type="button" className="adm-row" onClick={() => setSelected(r.id)}>
                        <span className="adm-row-main">
                          <strong>{caseName(r)}</strong>
                          <span className="bm-meta">
                            {r.type}({r.category === 'fixed' ? '고정형' : '일시형'}) · 마지막 점검 {fmtDate(ni.lastMs)} · 다음 점검 {fmtDate(ni.dueMs)}
                          </span>
                        </span>
                        <span className="adm-badges">
                          {ni.needed ? <span className="adm-flag">⚠ 점검이 필요해요</span> : <span className="rp-badge rp-rechecked">주기 안이에요</span>}
                          {r.demo && <span className="adm-demo">시연 데이터</span>}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
          </div>
        </div>

        {selected && (
          <ReportDetail
            key={selected}
            reportId={selected}
            seeds={BARRIERS}
            seedName={(id) => BY_ID.get(id)?.name ?? null}
            onClose={() => setSelected(null)}
            onOpenReport={setSelected}
            onOpenSeed={() => (location.hash = '#/map')}
          />
        )}
      </div>
    </div>
  )
}
