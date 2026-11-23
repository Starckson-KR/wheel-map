import { useEffect, useMemo, useState } from 'react'
import { channelLinks, deadlineFor, findAgencies, hasTodoLaw, legalLines, phoneParts, telHref, type ChannelLink } from '../lib/agencyGuide'
import { buildComplaintText, criteriaFor, relatedInfo } from '../lib/complaintText'
import { loadKakao, reverseGeocode } from '../lib/kakao'
import { submitMockComplaint } from '../lib/mockComplaintApi'
import { nowMs, useReports } from '../lib/reportStore'
import { RATING_STYLE } from '../lib/rating'
import { toast } from '../lib/uiStore'
import { useCanEdit } from '../lib/account/canEdit'
import type { Barrier, Report } from '../types'
import { Sentences } from './Sentences'

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
  // 서버는 작성자와 개발자 계정의 변경만 받는다. 로그인하지 않은 시연(이 기기만)은 그대로 쓴다.
  const canRecord = useCanEdit(r)

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
      setErr('접수번호를 적어 주세요.')
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
      {!kind && <Sentences as="p" className="rf-warn">어떤 곳인지 정보가 없어 소관 기관을 찾지 못했어요. 확인이 필요해요.</Sentences>}
      {kind && matches.length === 0 && <Sentences as="p" className="rf-warn">이 유형과 장소에 맞는 소관 기관을 자료에서 찾지 못했어요. 확인이 필요해요. 국민신문고로 접수하면 소관 기관으로 넘어가요(민원 처리에 관한 법률 제16조).</Sentences>}
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
          {m.agency.phone && (
            <div className="bm-meta">
              전화:{' '}
              {phoneParts(m.agency.phone).map((p, i) =>
                p.tel ? (
                  <a key={i} className="cg-tel inline" href={telHref(p.tel)} aria-label={`${m.agency.name}에 전화 걸기 ${p.tel}`}>
                    ☎ {p.text}
                  </a>
                ) : (
                  <span key={i}>{p.text}</span>
                ),
              )}
            </div>
          )}
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
        {channels.map((c) => (
          <div key={c.label} className="cg-ch">
            {c.url ? (
              <a className="rf-btn" href={c.url} target="_blank" rel="noopener noreferrer">
                {c.label} 열기
              </a>
            ) : (
              <span className="cg-textch">
                {c.label}: {c.text}
              </span>
            )}
            <ChannelCall c={c} />
          </div>
        ))}
      </div>
      <Sentences as="p" className="bm-meta">외부 사이트는 새 탭에서 열려요. 두 신문고 모두 본인 인증이 필요해서 앱이 대신 제출할 수는 없어요.</Sentences>

      <h4>민원 문안</h4>
      <textarea id="cg-text" className="cg-text" readOnly rows={12} value={text} aria-label="자동 작성된 민원 문안" />
      {!addrDone && <span className="bm-meta">주소를 찾고 있어요…</span>}
      <div className="rf-actions">
        <button type="button" onClick={copy}>
          문안 복사
        </button>
      </div>
      {copied && (
        <Sentences as="p" className="bm-meta" role="status">
          {copied}
        </Sentences>
      )}

      {canRecord && (
        <>
      <h4>접수했다면 기록해 주세요</h4>
      {official && <Sentences as="p" className="rf-warn">공무원은 접수를 신청할 수 없어요.</Sentences>}
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
        <Sentences as="p" className="rf-warn" role="alert">
          {err}
        </Sentences>
      )}
        </>
      )}
    </section>
  )
}

// 접수 창구 버튼 아래 한 줄: 누르면 바로 전화(또는 문자 작성)가 열린다.
function ChannelCall({ c }: { c: ChannelLink }) {
  if (!c.tel && !c.sms) return null
  return (
    <>
      {c.tel && (
        <a className="cg-tel" href={telHref(c.tel)} aria-label={`${c.label}에 전화 걸기`}>
          ☎ {c.tel}
        </a>
      )}
      {c.sms && (
        <a className="cg-tel" href={telHref(c.sms, 'sms')} aria-label={`${c.label}에 문자 보내기`}>
          문자 {c.sms}
        </a>
      )}
    </>
  )
}
