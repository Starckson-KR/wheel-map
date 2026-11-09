import { useEffect, useMemo, useState } from 'react'
import Icon from '../components/Icon'
import DemoTools, { MockStrip } from '../components/DemoTools'
import ViewSettings from '../components/ViewSettings'
import ReportsPanel from '../components/ReportsPanel'
import MyRewards from '../components/MyRewards'
import { listAgencies } from '../lib/agencyGuide'
import { TO, go } from '../lib/nav'
import { computeRewards } from '../lib/rewards'
import { nowMs, useReports, userName } from '../lib/reportStore'
import type { ReportStatus } from '../types'
import { loadBarriers } from '../lib/seed'

const BARRIERS = loadBarriers()

function Page({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bm pg">
      <div className="pg-scroll">
        <div className="pg-col">
          <MockStrip />
          <header className="pg-top">
            <h1 className="pg-brand">
              <button type="button" aria-label="북구동행지도 홈으로" onClick={() => go(TO.home)}>
                북구동행지도
              </button>
            </h1>
          </header>
          <h2 className="pg-title">{title}</h2>
          {children}
        </div>
      </div>
    </div>
  )
}

export function ReportTab({ query }: { query: string }) {
  const agencies = useMemo(() => listAgencies().filter((a) => a.verified), [])
  useEffect(() => {
    if (new URLSearchParams(query).get('section') === 'agency') document.getElementById('pg-agency')?.scrollIntoView({ block: 'start' })
  }, [query])
  return (
    <Page title="민원신고">
      <section className="pg-card">
        <h2>문제 신고하기</h2>
        <p className="bm-meta">길에서 만난 불편을 위치와 사진과 함께 남겨요.</p>
        <button type="button" className="rf-primary pg-wide" onClick={() => go(TO.newReport)}>
          문제 신고하기
        </button>
      </section>
      <section className="pg-card">
        <h2>내 민원 진행 상황</h2>
        <ReportsPanel embedded onOpen={(id) => go(TO.openReport(id))} />
      </section>
      <section className="pg-card" id="pg-agency" tabIndex={-1}>
        <h2>담당 기관 안내</h2>
        <p className="bm-meta">문제의 종류와 위치에 따라 맡은 기관이 달라요. 신고를 남기면 내 민원 상세에서 담당 기관과 접수 방법을 볼 수 있어요.</p>
        <ul className="pg-agencies">
          {agencies.map((a) => (
            <li key={a.id}>
              <strong>{a.name}</strong>
              {a.types.length > 0 && <span className="bm-meta">{a.types.join(' · ')}</span>}
            </li>
          ))}
        </ul>
      </section>
    </Page>
  )
}

export function MeTab() {
  const resetAll = useReports((s) => s.resetAll)
  const onReset = async () => {
    if (!window.confirm('시연 중에 만든 제보와 사진을 모두 지워요. 팀 조사 데이터는 그대로예요. 계속할까요?')) return
    const err = await resetAll()
    if (err) window.alert(err)
  }
  return (
    <Page title="내 정보">
      <section className="pg-card">
        <h2>설정</h2>
        <ul className="pg-set">
          <li>
            <span>
              화면 설정<small>다크·라이트, 앱·PC 보기</small>
            </span>
            <ViewSettings />
          </li>
          <li>
            <span>
              시연 도구<small>발표용 설정이에요</small>
            </span>
            <DemoTools page="map" onReset={onReset} barriers={BARRIERS} />
          </li>
          <li>
            <span>
              행정 화면<small>담당 공무원용 화면이에요</small>
            </span>
            <button type="button" className="hm-tool" onClick={() => go(TO.admin)}>
              열기
            </button>
          </li>
        </ul>
      </section>
      <section className="pg-card">
        <h2>내 기여</h2>
        <MyRewards embedded barriers={BARRIERS} onOpenReports={() => go(TO.report)} onOpenReport={(id) => go(TO.openReport(id))} />
      </section>
    </Page>
  )
}

type Alert = { key: string; at: string; kind: 'report' | 'points'; icon: string; text: string; points?: number; to: string }
type AlertFilter = 'all' | 'report' | 'points'
const FILTERS: { id: AlertFilter; label: string }[] = [
  { id: 'all', label: '전체' },
  { id: 'report', label: '민원' },
  { id: 'points', label: '참여 점수' },
]

// 민원 상태가 바뀐 기록을 한 줄 문장으로
const STATUS_TEXT: Partial<Record<ReportStatus, { icon: string; text: (t: string) => string }>> = {
  pending: { icon: 'clock', text: (t) => `${t} 제보가 검증을 기다리고 있어요` },
  verified: { icon: 'check', text: (t) => `${t} 제보가 검증됐어요` },
  filed: { icon: 'report', text: (t) => `${t} 민원이 접수됐어요` },
  assigned: { icon: 'building', text: (t) => `${t} 민원이 담당 기관에 배정됐어요` },
  in_progress: { icon: 'route', text: (t) => `${t} 문제를 조치하고 있어요` },
  resolved: { icon: 'check', text: (t) => `${t} 문제가 해결됐어요. 재확인을 기다려요` },
  rechecked: { icon: 'check', text: (t) => `${t} 조치 결과를 재확인했어요` },
  rejected: { icon: 'close', text: (t) => `${t} 제보가 반려됐어요` },
  merged: { icon: 'list', text: (t) => `${t} 제보가 같은 곳의 기존 건과 합쳐졌어요` },
}

function ago(iso: string): string {
  const diff = nowMs() - new Date(iso).getTime()
  const min = Math.floor(diff / 60000)
  if (min < 1) return '방금 전'
  if (min < 60) return `${min}분 전`
  const h = Math.floor(min / 60)
  if (h < 24) return `${h}시간 전`
  const d = Math.floor(h / 24)
  if (d < 30) return `${d}일 전`
  const m = Math.floor(d / 30)
  return m < 12 ? `${m}개월 전` : `${Math.floor(m / 12)}년 전`
}

export function AlertsTab() {
  const reports = useReports((s) => s.reports)
  const userId = useReports((s) => s.userId)
  const [filter, setFilter] = useState<AlertFilter>('all')
  const rw = useMemo(() => computeRewards(reports, [userId])[userId], [reports, userId])
  const items = useMemo(() => {
    const out: Alert[] = []
    for (const r of reports) {
      if (r.userId !== userId) continue
      r.history.forEach((h, i) => {
        const def = STATUS_TEXT[h.status]
        // 처음 제보한 기록과, 상태가 그대로인 메모(이관 등)는 알림으로 보여 주지 않는다
        if (!def || h.status === 'submitted' || (i > 0 && r.history[i - 1].status === h.status)) return
        out.push({ key: `s-${r.id}-${i}`, at: h.at, kind: 'report', icon: def.icon, text: def.text(r.type), to: TO.openReport(r.id) })
      })
    }
    for (const e of rw.events) {
      if (e.points <= 0) continue
      out.push({ key: `p-${e.id}`, at: e.at, kind: 'points', icon: 'star', text: e.label, points: e.points, to: TO.me })
    }
    return out.sort((a, b) => b.at.localeCompare(a.at))
  }, [reports, userId, rw])
  const shown = items.filter((x) => filter === 'all' || x.kind === filter).slice(0, 40)

  return (
    <Page title="혜택알림">
      <section className="pg-card al-sum" aria-label="참여 점수 요약">
        <div className="al-sum-main">
          <span className="al-sum-ic" aria-hidden="true"><Icon name="star" size={24} /></span>
          <div>
            <p className="bm-meta">{userName(userId)}의 참여 점수</p>
            <p className="pg-score"><b>{rw.total}</b>점 · {rw.title || '아직 칭호가 없어요'}</p>
          </div>
        </div>
        {rw.next && (
          <p className="bm-meta">다음 칭호 &apos;{rw.next.name}&apos;: {rw.next.how}</p>
        )}
        <button type="button" className="pg-wide" onClick={() => go(TO.me)}>내 기여 자세히 보기</button>
      </section>
      <section className="pg-card" aria-labelledby="al-h">
        <h2 id="al-h">알림</h2>
        <div className="al-chips" role="group" aria-label="알림 종류">
          {FILTERS.map((f) => (
            <button key={f.id} type="button" className="al-chip" aria-pressed={filter === f.id} onClick={() => setFilter(f.id)}>
              {f.label}
            </button>
          ))}
        </div>
        {shown.length === 0 ? (
          <p className="bm-meta al-empty">
            {filter === 'points'
              ? '아직 받은 참여 점수가 없어요. 제보가 검증되면 점수가 쌓여요.'
              : filter === 'report'
                ? '아직 민원 알림이 없어요. 문제를 신고하면 처리 상태가 바뀔 때마다 여기에 알려 드려요.'
                : '아직 받은 알림이 없어요. 문제를 신고하면 처리 상태와 참여 점수가 여기에 쌓여요.'}
          </p>
        ) : (
          <ul className="pg-lines">
            {shown.map((c) => (
              <li key={c.key}>
                <button type="button" className="pg-line al-item" onClick={() => go(c.to)}>
                  <span className={'al-ic al-ic-' + c.kind} aria-hidden="true"><Icon name={c.icon} size={18} /></span>
                  <span className="pg-line-t">
                    <strong>{c.text}</strong>
                    <span>{ago(c.at)}{c.points ? ` · +${c.points}점` : ''}</span>
                  </span>
                  <Icon name="chev" size={16} />
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </Page>
  )
}
