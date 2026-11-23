import { useCanEdit } from '../lib/account/canEdit'
import { useState, type ReactNode } from 'react'
import ReportPhotos from './ReportPhotos'
import BeforeAfter from './BeforeAfter'
import { MockBadge } from './ComplaintGuide'
import ExternalStatus from './ExternalStatus'
import { resizeImage, savePhoto } from '../lib/photoStore'
import { STATUS_LABEL, useReports, userName } from '../lib/reportStore'
import { findAgencyName } from '../lib/agencyName'
import { agencyOf, pendingTransfer } from '../lib/caseMetrics'
import { listAgencies } from '../lib/agencyGuide'
import { reportNo } from '../lib/externalStatus'
import { copyNo } from '../lib/copyNo'
import type { Report } from '../types'
import { Sentences } from './Sentences'
import { fmtDateTime as fmt } from '../lib/format'

const DAY = 86400000

const STEPS: { label: string; on: (s: Report['status']) => boolean }[] = [
  { label: '확인 완료', on: (s) => s === 'verified' },
  { label: '접수·기관 배정', on: (s) => s === 'filed' || s === 'assigned' },
  { label: '조치 중', on: (s) => s === 'in_progress' },
  { label: '조치 완료', on: (s) => s === 'resolved' },
  { label: '재확인', on: (s) => s === 'rechecked' },
]
const ORDER = ['verified', 'filed', 'assigned', 'in_progress', 'resolved', 'rechecked']

type Props = {
  report: Report
  readOnlyExternal?: boolean
  nameOf?: (id: string) => string
  /** 「자세히」 안에 함께 접어 둘 내용(제보 상세가 넘긴다) */
  extra?: ReactNode
  /** 「자세히」를 처음부터 펼쳐 둔다(행정 화면) */
  moreOpen?: boolean
  onMore?: (open: boolean) => void
}

export default function ProcessSection({ report: r, readOnlyExternal = false, nameOf = userName, extra, moreOpen = false, onMore }: Props) {
  const userId = useReports((s) => s.userId)
  const offset = useReports((s) => s.offsetDays)
  void offset // 시간 앞당기기가 바뀌면 다시 그려진다
  const assign = useReports((s) => s.assign)
  const startAction = useReports((s) => s.startAction)
  const completeAction = useReports((s) => s.completeAction)
  const recheck = useReports((s) => s.recheck)
  const [desc, setDesc] = useState('')
  const [before, setBefore] = useState<Blob | null>(null)
  const [after, setAfter] = useState<Blob | null>(null)
  const [photoMsg, setPhotoMsg] = useState('')
  const [msg, setMsg] = useState('')
  const [busy, setBusy] = useState(false)
  const requestTransfer = useReports((s) => s.requestTransfer)
  const [toAgency, setToAgency] = useState('')
  const [reason, setReason] = useState('')
  const [more, setMore] = useState(moreOpen)

  const officer = userId === 'officer'
  const canEdit = useCanEdit(r) // 남의 제보는 서버가 바꾸지 않는다
  const c = r.complaint
  const started = ORDER.indexOf(r.status) >= 0
  const act = (res: { ok: boolean; message?: string }) => setMsg(res.ok ? '' : (res.message ?? '처리하지 못했어요.'))

  const dueText = c ? `${fmt(new Date(c.submittedAt).getTime() + c.deadlineDays * DAY)}까지` : ''

  const pickPhoto = async (e: React.ChangeEvent<HTMLInputElement>, set: (b: Blob | null) => void) => {
    const f = e.target.files?.[0]
    e.target.value = ''
    if (!f) return
    try {
      set(await resizeImage(f))
      setPhotoMsg('')
    } catch (err) {
      setPhotoMsg(err instanceof Error ? err.message : '사진을 처리하지 못했어요.')
    }
  }

  const finish = async () => {
    setBusy(true)
    const keys = async (b: Blob | null, tag: string) => {
      if (!b) return []
      const k = `${r.id}:${tag}${Date.now()}`
      try {
        await savePhoto(k, b)
        return [k]
      } catch {
        setPhotoMsg('사진을 저장하지 못해서 뺐어요.')
        return []
      }
    }
    const bk = await keys(before, 'b')
    const ak = await keys(after, 'a')
    act(completeAction(r.id, desc.trim(), bk, ak))
    setBusy(false)
    setDesc('')
    setBefore(null)
    setAfter(null)
  }

  return (
    <section className="ps-flow" aria-label="처리 흐름">
      {started && (
        <ol className="ps-steps">
          {STEPS.map((s) => (
            <li key={s.label} className={s.on(r.status) ? 'on' : ''} aria-current={s.on(r.status) ? 'step' : undefined}>
              {s.label}
            </li>
          ))}
        </ol>
      )}
      {r.userId === userId && (
        <div className="rv-no-row">
          <span className="rv-no">접수번호 {reportNo(r.id)}</span>
          <button type="button" className="rv-copy" onClick={() => void copyNo(reportNo(r.id))} aria-label="접수번호 복사">
            복사
          </button>
        </div>
      )}

      {r.action && (
        <div className="rf-card">
          <strong>기관이 남긴 조치 내용</strong>
          <p>{r.action.description || '적힌 내용이 없어요.'}</p>
          <span className="bm-meta">{fmt(r.action.doneAt)}</span>
          {r.status === 'resolved' || r.status === 'rechecked' ? (
            <BeforeAfter report={r} />
          ) : (
            <>
              {r.action.beforePhotos.length > 0 && (
                <>
                  <p className="bm-meta">조치 전 사진</p>
                  <ReportPhotos keys={r.action.beforePhotos} />
                </>
              )}
              {r.action.afterPhotos.length > 0 && (
                <>
                  <p className="bm-meta">조치 후 사진</p>
                  <ReportPhotos keys={r.action.afterPhotos} />
                </>
              )}
            </>
          )}
          {r.action.recheck && !r.action.recheck.passable && <p className="rf-warn">방금 재확인에서 지나갈 수 없다고 판단해서 조치 중으로 되돌렸어요.</p>}
        </div>
      )}

      {officer && canEdit && (r.status === 'filed' || r.status === 'assigned' || r.status === 'in_progress') && (
        <div className="rf-card" aria-label="공무원 처리">
          <strong>담당 공무원 처리 (시연)</strong>
          {r.status === 'filed' && c && (
            <div className="rf-actions">
              <button type="button" onClick={() => act(assign(r.id, c.assignedAgencyId ?? c.agencyIds[0] ?? ''))} disabled={!c.agencyIds[0] && !c.assignedAgencyId}>
                기관 배정 확인하기
              </button>
            </div>
          )}
          {(r.status === 'filed' || r.status === 'assigned') && (
            <div className="rf-actions">
              <button type="button" className="rf-primary" onClick={() => act(startAction(r.id))}>
                조치 시작하기
              </button>
            </div>
          )}
          {r.status === 'in_progress' && (
            <>
              <label className="rf-field">
                조치 내용
                <textarea rows={3} value={desc} onChange={(e) => setDesc(e.target.value)} placeholder="예: 파손된 노면을 보수했어요." />
              </label>
              <label className="rf-btn">
                조치 전 사진{before ? ' ✓' : ' (선택)'}
                <input className="rf-file" type="file" accept="image/*" onChange={(e) => pickPhoto(e, setBefore)} />
              </label>{' '}
              <label className="rf-btn">
                조치 후 사진{after ? ' ✓' : ' (선택)'}
                <input className="rf-file" type="file" accept="image/*" onChange={(e) => pickPhoto(e, setAfter)} />
              </label>
              {photoMsg && <p className="rf-warn">{photoMsg}</p>}
              <div className="rf-actions">
                <button type="button" className="rf-primary" disabled={busy} onClick={finish}>
                  조치 완료로 기록하기
                </button>
              </div>
            </>
          )}
        </div>
      )}

      {officer && canEdit && c && (r.status === 'filed' || r.status === 'assigned' || r.status === 'in_progress') && !pendingTransfer(r) && (
        <details className="rf-card">
          <summary>
            <strong>다른 기관으로 이관</strong>
            {(r.transfers?.length ?? 0) > 0 && <span className="bm-meta"> · 이관 {r.transfers?.length}회</span>}
          </summary>
          <Sentences as="p" className="bm-meta">{`지금 맡은 기관은 ${findAgencyName(agencyOf(r) ?? '')}이에요. 받는 기관의 공무원이 수락하면 그 기관이 맡아요.`}</Sentences>
          <label className="rf-field">
            이관할 기관
            <select value={toAgency} onChange={(e) => setToAgency(e.target.value)}>
              <option value="">선택해 주세요</option>
              {listAgencies()
                .filter((a) => a.id !== agencyOf(r))
                .map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
            </select>
          </label>
          <label className="rf-field">
            이관 사유
            <textarea rows={2} value={reason} onChange={(e) => setReason(e.target.value)} />
          </label>
          <div className="rf-actions">
            <button
              type="button"
              disabled={!toAgency}
              onClick={() => {
                const res = requestTransfer(r.id, toAgency, reason)
                act(res)
                if (res.ok) {
                  setReason('')
                  setToAgency('')
                }
              }}
            >
              이관 요청
            </button>
          </div>
        </details>
      )}
      {pendingTransfer(r) && <Sentences as="p" className="ps-flag">{`이관을 요청했어요. ${findAgencyName(pendingTransfer(r)?.toAgencyId ?? '')}가 수락하기를 기다리고 있어요.`}</Sentences>}

      {r.status === 'resolved' && canEdit && (
        <div className="rf-card" id="ps-recheck" aria-label="재확인">
          <strong>재확인: 이제 지나갈 수 있나요?</strong>
          {officer ? (
            <Sentences as="p" className="bm-meta">재확인은 시민이나 검증자가 해요.</Sentences>
          ) : (
            <div className="rf-actions">
              <button type="button" className="rf-primary" onClick={() => act(recheck(r.id, true))}>
                지나갈 수 있어요
              </button>
              <button type="button" onClick={() => act(recheck(r.id, false))}>
                아직 못 지나가요
              </button>
            </div>
          )}
        </div>
      )}
      {msg && (
        <Sentences as="p" className="rf-warn" role="alert">
          {msg}
        </Sentences>
      )}

      <button
        type="button"
        className="ps-more"
        aria-expanded={more}
        aria-controls="ps-more-body"
        onClick={() => {
          setMore(!more)
          onMore?.(!more)
        }}
      >
        자세히
      </button>
      {more && (
        <div className="ps-more-body" id="ps-more-body">
          {extra}
          {c && (
            <div className="rf-card">
              <strong>접수 내용</strong>
              {c.mode === 'mock' && <MockBadge />}
              <dl className="pc-dl">
                <div>
                  <dt>채널</dt>
                  <dd>{c.channel}</dd>
                </div>
                {c.receiptNo && (
                  <div>
                    <dt>기관 접수번호</dt>
                    <dd>{c.receiptNo}</dd>
                  </div>
                )}
                <div>
                  <dt>접수일</dt>
                  <dd>{fmt(c.submittedAt)}</dd>
                </div>
                <div>
                  <dt>처리기한</dt>
                  <dd>{dueText}</dd>
                </div>
                {c.assignedAgencyId && (
                  <div>
                    <dt>배정 기관</dt>
                    <dd>{findAgencyName(c.assignedAgencyId)}</dd>
                  </div>
                )}
              </dl>
            </div>
          )}

          {c && <ExternalStatus report={r} readOnly={readOnlyExternal} />}

          <div>
            <strong>처리 기록</strong>
            <ol className="ps-timeline">
              {r.history.map((h, i) => (
                <li key={i} className={h.status}>
                  <span className={'rp-badge rp-' + h.status}>{STATUS_LABEL[h.status]}</span>
                  <span className="bm-meta"> {fmt(h.at)} <span className="ps-by">· {nameOf(h.by)}</span></span>
                  {h.memo && h.memo !== STATUS_LABEL[h.status] && <div>{h.memo}</div>}
                </li>
              ))}
            </ol>
          </div>
        </div>
      )}
    </section>
  )
}
