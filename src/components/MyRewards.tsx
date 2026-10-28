import { useMemo, useState } from 'react'
import RewardEmblem from './RewardEmblem'
import { DEMO_USERS, useReports, userName } from '../lib/reportStore'
import { REWARD_DAILY_CAP } from '../lib/config'
import { GRADE_EMBLEMS, SPECIAL_EMBLEM, TYPE_EMBLEMS, changedRoads, computeRewards, type PointEvent } from '../lib/rewards'
import type { Barrier, Report } from '../types'

type Props = { barriers: Barrier[]; onOpenReports: () => void; onOpenReport: (id: string) => void; onClose: () => void }
type Tab = 'title' | 'points' | 'roads'
const TABS: { id: Tab; label: string }[] = [
  { id: 'title', label: '칭호·엠블럼' },
  { id: 'points', label: '점수 내역' },
  { id: 'roads', label: '내가 바꾼 길' },
]

const fmtDate = (iso: string) => new Date(iso).toLocaleDateString('ko-KR', { month: 'long', day: 'numeric' })
const pct = (v: number | null) => (v === null ? '자료 없음' : `${Math.round(v * 100)}%`)

// 명세서 4-2(3)의 내 제보 구분: 검증 대기 / 민원 접수 / 조치 완료
function groupCounts(mine: Report[]) {
  const g = { wait: 0, filed: 0, done: 0, other: 0 }
  for (const r of mine) {
    if (r.status === 'submitted' || r.status === 'pending') g.wait++
    else if (r.status === 'verified' || r.status === 'filed' || r.status === 'assigned' || r.status === 'in_progress') g.filed++
    else if (r.status === 'resolved' || r.status === 'rechecked') g.done++
    else g.other++
  }
  return g
}

export default function MyRewards({ barriers, onOpenReports, onOpenReport, onClose }: Props) {
  const reports = useReports((s) => s.reports)
  const userId = useReports((s) => s.userId)
  const [tab, setTab] = useState<Tab>('title')

  const rw = useMemo(() => computeRewards(reports, [userId])[userId], [reports, userId])
  const roads = useMemo(() => changedRoads(userId, reports, barriers), [reports, userId, barriers])
  const mine = reports.filter((r) => r.userId === userId)
  const g = groupCounts(mine)
  const role = DEMO_USERS.find((u) => u.id === userId)?.role
  const titleEmb = rw.grade > 0 ? GRADE_EMBLEMS[rw.grade - 1] : null
  const events: PointEvent[] = rw.events.slice().reverse()

  return (
    <div className="rp rw" role="dialog" aria-label="내 기여">
      <div className="rf-head">
        <h2>내 기여</h2>
        <button type="button" className="bm-close" onClick={onClose}>
          닫기
        </button>
      </div>

      <section className="rw-hero" aria-label="칭호와 점수">
        {titleEmb ? <RewardEmblem def={titleEmb} size="lg" /> : <span className="emb emb-lg is-empty" aria-hidden="true">🌱</span>}
        <div className="rw-hero-text">
          <p className="bm-meta">{userName(userId)}</p>
          <h3>{rw.title || '아직 칭호가 없어요'}</h3>
          <p className="rw-score">
            <b>{rw.total}</b>점
          </p>
        </div>
      </section>
      {role === 'officer' && <p className="bm-meta">담당 공무원은 점수를 쌓지 않아요. 시민 사용자로 바꿔서 보세요.</p>}
      {rw.grade === 0 && role !== 'officer' && <p className="rw-lead">검증된 제보가 생기면 첫 칭호를 받아요. 점수는 검증이 끝난 뒤에만 쌓여요.</p>}

      <div className="rp-tabs" role="tablist" aria-label="내 기여 보기">
        {TABS.map((t) => (
          <button key={t.id} type="button" role="tab" aria-selected={tab === t.id} className={tab === t.id ? 'on' : ''} onClick={() => setTab(t.id)}>
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'title' && (
        <>
          {rw.next && (
            <section className="rw-next">
              <h4>
                다음 칭호 &apos;{rw.next.name}&apos;까지
              </h4>
              <p className="bm-meta">{rw.next.how}{rw.next.anyOf ? ' (둘 중 하나)' : ''}</p>
              {rw.next.progress.map((p) => (
                <div key={p.label} className="rw-bar">
                  <span>{p.label}</span>
                  <span className="rw-bar-t" role="progressbar" aria-valuemin={0} aria-valuemax={p.need} aria-valuenow={Math.min(p.now, p.need)} aria-label={p.label}>
                    <i style={{ width: `${Math.min(100, (p.now / p.need) * 100)}%` }} />
                  </span>
                  <b>
                    {Math.min(p.now, p.need)}/{p.need}
                  </b>
                </div>
              ))}
              {rw.next.note && <p className="bm-meta">{rw.next.note}</p>}
            </section>
          )}
          <section>
            <h4>엠블럼 진열장</h4>
            <ul className="rw-grid">
              {[...GRADE_EMBLEMS, SPECIAL_EMBLEM, ...TYPE_EMBLEMS].map((e) => {
                const has = rw.earned.includes(e.id)
                return (
                  <li key={e.id} className={has ? 'is-on' : ''}>
                    <RewardEmblem def={e} earned={has} />
                    <strong>{e.name}</strong>
                    <span>{has ? '받았어요' : e.how}</span>
                  </li>
                )
              })}
            </ul>
            <p className="bm-meta">칭호와 엠블럼 이름, 받는 조건은 모두 안(案)이에요. 팀 회의에서 확정해요. 엠블럼 그림도 임시예요.</p>
          </section>
          <section>
            <h4>내 제보</h4>
            <div className="rw-stats">
              <div>
                <b>{g.wait}</b>
                <span>검증 대기</span>
              </div>
              <div>
                <b>{g.filed}</b>
                <span>민원 접수·진행</span>
              </div>
              <div>
                <b>{g.done}</b>
                <span>조치 완료</span>
              </div>
            </div>
            {g.other > 0 && <p className="bm-meta">합쳐지거나 반려된 제보 {g.other}건은 위 숫자에 넣지 않았어요.</p>}
            <button type="button" className="hm-cta-sub rw-link" onClick={onOpenReports}>
              내 제보 보기
            </button>
          </section>
        </>
      )}

      {tab === 'points' && (
        <section>
          {events.length === 0 ? (
            <p className="rp-empty">아직 쌓인 점수가 없어요.<br />제보가 검증되거나 다른 분의 제보를 확인하면 점수가 쌓여요.</p>
          ) : (
            <ul className="rw-events">
              {events.map((e) => (
                <li key={e.id}>
                  <button type="button" className="rw-ev" onClick={() => onOpenReport(e.reportId)}>
                    <span className="rw-ev-text">
                      <strong>{e.label}</strong>
                      <span className="bm-meta">{fmtDate(e.at)}{e.points < e.base ? ` · 하루 상한(${REWARD_DAILY_CAP}점)으로 ${e.points}점만 받았어요` : ''}</span>
                    </span>
                    <b className={e.points > 0 ? 'rw-plus' : 'rw-zero'}>{e.points > 0 ? `+${e.points}` : '0'}점</b>
                  </button>
                </li>
              ))}
            </ul>
          )}
          <p className="bm-meta">점수는 제보 기록에서 계산해요. 하루에 받을 수 있는 점수는 {REWARD_DAILY_CAP}점까지예요(안).</p>
        </section>
      )}

      {tab === 'roads' && (
        <section>
          {roads.length === 0 ? (
            <p className="rp-empty">아직 바꾼 길이 없어요.<br />내 제보가 조치된 뒤 재확인을 통과하면 여기에 모여요.</p>
          ) : (
            <ul className="rw-events">
              {roads.map((c) => (
                <li key={c.reportId}>
                  <button type="button" className="rw-ev" onClick={() => onOpenReport(c.reportId)}>
                    <span className="rw-ev-text">
                      <strong>{c.place}</strong>
                      <span className="bm-meta">{fmtDate(c.at)} 재확인을 통과해서 지도에 ○로 바뀌었어요</span>
                      {c.routeName ? (
                        <span className="rw-route">
                          {c.routeName}
                          <br />
                          통과 가능 구간 비율 <b>{pct(c.before)}</b> → <b>{pct(c.after)}</b>
                        </span>
                      ) : (
                        <span className="bm-meta">어느 경로에도 속하지 않은 지점이에요.</span>
                      )}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          <p className="bm-meta">비율은 내 제보가 아니었다면 어땠을지와 지금을 견준 값이에요.</p>
        </section>
      )}
    </div>
  )
}
