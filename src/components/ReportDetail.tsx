import { useState } from 'react'
import { Swap } from './motionKit'
import ReportPhotos from './ReportPhotos'
import SheetHandle from './SheetHandle'
import ComplaintGuide from './ComplaintGuide'
import ProcessSection from './ProcessSection'
import { VOTES_REQUIRED, canVerifierConfirm, canVote } from '../lib/config'
import { RATING_STYLE } from '../lib/rating'
import { flagsOf, fmtDate } from '../lib/caseMetrics'
import { useRecurrence } from '../lib/useRecurrence'
import { REJECT_REASONS } from '../lib/reportTypes'
import { DEMO_USERS, STATUS_LABEL, isExpired, nowMs, useReports, userName } from '../lib/reportStore'
import { coordText, useAddress } from '../lib/addressCache'
import { isSampleReport } from '../lib/samplePhotos'
import type { Barrier, Rating } from '../types'
import { Sentences } from './Sentences'
import { useAccount } from '../lib/account/api'
import { canEditReport } from '../lib/account/canEdit'
import '../styles/review.css'
import { fmtDateTime as fmt } from '../lib/format'

type Props = {
  reportId: string
  seeds: Barrier[]
  seedName: (id: string) => string | null
  onClose: () => void
  onOpenReport: (id: string) => void
  onOpenSeed: (id: string) => void
  readOnlyExternal?: boolean // 행정 화면에서는 바깥 처리 상황을 읽기만 한다
  /** 시민 화면: 남의 제보에서는 제보자·확인한 사람 이름을 숨기고 「이웃」으로만 보인다(내 제보·행정 화면은 그대로) */
  hideNames?: boolean
}

// 위치 한 줄: 주소(없으면 동 이름, 그것도 없으면 좌표)
function ReportPlace({ lat, lng, kind }: { lat: number; lng: number; kind?: string }) {
  const a = useAddress(lat, lng)
  const text = a.full ? `${a.full} 부근` : a.status === 'loading' ? '주소를 찾고 있어요…' : coordText(lat, lng)
  return (
    <>
      {text}
      {kind && <> · {kind}</>}
    </>
  )
}

export default function ReportDetail({ reportId, seeds, seedName, onClose, onOpenReport, onOpenSeed, readOnlyExternal, hideNames }: Props) {
  const reports = useReports((s) => s.reports)
  const userId = useReports((s) => s.userId)
  const vote = useReports((s) => s.vote)
  const judge = useReports((s) => s.judge)
  const reject = useReports((s) => s.reject)
  const [rating, setRating] = useState<Rating | null>(null)
  const [reason, setReason] = useState<string>(REJECT_REASONS[0])
  const [msg, setMsg] = useState('')
  const recurrence = useRecurrence()
  const account = useAccount((s) => s.user)
  const offset = useReports((s) => s.offsetDays)
  void offset // 시간 앞당기기가 바뀌면 처리기한 표시가 다시 그려진다
  const admin = !!readOnlyExternal // 행정 화면은 오른쪽 카드라 처음부터 다 펼친다
  const [open, setOpen] = useState(admin) // 낮은 시트(기본) ↔ 펼친 시트

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
  // 이름을 보일 사람: 나는 그대로, 남은 숨긴다(검증자·공무원은 역할 이름만)
  const who = (id: string) => {
    if (!hideNames || id === me.id) return userName(id)
    const role = DEMO_USERS.find((u) => u.id === id)?.role
    return role === 'verifier' ? '검증자' : role === 'officer' ? '담당 공무원' : '이웃'
  }
  const theirs = !!hideNames && r.userId !== me.id
  const merged = reports.filter((x) => x.status === 'merged' && x.barrierId === r.id)
  const target = r.barrierId ? (reports.find((x) => x.id === r.barrierId) ?? null) : null
  const seedLabel = r.barrierId && !target ? seedName(r.barrierId) : null
  const expired = isExpired(r)
  const v = r.verification
  const style = RATING_STYLE[v.rating ?? 'none']
  const act = (res: { ok: boolean; message?: string }) => setMsg(res.ok ? '' : (res.message ?? '처리하지 못했어요.'))

  const canVoteNow = canVote() && r.status === 'pending' && me.role === 'citizen' && r.userId !== me.id && !v.voterIds.includes(me.id)
  // 서버는 작성자·개발자의 변경만 받으므로 검증자 시연 버튼도 같은 조건일 때만
  const editable = canEditReport(r, account)
  const canConfirm = editable && me.role === 'verifier' && r.status === 'pending' && canVerifierConfirm()
  const canRate = editable && me.role === 'verifier' && r.status === 'verified' && !v.rating
  const canReject = editable && me.role === 'verifier' && r.status === 'pending'

  return (
    <aside className={'bm-detail rd' + (open ? '' : ' bm-low')} data-sheet aria-label="제보 상세">
      <SheetHandle onDown={open && !admin ? () => setOpen(false) : onClose} onUp={() => setOpen(true)} expanded={open} onToggle={() => setOpen((o) => !o)} exit={!open || admin} />
      <div className="bm-detail-head">
        <h2>
          {r.seedId ? `${seedName(r.seedId) ?? '팀 조사 지점'} · ${r.type}` : `${theirs ? '이웃' : '시민'} 제보 · ${r.type}`}
        </h2>
        <button type="button" className="bm-close" onClick={onClose} aria-label="닫기">
          닫기
        </button>
      </div>

      <p className="rd-verdict">
        <span className={'rp-badge rp-' + r.status}><Swap k={r.status}>{STATUS_LABEL[r.status]}</Swap></span>
        {r.status === 'verified' && (
          <span className="bm-badge" style={{ background: style.color, color: style.ink }}>
            {v.rating ? style.label : '검증자 판정 대기'}
          </span>
        )}
        {flagsOf(r, nowMs()).map((f) => (
          <span key={f} className="ps-flag" role="status">
            {f}
          </span>
        ))}
        {isSampleReport(r) && <span className="rv-chip">샘플 사진</span>}
        {r.demoSet === 'large' && <span className="adm-demo">시연용 가상 데이터</span>}
      </p>

      {r.status === 'merged' && (
        <p className="rf-notice">
          <span className="sent">이 제보는 기존 건에 합쳐졌어요.</span>
          {target ? (
            <button type="button" onClick={() => onOpenReport(target.id)}>
              {target.type} 제보 ({who(target.userId)})
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
          <span className="sent">이 곳은 {fmtDate(recurrence.byId.get(r.id)?.priorActionMs ?? 0)}에 조치된 뒤 다시 제보됐어요(재발 {recurrence.byId.get(r.id)?.nth}회).</span>
          <button type="button" className="adm-link" onClick={() => onOpenReport(recurrence.byId.get(r.id)?.priorId ?? r.id)}>
            앞선 건 보기
          </button>
        </p>
      )}

      {r.category === 'temporary' && r.expiresAt && (
        <Sentences as="p" className={expired ? 'rf-warn' : 'rf-notice'} role="status">{expired ? '유효기간이 지났어요.' : `${fmt(r.expiresAt)}까지 유효해요.`}</Sentences>
      )}

      {r.photos.length > 0 && (
        <div className="bm-shot">
          <ReportPhotos keys={r.photos} />
        </div>
      )}
      {r.description && <p className="rd-desc">{r.description}</p>}
      <p className="bm-meta rd-place">
        <ReportPlace lat={r.lat} lng={r.lng} kind={r.locationKind} />
      </p>
      {v.result === 'rejected' && <p className="rf-warn">반려 사유: {v.reason}</p>}
      {canVote() && r.status === 'pending' && (
        <p className="bm-meta">
          시민 {v.votes}/{VOTES_REQUIRED}명 확인
          {v.voterIds.length > 0 && !theirs && <> ({v.voterIds.map(who).join(', ')})</>}
        </p>
      )}

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
              <details className="rf-criteria">
                <summary>○△X 판정 기준</summary>
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
      {!canVoteNow && !canConfirm && !canRate && !canReject && r.status === 'pending' && r.userId !== me.id && (
        <Sentences as="p" className="bm-meta">{me.role === 'verifier'
            ? '지금 설정에서는 검증자가 확인할 수 없어요.'
            : '이미 확인했어요.'}</Sentences>
      )}
      {msg && (
        <Sentences as="p" className="rf-warn" role="alert">
          {msg}
        </Sentences>
      )}

      {r.status === 'verified' && <ComplaintGuide report={r} seeds={seeds} />}
      <ProcessSection
        report={r}
        readOnlyExternal={readOnlyExternal}
        nameOf={hideNames ? who : undefined}
        moreOpen={admin}
        onMore={(on) => on && setOpen(true)}
        extra={
          <>
            {(!hideNames || r.measurements) && (
              <dl>
                {!hideNames && (
                  <>
                    <dt>제보한 사람과 시간</dt>
                    <dd>
                      {userName(r.userId)} · {fmt(r.createdAt)}
                    </dd>
                  </>
                )}
                {r.measurements && (
                  <>
                    <dt>직접 잰 값</dt>
                    <dd>
                      {r.measurements.widthM !== undefined && <>폭 {r.measurements.widthM}m </>}
                      {r.measurements.curbCm !== undefined && <>턱 높이 {r.measurements.curbCm}cm</>}
                    </dd>
                  </>
                )}
              </dl>
            )}
            {merged.length > 0 && (
              <div>
                <strong>합쳐진 제보 {merged.length}건</strong>
                <ul className="lr-list bm-children">
                  {merged.map((m) => (
                    <li key={m.id}>
                      <button type="button" onClick={() => onOpenReport(m.id)}>
                        {who(m.userId)} · {fmt(m.createdAt)}
                      </button>
                      <br />
                      <span className="bm-meta">{m.description}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </>
        }
      />
    </aside>
  )
}
