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
import { listAgencies, phoneParts, telHref } from '../lib/agencyGuide'
import { TO, go } from '../lib/nav'
import { computeRewards } from '../lib/rewards'
import { nowMs, useReports } from '../lib/reportStore'
import type { ReportStatus } from '../types'
import { loadBarriers } from '../lib/seed'
import AccountCard from '../components/onboarding/AccountCard'
import { Sentences } from '../components/Sentences'
import { openGuide } from '../lib/usageGuide'
import { Wordmark } from '../components/Wordmark'
import { getMotionReduce } from '../lib/viewPrefs'
import { isMockReport } from '../lib/realFirst'
import { sortAlerts } from '../lib/alertOrder'

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

// 제보 탭에서 접어 두는 구역. 주소(?section=)로 들어오면 그 구역을 펼친다.
type FoldId = 'receipt' | 'verify' | 'agency'
const foldOf = (query: string): FoldId | null => {
  const s = new URLSearchParams(query).get('section')
  return s === 'receipt' || s === 'verify' || s === 'agency' ? s : null
}

// 한 줄짜리 접기 머리: 누르면 아래 내용이 펼쳐진다
function FoldLine({ label, open, onToggle }: { label: string; open: boolean; onToggle: () => void }) {
  return (
    <button type="button" className="pg-line" aria-expanded={open} onClick={onToggle}>
      <span className="pg-line-t">
        <strong>{label}</strong>
      </span>
      <span className={'hp-nchev' + (open ? ' on' : '')}><Icon name="chev" size={16} /></span>
    </button>
  )
}

// 이미 확인된 번호(agencyGuide의 PHONES)만 걸 수 있게 한다. 없으면 undefined.
const callableTel = (phone?: string) => (phone ? phoneParts(phone).find((p) => p.tel)?.tel : undefined)

export function ReportTab({ query }: { query: string }) {
  const agencies = useMemo(() => listAgencies().filter((a) => a.verified), [])
  const [allAg, setAllAg] = useState(false)
  const mineN = useReports((s) => s.reports.filter((r) => r.userId === s.userId).length)
  // 펼친 구역. 주소가 바뀌면 그 주소의 구역을 더 펼친다(이미 펼친 것은 그대로).
  const [fold, setFold] = useState<{ q: string; open: Partial<Record<FoldId, boolean>> }>(() => {
    const f = foldOf(query)
    return { q: query, open: f ? { [f]: true } : {} }
  })
  if (fold.q !== query) {
    const f = foldOf(query)
    setFold({ q: query, open: f ? { ...fold.open, [f]: true } : fold.open })
  }
  const toggle = (id: FoldId) => setFold((v) => ({ ...v, open: { ...v.open, [id]: !v.open[id] } }))
  useEffect(() => {
    // 구역 이동: agency(담당 기관 안내), receipt(접수번호 찾기), mine(내 제보), verify(이웃 제보 확인). AI 검색창이 이 주소로 안내한다.
    const id = ({ agency: 'pg-agency', receipt: 'pg-receipt', mine: 'pg-mine', verify: 'pg-verify' } as Record<string, string>)[new URLSearchParams(query).get('section') ?? '']
    if (!id) return
    const el = document.getElementById(id)
    el?.scrollIntoView({ block: 'start' })
    if (id === 'pg-receipt') document.getElementById('rl-q')?.focus({ preventScroll: true })
  }, [query])
  return (
    <Page title="제보" toTop>
      <section className="pg-card">
        <button type="button" className="rf-primary pg-wide" onClick={() => go(TO.newReport)}>
          제보하기
        </button>
      </section>
      <section className="pg-card pg-flat" id="pg-mine">
        <h2>내 제보{mineN > 0 ? ` ${mineN}건` : ''}</h2>
        <ReportsPanel embedded limit={3} onOpen={(id) => go(TO.openReport(id))} />
        <div id="pg-receipt" className="pg-fold">
          <FoldLine label="접수번호 찾기" open={!!fold.open.receipt} onToggle={() => toggle('receipt')} />
          {fold.open.receipt && <ReceiptLookup onOpen={(id) => go(TO.openReport(id))} />}
        </div>
      </section>
      <VerifyDeck open={!!fold.open.verify} onToggle={() => toggle('verify')} />
      <section className="pg-card pg-flat" id="pg-agency" tabIndex={-1} aria-label="담당 기관 안내">
        <FoldLine label="담당 기관 안내" open={!!fold.open.agency} onToggle={() => toggle('agency')} />
        {fold.open.agency && (
          <>
            <ul className="pg-agencies">
              {(allAg ? agencies : agencies.slice(0, 5)).map((a) => (
                <li key={a.id}>
                  <strong>{a.name}</strong>
                  {a.types.length > 0 && <span className="bm-meta">{a.types.join(' · ')}</span>}
                  {callableTel(a.phone) && (
                    <a className="cg-tel" href={telHref(callableTel(a.phone)!)} aria-label={`${a.name}에 전화 걸기 ${callableTel(a.phone)}`}>
                      ☎ {callableTel(a.phone)}
                    </a>
                  )}
                </li>
              ))}
            </ul>
            {agencies.length > 5 && (
              <button type="button" className="pg-wide" aria-expanded={allAg} onClick={() => setAllAg((v) => !v)}>
                {allAg ? '접기' : `더보기 (${agencies.length - 5}곳)`}
              </button>
            )}
          </>
        )}
      </section>
    </Page>
  )
}

// 내 정보 「내 기여」 아래에 접어 두는 구역. 주소(#/me?section=)로 들어오면 그 구역을 펼친다.
type MeFoldId = 'ranking' | 'challenge'
const meFoldOf = (query: string): MeFoldId | null => {
  const s = new URLSearchParams(query).get('section')
  return s === 'ranking' || s === 'challenge' ? s : null
}

export function MeTab({ query = '' }: { query?: string }) {
  const [fold, setFold] = useState<{ q: string; open: Partial<Record<MeFoldId, boolean>> }>(() => {
    const f = meFoldOf(query)
    return { q: query, open: f ? { [f]: true } : {} }
  })
  if (fold.q !== query) {
    const f = meFoldOf(query)
    setFold({ q: query, open: f ? { ...fold.open, [f]: true } : fold.open })
  }
  const toggle = (id: MeFoldId) => setFold((v) => ({ ...v, open: { ...v.open, [id]: !v.open[id] } }))
  useEffect(() => {
    const f = meFoldOf(query)
    if (f) document.getElementById('pg-' + f)?.scrollIntoView({ block: 'start' })
  }, [query])
  return (
    <Page title="내 정보">
      <AccountCard />
      <section className="pg-card">
        <h2>내 기여</h2>
        <MyRewards embedded barriers={BARRIERS} onOpenReport={(id) => go(TO.openReport(id))} />
        <div id="pg-ranking" className="pg-fold">
          <FoldLine label="랭킹" open={!!fold.open.ranking} onToggle={() => toggle('ranking')} />
          {fold.open.ranking && <ParticipationRanking bare />}
        </div>
        <div id="pg-challenge" className="pg-fold">
          <FoldLine label="챌린지" open={!!fold.open.challenge} onToggle={() => toggle('challenge')} />
          {fold.open.challenge && <ParticipationChallenge bare />}
        </div>
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
      </section>
    </Page>
  )
}

type AlertsTabId = 'alerts' | 'benefits'
const ALERT_TABS: { id: AlertsTabId; label: string }[] = [
  { id: 'benefits', label: '혜택' },
  { id: 'alerts', label: '알림' },
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
  pending: { icon: 'clock', text: (t) => `${t} 제보가 확인을 기다리고 있어요` },
  verified: { icon: 'check', text: (t) => `${t} 제보가 확인됐어요` },
  filed: { icon: 'report', text: (t) => `${t} 제보가 접수됐어요` },
  assigned: { icon: 'building', text: (t) => `${t} 제보가 담당 기관에 배정됐어요` },
  in_progress: { icon: 'route', text: (t) => `${t} 조치를 시작했어요` },
  resolved: { icon: 'check', text: (t) => `${t} 조치가 끝났어요. 재확인을 기다려요` },
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
    return sortAlerts(out) // 실제 제보 알림이 체험 제보 알림보다 먼저, 묶음 안에서는 최신이 위
  }, [reports, userId, rw])
  const shown = items.filter((x) => filter === 'all' || x.kind === filter).slice(0, 40)
  // 한 화면에 한 구역: 혜택(기본) · 알림. 선택은 주소(#/alerts?tab=)에 둔다. 예전 진입(?section=benefits)은 혜택 탭으로 연다.
  const qs = new URLSearchParams(query)
  // 랭킹·챌린지는 내 정보 「내 기여」로 옮겼다. 예전 주소(#/alerts?tab=ranking|challenge)는 그쪽으로 넘긴다.
  const moved = meFoldOf('section=' + (qs.get('tab') ?? ''))
  useEffect(() => {
    if (moved) location.replace(TO.meSection(moved))
  }, [moved])
  const tab: AlertsTabId = ALERT_TABS.find((t) => t.id === qs.get('tab'))?.id ?? 'benefits'
  const riseAlerts = useRiseOnce('alerts-list')
  const pickTab = (id: AlertsTabId) => {
    go(id === 'benefits' ? TO.alerts : `#/alerts?tab=${id}`)
  }

  if (moved) return null
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
      {tab === 'alerts' && rw.next && (
      <section className="pg-card al-next" aria-labelledby="al-next-h">
        <p className="al-next-cap">다음 칭호</p>
        <h3 id="al-next-h">{rw.next.name}</h3>
        {rw.next.progress.slice(0, 1).map((p) => (
          <div key={p.label} className="al-next-main">
            <span className="al-next-bar" role="progressbar" aria-valuemin={0} aria-valuemax={p.need} aria-valuenow={Math.min(p.now, p.need)} aria-label={p.label}>
              <i style={{ width: `${Math.min(1, p.now / p.need) * 100}%` }} />
            </span>
            <p className="al-next-frac"><span>{p.label}</span><b>{Math.min(p.now, p.need)}/{p.need}</b></p>
          </div>
        ))}
        {rw.next.progress.slice(1).map((p) => (
          <div key={p.label} className="rw-bar al-next-sub">
            <span>{rw.next?.anyOf ? '또는 ' : ''}{p.label}</span>
            <span className="rw-bar-t" role="progressbar" aria-valuemin={0} aria-valuemax={p.need} aria-valuenow={Math.min(p.now, p.need)} aria-label={p.label}>
              <i style={{ transform: `scaleX(${Math.min(1, p.now / p.need)})` }} />
            </span>
            <b>{Math.min(p.now, p.need)}/{p.need}</b>
          </div>
        ))}
      </section>
      )}
      {tab === 'alerts' && (
      <section className="pg-card" aria-label="알림">
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
                {filter === 'points' ? '지도 보기' : '제보하기'}
              </button>
            </div>
          </div>
        ) : (
          <ul key={filter} className="al-rail">
            {shown.map((c, i) => {
              const when = ago(c.at)
              // 바로 윗줄과 같은 때면 때를 되풀이하지 않는다(화면 읽기에는 줄마다 읽어 준다)
              const same = i > 0 && ago(shown[i - 1].at) === when
              return (
                <RiseLi key={c.key} first={riseAlerts} i={i} className={i === 0 ? 'on' : undefined}>
                  <button type="button" className="al-row" aria-label={`${when}, ${c.text}${c.points ? `, +${c.points}점` : ''}`} onClick={() => go(c.to)}>
                    <span className={'al-when' + (i === 0 ? '' : ' soft')}>{same ? '' : when}</span>
                    <span className="al-what">
                      <span className="pg-line-t"><strong>{c.text}</strong></span>
                      {c.points ? <b className="al-plus">+{c.points}점</b> : null}
                    </span>
                  </button>
                </RiseLi>
              )
            })}
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
