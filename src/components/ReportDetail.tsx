import { useState } from 'react'
import ReportPhotos from './ReportPhotos'
import SheetHandle from './SheetHandle'
import ComplaintGuide from './ComplaintGuide'
import ProcessSection from './ProcessSection'
import { VERIFY_MODE, VERIFY_MODE_TEXT, VOTES_REQUIRED, canVerifierConfirm, canVote } from '../lib/config'
import { RATING_STYLE } from '../lib/rating'
import { fmtDate } from '../lib/caseMetrics'
import { useRecurrence } from '../lib/useRecurrence'
import { CATEGORY_LABEL, REJECT_REASONS } from '../lib/reportTypes'
import { DEMO_USERS, STATUS_LABEL, isExpired, useReports, userName } from '../lib/reportStore'
import type { Barrier, Rating } from '../types'

type Props = {
  reportId: string
  seeds: Barrier[]
  seedName: (id: string) => string | null
  onClose: () => void
  onOpenReport: (id: string) => void
  onOpenSeed: (id: string) => void
  readOnlyExternal?: boolean // 행정 화면에서는 바깥 처리 상황을 읽기만 한다
}

const fmt = (iso: string) => new Date(iso).toLocaleString('ko-KR', { dateStyle: 'medium', timeStyle: 'short' })

export default function ReportDetail({ reportId, seeds, seedName, onClose, onOpenReport, onOpenSeed, readOnlyExternal }: Props) {
  const reports = useReports((s) => s.reports)
  const userId = useReports((s) => s.userId)
  const vote = useReports((s) => s.vote)
  const judge = useReports((s) => s.judge)
  const reject = useReports((s) => s.reject)
  const [rating, setRating] = useState<Rating | null>(null)
  const [reason, setReason] = useState<string>(REJECT_REASONS[0])
  const [msg, setMsg] = useState('')
  const recurrence = useRecurrence()

  const r = reports.find((x) => x.id === reportId)
  if (!r) {
    return (
      <aside className="bm-detail" data-sheet aria-label="제보 상세">
        <SheetHandle onDown={onClose} />
        <p>제보를 찾을 수 없어요.</p>
        <button type="button" onClick={onClose}>
          닫기
        </button>
      </aside>
    )
  }

  const me = DEMO_USERS.find((u) => u.id === userId) ?? DEMO_USERS[0]
  const merged = reports.filter((x) => x.status === 'merged' && x.barrierId === r.id)
  const target = r.barrierId ? (reports.find((x) => x.id === r.barrierId) ?? null) : null
  const seedLabel = r.barrierId && !target ? seedName(r.barrierId) : null
  const expired = isExpired(r)
  const v = r.verification
  const style = RATING_STYLE[v.rating ?? 'none']
  const act = (res: { ok: boolean; message?: string }) => setMsg(res.ok ? '' : (res.message ?? '처리하지 못했어요.'))

  const canVoteNow = canVote() && r.status === 'pending' && me.role === 'citizen' && r.userId !== me.id && !v.voterIds.includes(me.id)
  const canConfirm = me.role === 'verifier' && r.status === 'pending' && canVerifierConfirm()
  const canRate = me.role === 'verifier' && r.status === 'verified' && !v.rating
  const canReject = me.role === 'verifier' && r.status === 'pending'

  return (
    <aside className="bm-detail rd" data-sheet aria-label="제보 상세">
      <SheetHandle onDown={onClose} />
      <div className="bm-detail-head">
        <h2>
          {r.seedId ? `팀 조사 지점 ${r.seedId} · ${r.type}` : `시민 제보 · ${r.type}`}
        </h2>
        <button type="button" className="bm-close" onClick={onClose} aria-label="닫기">
          닫기
        </button>
      </div>

      <p>
        <span className={'rp-badge rp-' + r.status}>{STATUS_LABEL[r.status]}</span>{' '}
        <span className={'rf-cat rf-cat-' + r.category}>{CATEGORY_LABEL[r.category]}</span>
        {r.status === 'verified' && (
          <>
            {' '}
            <span className="bm-badge" style={{ background: style.color, color: style.ink }}>
              {v.rating ? style.label : '검증자 판정 대기'}
            </span>
          </>
        )}
      </p>

      {r.status === 'merged' && (
        <p className="rf-notice">
          이 제보는 기존 건에 합쳐졌어요.{' '}
          {target ? (
            <button type="button" onClick={() => onOpenReport(target.id)}>
              {target.type} 제보 ({userName(target.userId)})
            </button>
          ) : (
            <button type="button" onClick={() => r.barrierId && onOpenSeed(r.barrierId)}>
              {r.barrierId} {seedLabel ? `· ${seedLabel}` : ''}
            </button>
          )}
        </p>
      )}

      {recurrence.byId.get(r.id) && (
        <p className="rf-notice adm-recur-note" role="status">
          이 곳은 {fmtDate(recurrence.byId.get(r.id)?.priorActionMs ?? 0)}에 조치된 뒤 다시 신고됐어요(재발 {recurrence.byId.get(r.id)?.nth}회).{' '}
          <button type="button" className="adm-link" onClick={() => onOpenReport(recurrence.byId.get(r.id)?.priorId ?? r.id)}>
            앞선 건 보기
          </button>
        </p>
      )}

      {r.category === 'temporary' && r.expiresAt && (
        <p className={expired ? 'rf-warn' : 'rf-notice'} role="status">
          {expired ? '유효기간이 지났어요. 다시 확인이 필요해요.' : `${fmt(r.expiresAt)}까지 유효해요.`}
          {!expired && ' 지나면 다시 확인해야 해요.'}
        </p>
      )}

      <dl>
        <dt>제보한 사람과 시간</dt>
        <dd>
          {userName(r.userId)} · {fmt(r.createdAt)}
        </dd>
        <dt>위치</dt>
        <dd>
          위도 {r.lat.toFixed(5)}, 경도 {r.lng.toFixed(5)}
          {r.locationKind && <> · {r.locationKind}</>}
        </dd>
        <dt>설명</dt>
        <dd>{r.description}</dd>
        {r.measurements && (
          <>
            <dt>직접 잰 값</dt>
            <dd>
              {r.measurements.widthM !== undefined && <>폭 {r.measurements.widthM}m </>}
              {r.measurements.curbCm !== undefined && <>턱 높이 {r.measurements.curbCm}cm</>}
              <br />
              <span className="bm-meta">시민이 적은 값이라, 현장에서 확인하기 전에는 오차가 있을 수 있어요.</span>
            </dd>
          </>
        )}
        <dt>사진</dt>
        <dd>
          <ReportPhotos keys={r.photos} />
        </dd>
        <dt>검증</dt>
        <dd>
          <span className="bm-meta">{VERIFY_MODE_TEXT[VERIFY_MODE]}</span>
          <br />
          {canVote() && r.status !== 'merged' && (
            <>
              시민 {v.votes}/{VOTES_REQUIRED}명이 확인했어요
              {v.voterIds.length > 0 && <> ({v.voterIds.map(userName).join(', ')})</>}
              <br />
            </>
          )}
          {v.result === 'rejected' && <>반려 사유: {v.reason}</>}
          {r.status === 'verified' && !v.rating && <>검증자 판정을 기다리고 있어요. 판정 전에는 지도에 &quot;평가 없음&quot; 색으로 보여요.</>}
          {v.rating && <>검증자 판정: {RATING_STYLE[v.rating].label} ({userName(v.verifierId ?? 'verifier')})</>}
        </dd>
      </dl>

      {(canVoteNow || canConfirm || canRate || canReject) && (
        <section className="rf-card" aria-label="검증 처리">
          <strong>검증하기 ({me.name})</strong>
          {canVoteNow && (
            <p>
              <button
                type="button"
                className="rf-primary"
                onClick={() => act(vote(r.id))}
              >
                현장이 맞아요
              </button>
            </p>
          )}
          {(canConfirm || canRate) && (
            <>
              <details open className="rf-criteria">
                <summary>○△X 판정 기준 (실제로 지나갈 수 있는지가 먼저예요)</summary>
                <ul>
                  <li>
                    <b>○ 괜찮음</b>: 보도 유효폭 2m 이상 / 횡단보도 턱 2cm 이하 / 출입문 0.9m 이상·자동문 / 경사로 폭 1.2m 이상·1/12 이하
                  </li>
                  <li>
                    <b>△ 주의</b>: 폭 1.2m 이상 2m 미만 / 턱 2cm 초과지만 혼자 넘기 가능 / 문 0.8~0.9m 또는 수동 / 경사로 폭 0.9~1.2m 또는 급함
                  </li>
                  <li>
                    <b>X 어려움</b>: 폭 1.2m 미만 또는 점용물로 막힘 / 혼자 넘기 불가 / 문 0.8m 미만·계단만 / 경사로 없음
                  </li>
                </ul>
              </details>
              <fieldset className="rf-rate">
                <legend>{canRate ? '○△X 판정을 남겨 주세요' : '현장을 확인하고 ○△X를 골라 주세요'}</legend>
                {(['O', 'TRIANGLE', 'X'] as const).map((k) => (
                  <label key={k} className={rating === k ? 'on' : ''}>
                    <input type="radio" name="rating" checked={rating === k} onChange={() => setRating(k)} />
                    <span className="rf-glyph" style={{ background: RATING_STYLE[k].color, color: RATING_STYLE[k].ink }}>
                      {RATING_STYLE[k].glyph}
                    </span>
                    {RATING_STYLE[k].label}
                  </label>
                ))}
              </fieldset>
              <button type="button" className="rf-primary" disabled={!rating} onClick={() => rating && act(judge(r.id, rating))}>
                {canRate ? '판정 저장하기' : '검증 완료로 처리하기'}
              </button>
            </>
          )}
          {canReject && (
            <div className="rf-reject">
              <label className="rf-field">
                반려 사유
                <select value={reason} onChange={(e) => setReason(e.target.value)}>
                  {REJECT_REASONS.map((x) => (
                    <option key={x}>{x}</option>
                  ))}
                </select>
              </label>
              <button type="button" onClick={() => act(reject(r.id, reason))}>
                반려하기
              </button>
            </div>
          )}
        </section>
      )}
      {!canVoteNow && !canConfirm && !canRate && !canReject && r.status === 'pending' && (
        <p className="bm-meta">
          {r.userId === me.id
            ? '내 제보는 내가 확인할 수 없어요. 시연 도구에서 다른 시민이나 검증자로 바꿔 보세요.'
            : me.role === 'verifier'
              ? '지금 설정에서는 검증자가 확인할 수 없어요.'
              : '이미 확인했어요.'}
        </p>
      )}
      {msg && (
        <p className="rf-warn" role="alert">
          {msg}
        </p>
      )}

      {merged.length > 0 && (
        <div>
          <strong>합쳐진 제보 {merged.length}건</strong>
          <ul className="lr-list bm-children">
            {merged.map((m) => (
              <li key={m.id}>
                <button type="button" onClick={() => onOpenReport(m.id)}>
                  {userName(m.userId)} · {fmt(m.createdAt)}
                </button>
                <br />
                <span className="bm-meta">{m.description}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {r.status === 'verified' && <ComplaintGuide report={r} seeds={seeds} />}
      <ProcessSection report={r} readOnlyExternal={readOnlyExternal} />
    </aside>
  )
}
