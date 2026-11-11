import { useEffect, useMemo, useState } from 'react'
import { channelLinks, deadlineFor, findAgencies, hasTodoLaw, legalLines } from '../lib/agencyGuide'
import { buildComplaintText, criteriaFor, relatedInfo } from '../lib/complaintText'
import { loadKakao, reverseGeocode } from '../lib/kakao'
import { submitMockComplaint } from '../lib/mockComplaintApi'
import { nowMs, useReports } from '../lib/reportStore'
import { RATING_STYLE } from '../lib/rating'
import { toast } from '../lib/uiStore'
import type { Barrier, Report } from '../types'

export function MockBadge() {
  return (
    <span className="cg-mock" role="note">
      시연용 모의 연동 · 실제 국민신문고·안전신문고에는 접수되지 않아요
    </span>
  )
}

type Props = { report: Report; seeds: Barrier[] }

// ③ 검증 완료된 건의 접수 안내: 소관 기관 → 접수 채널 → 근거 법령 → 처리기한 → 문안 → 접수(링크 방식은 번호 입력, 모의 방식은 자동 접수).
export default function ComplaintGuide({ report: r, seeds }: Props) {
  const reports = useReports((s) => s.reports)
  const mode = useReports((s) => s.complaintMode)
  const offset = useReports((s) => s.offsetDays)
  const fileComplaint = useReports((s) => s.fileComplaint)
  const userId = useReports((s) => s.userId)
  const [address, setAddress] = useState<string | null>(null)
  const [addrDone, setAddrDone] = useState(false)
  const [copied, setCopied] = useState('')
  const [channel, setChannel] = useState('')
  const [receipt, setReceipt] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  const kind = r.locationKind ?? ''
  const matches = useMemo(() => (kind ? findAgencies(r.type, kind) : []), [r.type, kind])
  const agencies = matches.map((m) => m.agency)
  void offset // 시간 앞당기기(offset)가 바뀌면 다시 그려져 채널 안내(11-01 변경)가 갱신된다
  const links = channelLinks(agencies, nowMs())
  const channels = links.length > 0 ? links : [{ label: '국민신문고', url: 'https://www.epeople.go.kr/nep/pttn/gnrlPttn/PttnRqstWrtnInfo.paid' }]
  const deadline = deadlineFor(agencies)
  const crit = criteriaFor(r.type, kind)
  const official = userId === 'officer'

  useEffect(() => {
    let cancelled = false
    loadKakao()
      .then((k) => reverseGeocode(k, r.lat, r.lng))
      .then((a) => {
        if (!cancelled) {
          setAddress(a)
          setAddrDone(true)
        }
      })
      .catch(() => {
        if (!cancelled) setAddrDone(true)
      })
    return () => {
      cancelled = true
    }
  }, [r.lat, r.lng])

  const ratingLabel = r.verification.rating ? RATING_STYLE[r.verification.rating].label : undefined
  const text = useMemo(
    () => buildComplaintText({ r, address, agencyNames: matches.map((m) => (m.candidate ? `${m.agency.name}(후보)` : m.agency.name)), related: relatedInfo(r, reports, seeds), ratingLabel }),
    [r, address, matches, reports, seeds, ratingLabel],
  )

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text)
      toast('문안을 복사했어요. 접수 화면에 붙여 넣어 주세요.')
    } catch {
      const ta = document.getElementById('cg-text') as HTMLTextAreaElement | null
      ta?.select()
      setCopied('자동 복사가 막혀 있어요. 선택된 문안을 직접 복사해 주세요(Ctrl+C).')
    }
  }

  const chosen = channel || channels[0].label
  const agencyIds = agencies.map((a) => a.id)

  const submitLink = () => {
    if (!receipt.trim()) {
      setErr('접수하고 받은 접수번호를 적어 주세요.')
      return
    }
    const res = fileComplaint(r.id, { channel: chosen, receiptNo: receipt.trim(), submittedAt: new Date(nowMs()).toISOString(), mode: 'link', agencyIds, deadlineDays: deadline.days })
    setErr(res.ok ? '' : (res.message ?? '처리하지 못했어요.'))
  }

  const submitMock = async () => {
    setBusy(true)
    setErr('')
    try {
      const res = await submitMockComplaint({
        channel: chosen,
        title: `보행 장애요소(${r.type}) 확인 및 개선 요청`,
        body: text,
        location: { lat: r.lat, lng: r.lng, ...(address ? { address } : {}) },
        category: r.type,
        agencyHints: agencyIds,
        photoCount: r.photos.length,
        processingDays: deadline.days,
        nowMs: nowMs(),
      })
      const out = fileComplaint(r.id, {
        channel: chosen,
        receiptNo: res.receiptNo,
        submittedAt: res.receivedAt,
        mode: 'mock',
        agencyIds,
        assignedAgencyId: res.assignedAgencyId,
        deadlineDays: res.processingDays,
      })
      if (!out.ok) setErr(out.message ?? '처리하지 못했어요.')
    } catch (e) {
      setErr(e instanceof Error ? e.message : '모의 접수를 하지 못했어요.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="rf-card cg" aria-label="접수 안내">
      <h3>민원 접수 안내</h3>
      {mode === 'mock' && <MockBadge />}

      <h4>소관 기관</h4>
      {!kind && <p className="rf-warn">어떤 곳인지 정보가 없어 소관 기관을 찾지 못했어요. 확인이 필요해요.</p>}
      {kind && matches.length === 0 && <p className="rf-warn">이 유형과 장소에 맞는 소관 기관을 자료에서 찾지 못했어요. 확인이 필요해요. 국민신문고로 접수하면 소관 기관으로 넘어가요(민원 처리에 관한 법률 제16조).</p>}
      {matches.map((m) => (
        <div key={m.agency.id} className={'cg-ag' + (m.candidate ? ' cand' : '')}>
          <strong>{m.agency.name}</strong>{' '}
          <span className={'cg-tag' + (m.candidate ? ' cand' : '')}>{m.candidate ? '후보 · 확인이 필요해요' : m.condition ? '조건부 소관' : '확인된 소관'}</span>
          <div className="bm-meta">{m.agency.department}</div>
          {m.condition && <div className="bm-meta">조건: {m.condition}</div>}
          {legalLines(m.agency).length > 0 && (
            <ul className="cg-law">
              {legalLines(m.agency).map((l) => (
                <li key={l}>{l}</li>
              ))}
            </ul>
          )}
          {hasTodoLaw(m.agency) && <div className="bm-meta">근거 조문 일부는 확인이 필요해요.</div>}
          {m.agency.phone && <div className="bm-meta">전화: {m.agency.phone}</div>}
          {m.candidate && (
            <details className="cg-note">
              <summary>후보인 이유 (조사 메모)</summary>
              <p className="bm-meta">{m.agency.note}</p>
            </details>
          )}
        </div>
      ))}

      <h4>처리기한</h4>
      <p>
        접수일부터 {deadline.days}일 <span className="bm-meta">({deadline.basis}). 접수하고 30일이 지나도 처리되지 않으면 진행 상황을 알려 달라고 요구할 수 있어요(민원 처리에 관한 법률 시행령 제23조).</span>
      </p>

      {crit.length > 0 && (
        <>
          <h4>관련 기준</h4>
          <ul className="cg-law">
            {crit.map((c) => (
              <li key={c.text}>
                {c.text} <span className="bm-meta">({c.basis})</span>
              </li>
            ))}
          </ul>
        </>
      )}

      <h4>접수 채널</h4>
      <div className="cg-links">
        {channels.map((c) =>
          c.url ? (
            <a key={c.label} className="rf-btn" href={c.url} target="_blank" rel="noopener noreferrer">
              {c.label} 열기
            </a>
          ) : (
            <span key={c.label} className="cg-textch">
              {c.label}: {c.text}
            </span>
          ),
        )}
      </div>
      <p className="bm-meta">외부 사이트는 새 탭에서 열려요. 두 신문고 모두 본인 인증이 필요해서 앱이 대신 제출할 수는 없어요.</p>

      <h4>민원 문안</h4>
      <textarea id="cg-text" className="cg-text" readOnly rows={12} value={text} aria-label="자동 작성된 민원 문안" />
      {!addrDone && <span className="bm-meta">주소를 찾고 있어요…</span>}
      <div className="rf-actions">
        <button type="button" onClick={copy}>
          문안 복사
        </button>
      </div>
      {copied && (
        <p className="bm-meta" role="status">
          {copied}
        </p>
      )}

      <h4>접수했다면 기록해 주세요</h4>
      {official && <p className="rf-warn">공무원은 접수를 신청할 수 없어요. 시연 도구에서 시민이나 검증자로 바꿔 주세요.</p>}
      <label className="rf-field">
        접수 채널
        <select value={chosen} onChange={(e) => setChannel(e.target.value)}>
          {channels.map((c) => (
            <option key={c.label}>{c.label}</option>
          ))}
        </select>
      </label>
      {mode === 'link' ? (
        <>
          <p className="bm-meta">위 채널에서 접수하고 받은 접수번호를 적어 주세요.</p>
          <label className="rf-field">
            접수번호
            <input type="text" value={receipt} onChange={(e) => setReceipt(e.target.value)} placeholder="접수하고 받은 번호" autoComplete="off" />
          </label>
          <div className="rf-actions">
            <button type="button" className="rf-primary" disabled={official} onClick={submitLink}>
              접수번호 기록하기
            </button>
          </div>
        </>
      ) : (
        <>
          <MockBadge />
          <div className="rf-actions">
            <button type="button" className="rf-primary" disabled={busy || official} onClick={submitMock}>
              {busy ? '모의 접수하고 있어요…' : '모의로 접수하기'}
            </button>
          </div>
        </>
      )}
      {err && (
        <p className="rf-warn" role="alert">
          {err}
        </p>
      )}
    </section>
  )
}
