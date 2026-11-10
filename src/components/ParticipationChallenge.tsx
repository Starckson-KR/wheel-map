import { useMemo } from 'react'
import { weeklyChallenges, type Challenge, type ChallengeId } from '../lib/challenges'
import { shortName } from '../lib/display'
import { TO, go } from '../lib/nav'
import { periodRange } from '../lib/ranking'
import { nowMs, useReports } from '../lib/reportStore'
import { computeRewards } from '../lib/rewards'
import { loadBarriers } from '../lib/seed'
import type { Report } from '../types'

const BARRIERS = loadBarriers()
const BY_ID = new Map(BARRIERS.map((b) => [b.id, b]))
const SHOW_WAITING = 3

const TEXT: Record<ChallengeId, { title: string; desc: string }> = {
  infoGap: { title: '정보가 부족한 곳 살펴보기', desc: '평가가 없거나 위치가 정해지지 않은 곳 근처에서 새 제보가 검증되면 채워져요.' },
  recheck: { title: '개선 여부 확인하기', desc: '조치가 끝났다는 곳에서 지금은 지나갈 수 있는지 확인해 주세요.' },
  newReport: { title: '새 장애요인 알리기', desc: '길에서 만난 불편이 검증되면 채워져요.' },
}

function placeOf(r: Report): string {
  const b = r.seedId ? BY_ID.get(r.seedId) : undefined
  return b ? shortName(b.id, b.name) : `${r.type} (${r.locationKind ?? '시민 제보'})`
}

function Row({ c, children }: { c: Challenge; children?: React.ReactNode }) {
  const t = TEXT[c.id]
  const shown = Math.min(c.now, c.goal)
  return (
    <li className={'ch-row' + (c.done ? ' is-done' : '')}>
      <div className="ch-head">
        <strong>{t.title}</strong>
        {c.done ? <span className="ch-done">✓ 완료</span> : <span className="ch-num">{shown}/{c.goal}</span>}
      </div>
      <div className="ch-track" role="progressbar" aria-label={t.title} aria-valuemin={0} aria-valuemax={c.goal} aria-valuenow={shown} aria-valuetext={`${c.goal}번 중 ${shown}번${c.done ? ', 완료' : ''}`}>
        <i style={{ width: `${(shown / c.goal) * 100}%` }} />
      </div>
      <p className="bm-meta">{t.desc}</p>
      {children}
    </li>
  )
}

export default function ParticipationChallenge() {
  const reports = useReports((s) => s.reports)
  const userId = useReports((s) => s.userId)
  const offsetDays = useReports((s) => s.offsetDays)
  const week = useMemo(() => {
    const range = periodRange('week', nowMs())
    const rw = computeRewards(reports, [userId])[userId]
    return { range, ...weeklyChallenges(reports, userId, BARRIERS, rw.events, range) }
    // offsetDays: 시연 도구로 시간을 앞당기면 이번 주가 바뀌므로 다시 계산한다
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reports, userId, offsetDays])
  const get = (id: ChallengeId) => week.items.find((x) => x.id === id) as Challenge

  return (
    <section className="pg-card" aria-labelledby="ch-h">
      <h2 id="ch-h">이번 주 챌린지</h2>
      <p className="bm-meta">{week.range.label}</p>
      <ul className="ch-list">
        <Row c={get('infoGap')}>
          <p className="ch-sub">살펴볼 곳이 {week.gapCount}곳 있어요.</p>
          <button type="button" className="ch-go" onClick={() => go(TO.map)}>동행지도에서 보러 가기</button>
        </Row>
        <Row c={get('recheck')}>
          {week.waiting.length === 0 ? (
            <p className="ch-sub">지금 재확인을 기다리는 곳이 없어요.</p>
          ) : (
            <>
              <p className="ch-sub">재확인을 기다리는 곳이 {week.waiting.length}곳 있어요.</p>
              <ul className="ch-wait">
                {week.waiting.slice(0, SHOW_WAITING).map((r) => (
                  <li key={r.id}>
                    <button type="button" className="ch-go" onClick={() => go(TO.openReport(r.id))}>
                      {placeOf(r)} 확인하러 가기
                    </button>
                  </li>
                ))}
              </ul>
            </>
          )}
        </Row>
        <Row c={get('newReport')}>
          <button type="button" className="ch-go" onClick={() => go(TO.newReport)}>문제 신고하기</button>
        </Row>
      </ul>
      <p className="bm-meta">챌린지는 점수와 따로 표시돼요.</p>
    </section>
  )
}
