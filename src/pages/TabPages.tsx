import { useEffect, useMemo, useRef, useState } from 'react'
import { AnimatePresence, m, useIsPresent } from 'motion/react'
import Icon from '../components/Icon'
import { RiseLi, SegBg } from '../components/motionKit'
import { useRiseOnce } from '../lib/useRiseOnce'
import { FADE, FADE_OUT } from '../lib/motionTokens'
import { MockStrip } from '../components/DemoTools'
import ReportsPanel from '../components/ReportsPanel'
import MyRewards from '../components/MyRewards'
import ParticipationRanking from '../components/ParticipationRanking'
import ParticipationChallenge from '../components/ParticipationChallenge'
import ReceiptLookup from '../components/ReceiptLookup'
import VerifyDeck from '../components/VerifyDeck'
import MyBenefits from '../components/MyBenefits'
import { listAgencies } from '../lib/agencyGuide'
import { TO, go } from '../lib/nav'
import { computeRewards } from '../lib/rewards'
import { nowMs, useReports } from '../lib/reportStore'
import type { ReportStatus } from '../types'
import { loadBarriers } from '../lib/seed'
import AccountCard from '../components/onboarding/AccountCard'
import { Sentences } from '../components/Sentences'
import { openGuide } from '../lib/usageGuide'
import { DATA_SOURCES } from '../lib/dataSources'
import { Wordmark } from '../components/Wordmark'
import { getMotionReduce } from '../lib/viewPrefs'
import { isMockReport } from '../lib/realFirst'

const BARRIERS = loadBarriers()

// 혜택알림의 구역 내용. 탭을 바꾸면 이전 내용은 짧게 사라지고(교차 페이드) 나가는 동안은 화면 읽기·키보드에서 빠진다.
function AlPanel({ tab, children }: { tab: string; children: React.ReactNode }) {
  const present = useIsPresent()
  return (
    <m.div
      id={present ? 'al-panel' : undefined}
      role="tabpanel"
      aria-labelledby={`al-tab-${tab}`}
      className="al-panel"
      inert={!present}
      aria-hidden={!present || undefined}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1, transition: FADE }}
      exit={{ opacity: 0, transition: FADE_OUT }}
    >
      {children}
    </m.div>
  )
}

const TOP_SHOW_PX = 480 // 이만큼 내려오면 「맨 위로」가 나타난다

// 오른쪽 아래 「맨 위로」 버튼. 스크롤 칸(.pg-scroll)이 어느 정도 내려갔을 때만 나타난다. 움직임 줄이기가 켜져 있으면 바로 올라간다.
function ScrollTopButton({ box }: { box: React.RefObject<HTMLDivElement | null> }) {
  const [show, setShow] = useState(false)
  useEffect(() => {
    const el = box.current
    if (!el) return
    const f = () => setShow(el.scrollTop > TOP_SHOW_PX)
    f()
    el.addEventListener('scroll', f, { passive: true })
    return () => el.removeEventListener('scroll', f)
  }, [box])
  return (
    <button
      type="button"
      className={'pg-top-btn' + (show ? ' on' : '')}
      aria-label="맨 위로"
      tabIndex={show ? 0 : -1}
      aria-hidden={!show}
      onClick={() => box.current?.scrollTo({ top: 0, behavior: getMotionReduce() ? 'auto' : 'smooth' })}
    >
      <Icon name="up" />
    </button>
  )
}

function Page({ title, children, toTop = false }: { title: string; children: React.ReactNode; toTop?: boolean }) {
  const box = useRef<HTMLDivElement>(null)
  return (
    <div className="bm pg">
      <div className="pg-scroll" ref={box}>
        <div className="pg-col">
          <MockStrip />
          <header className="pg-top">
            <h1 className="pg-brand">
              <button type="button" aria-label="이의있음 홈으로" onClick={() => go(TO.home)}>
                <Wordmark decorative />
              </button>
            </h1>
          </header>
          <h2 className="pg-title">{title}</h2>
          {children}
        </div>
      </div>
      {toTop && <ScrollTopButton box={box} />}
    </div>
  )
}

export function ReportTab({ query }: { query: string }) {
  const agencies = useMemo(() => listAgencies().filter((a) => a.verified), [])
  const [allAg, setAllAg] = useState(false)
  useEffect(() => {
    // 구역 이동: agency(담당 기관 안내), receipt(접수번호로 찾기), mine(내 제보 진행 상황), verify(이웃 제보 확인). AI 검색창이 이 주소로 안내한다.
    const id = ({ agency: 'pg-agency', receipt: 'pg-receipt', mine: 'pg-mine', verify: 'pg-verify' } as Record<string, string>)[new URLSearchParams(query).get('section') ?? '']
    if (!id) return
    const el = document.getElementById(id)
    el?.scrollIntoView({ block: 'start' })
    if (id === 'pg-receipt') document.getElementById('rl-q')?.focus({ preventScroll: true })
  }, [query])
  return (
    <Page title="제보" toTop>
      <section className="pg-card">
        <h2>길에서 만난 불편</h2>
        <p className="bm-meta">위치와 사진을 함께 남겨요</p>
        <button type="button" className="rf-primary pg-wide" onClick={() => go(TO.newReport)}>
          문제 제보하기
        </button>
      </section>
      <VerifyDeck />
      <section className="pg-card pg-flat" id="pg-receipt">
        <h2>접수번호로 찾기</h2>
        <ReceiptLookup onOpen={(id) => go(TO.openReport(id))} />
      </section>
      <section className="pg-card pg-flat" id="pg-mine">
        <h2>내 제보 진행 상황</h2>
        <ReportsPanel embedded onOpen={(id) => go(TO.openReport(id))} />
      </section>
      <section className="pg-card pg-flat" id="pg-agency" tabIndex={-1}>
        <h2>담당 기관 안내</h2>
        <Sentences as="p" className="bm-meta">제보하면 담당 기관과 접수 방법을 알려 드려요</Sentences>
        <ul className="pg-agencies">
          {(allAg ? agencies : agencies.slice(0, 5)).map((a) => (
            <li key={a.id}>
              <strong>{a.name}</strong>
              {a.types.length > 0 && <span className="bm-meta">{a.types.join(' · ')}</span>}
            </li>
          ))}
        </ul>
        {agencies.length > 5 && (
          <button type="button" className="pg-wide" aria-expanded={allAg} onClick={() => setAllAg((v) => !v)}>
            {allAg ? '접기' : `더보기 (${agencies.length - 5}곳)`}
          </button>
        )}
      </section>
    </Page>
  )
}

export function MeTab() {
  return (
    <Page title="내 정보">
      <AccountCard />
      <section className="pg-card">
        <h2>내 기여</h2>
        <MyRewards embedded barriers={BARRIERS} onOpenReports={() => go(TO.report)} onOpenReport={(id) => go(TO.openReport(id))} />
      </section>
      <section className="pg-card" aria-label="이용 안내">
        <ul className="pg-lines">
          <li>
            <button type="button" className="pg-line" aria-haspopup="dialog" onClick={openGuide}>
              <Icon name="help" size={20} />
              <span className="pg-line-t">
                <strong>이용 안내</strong>
              </span>
              <Icon name="chev" size={16} />
            </button>
          </li>
        </ul>
        <details className="pg-src">
          <summary>데이터 출처</summary>
          <ul>
            {DATA_SOURCES.map((t) => (
              <li key={t}>{t}</li>
            ))}
          </ul>
        </details>
      </section>
    </Page>
  )
}

type AlertsTabId = 'alerts' | 'benefits' | 'ranking' | 'challenge'
const ALERT_TABS: { id: AlertsTabId; label: string }[] = [
  { id: 'benefits', label: '혜택' },
  { id: 'alerts', label: '알림' },
  { id: 'ranking', label: '랭킹' },
  { id: 'challenge', label: '챌린지' },
]

type Alert = { key: string; at: string; kind: 'report' | 'points'; icon: string; text: string; points?: number; to: string; mock?: boolean }
type AlertFilter = 'all' | 'report' | 'points'
const FILTERS: { id: AlertFilter; label: string }[] = [
  { id: 'all', label: '전체' },
  { id: 'report', label: '제보' },
  { id: 'points', label: '참여 점수' },
]

// 민원 상태가 바뀐 기록을 한 줄 문장으로
const STATUS_TEXT: Partial<Record<ReportStatus, { icon: string; text: (t: string) => string }>> = {
  pending: { icon: 'clock', text: (t) => `${t} 제보가 검증을 기다리고 있어요` },
  verified: { icon: 'check', text: (t) => `${t} 제보가 검증됐어요` },
  filed: { icon: 'report', text: (t) => `${t} 제보가 접수됐어요` },
  assigned: { icon: 'building', text: (t) => `${t} 제보가 담당 기관에 배정됐어요` },
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

export function AlertsTab({ query = '' }: { query?: string }) {
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
        out.push({ key: `s-${r.id}-${i}`, at: h.at, kind: 'report', icon: def.icon, text: def.text(r.type), to: TO.openReport(r.id), ...(isMockReport(r) ? { mock: true } : {}) })
      })
    }
    const mockOf = new Map(reports.map((r) => [r.id, isMockReport(r)]))
    for (const e of rw.events) {
      if (e.points <= 0) continue
      out.push({ key: `p-${e.id}`, at: e.at, kind: 'points', icon: 'star', text: e.label, points: e.points, to: TO.me, ...(mockOf.get(e.reportId) ? { mock: true } : {}) })
    }
    return out.sort((a, b) => Number(!!a.mock) - Number(!!b.mock) || b.at.localeCompare(a.at)) // 실제 제보 알림이 체험 제보 알림보다 먼저
  }, [reports, userId, rw])
  const shown = items.filter((x) => filter === 'all' || x.kind === filter).slice(0, 40)
  // 한 화면에 한 구역: 혜택(기본) · 알림 · 랭킹 · 챌린지. 선택은 주소(#/alerts?tab=)에 둔다. 예전 진입(?section=benefits)은 혜택 탭으로 연다.
  const qs = new URLSearchParams(query)
  const tab: AlertsTabId = ALERT_TABS.find((t) => t.id === qs.get('tab'))?.id ?? 'benefits'
  const riseAlerts = useRiseOnce('alerts-list')
  const pickTab = (id: AlertsTabId) => {
    go(id === 'benefits' ? TO.alerts : `#/alerts?tab=${id}`)
  }

  return (
    <Page title="혜택알림">
      <div className="rf-seg al-seg" role="tablist" aria-label="혜택알림 구역">
        {ALERT_TABS.map((t) => (
          <button key={t.id} type="button" role="tab" id={`al-tab-${t.id}`} aria-selected={tab === t.id} aria-controls="al-panel" className={tab === t.id ? 'on' : ''} onClick={() => pickTab(t.id)}>
            {tab === t.id && <SegBg group="seg-alerts" />}
            {t.label}
          </button>
        ))}
      </div>
      <div style={{ position: 'relative' }}>
      <AnimatePresence mode="popLayout" initial={false}>
      <AlPanel key={tab} tab={tab}>
      {tab === 'benefits' && <MyBenefits />}
      {tab === 'ranking' && <ParticipationRanking />}
      {tab === 'challenge' && <ParticipationChallenge />}
      {tab === 'alerts' && (
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
          <div key={filter} className="al-empty">
            <Sentences as="p" className="bm-meta">{filter === 'points'
                ? '아직 받은 참여 점수가 없어요.'
                : filter === 'report'
                  ? '아직 제보 알림이 없어요.'
                  : '아직 받은 알림이 없어요.'}</Sentences>
            <div className="empty-act">
              <button type="button" className="pg-wide" onClick={() => go(filter === 'points' ? TO.map : TO.newReport)}>
                {filter === 'points' ? '지도 보기' : '문제 제보하러 가기'}
              </button>
            </div>
          </div>
        ) : (
          <ul key={filter} className="pg-lines">
            {shown.map((c, i) => (
              <RiseLi key={c.key} first={riseAlerts} i={i}>
                <button type="button" className="pg-line al-item" onClick={() => go(c.to)}>
                  <span className={'al-ic al-ic-' + c.kind} aria-hidden="true"><Icon name={c.icon} size={18} /></span>
                  <span className="pg-line-t">
                    <strong>{c.text}</strong>
                    <span>{ago(c.at)}{c.points ? ` · +${c.points}점` : ''}</span>
                  </span>
                  <Icon name="chev" size={16} />
                </button>
              </RiseLi>
            ))}
          </ul>
        )}
      </section>
      )}
      </AlPanel>
      </AnimatePresence>
      </div>
    </Page>
  )
}
