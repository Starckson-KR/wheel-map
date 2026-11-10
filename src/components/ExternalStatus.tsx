import { useState } from 'react'
import { channelHome } from '../lib/agencyGuide'
import { findAgencyName } from '../lib/agencyName'
import { agencyOf, deadlineOf } from '../lib/caseMetrics'
import { EXTERNAL_STAGES, atFromYmd, externalUpdates, hasExternalAnswer, ymdOf } from '../lib/externalStatus'
import { getMockStatus } from '../lib/mockComplaintApi'
import { nowMs, useReports, userName } from '../lib/reportStore'
import type { ExternalStage, Report } from '../types'

const fmtDay = (iso: string) => new Date(iso).toLocaleDateString('ko-KR', { dateStyle: 'medium' })

// "바깥 처리 상황" 카드: 국민신문고·안전신문고 같은 앱 밖에서 진행된 처리를 시민이 적어 두는 곳. 앱 안의 처리 상태는 바꾸지 않는다.
// readOnly(행정 화면)이면 기록이 있을 때만 읽기용으로 보여 준다.
export default function ExternalStatus({ report: r, readOnly = false }: { report: Report; readOnly?: boolean }) {
  const userId = useReports((s) => s.userId)
  const offset = useReports((s) => s.offsetDays)
  void offset // 시간 앞당기기가 바뀌면 다시 그려진다
  const add = useReports((s) => s.addExternalUpdate)
  const [stage, setStage] = useState<ExternalStage>('접수 확인')
  const [ymd, setYmd] = useState('')
  const [agency, setAgency] = useState('')
  const [memo, setMemo] = useState('')
  const [msg, setMsg] = useState('')
  const [busy, setBusy] = useState(false)

  const c = r.complaint
  if (!c) return null
  const list = externalUpdates(r)
  if (readOnly && list.length === 0) return null

  const now = nowMs()
  const today = ymdOf(now)
  const officer = userId === 'officer'
  const isMock = c.mode === 'mock'
  const answered = hasExternalAnswer(r)
  const appDone = r.status === 'resolved' || r.status === 'rechecked'
  const due = deadlineOf(r, now)
  const overdue = !!due && now > due.dueMs && !answered && !appDone
  const home = isMock ? null : channelHome(c.channel)

  const save = () => {
    const res = add(r.id, { stage, at: atFromYmd(ymd || today, now), agencyName: agency, memo })
    if (res.ok) {
      setMsg('')
      setMemo('')
      setAgency('')
    } else setMsg(res.message)
  }

  const fetchMock = async () => {
    setBusy(true)
    setMsg('')
    try {
      const res = await getMockStatus({ receiptNo: c.receiptNo, history: r.history, agencyName: findAgencyName(agencyOf(r) ?? ''), nowMs: now })
      const out = add(r.id, { stage: res.stage, at: res.checkedAt, agencyName: res.agencyName, memo: res.summary }, 'mock-api')
      if (!out.ok) setMsg(out.message)
    } catch (e) {
      setMsg(e instanceof Error ? e.message : '모의 조회를 하지 못했어요.')
    } finally {
      setBusy(false)
    }
  }

  const goRecheck = () => document.getElementById('ps-recheck')?.scrollIntoView({ block: 'center' })

  return (
    <div className="rf-card ex" aria-label="바깥 처리 상황">
      <strong>바깥 처리 상황</strong>
      <p className="bm-meta">
        {isMock
          ? '시연용 모의 조회로 불러온 내용이에요. 실제 신문고에서 가져온 것이 아니에요.'
          : '신문고 같은 앱 밖에서 진행된 처리 상황을 시민이 직접 적어 두는 곳이에요. 앱 안의 처리 상태는 바뀌지 않아요.'}
      </p>

      {list.length === 0 ? (
        <p className="bm-meta">아직 기록이 없어요.</p>
      ) : (
        <ol className="ex-list">
          {list.map((u, i) => (
            <li key={i}>
              <span className="ex-stage">{u.stage}</span>
              <span className="bm-meta">
                {' '}
                {fmtDay(u.at)}
                {u.agencyName ? ` · ${u.agencyName}` : ''}
              </span>
              {u.memo && <div>{u.memo}</div>}
              <span className={'ex-by' + (u.by === 'mock-api' ? ' mock' : '')}>{u.by === 'mock-api' ? '모의 조회 결과(시연)' : `시민이 기록한 내용 · ${userName(u.by)}`}</span>
            </li>
          ))}
        </ol>
      )}
      {c.external?.lastCheckedAt && <span className="bm-meta">마지막으로 기록한 때: {fmtDay(c.external.lastCheckedAt)}</span>}

      {overdue && (
        <p className="ps-flag" role="status">
          ⚠ {isMock ? '처리기한이 지났어요. 아래 \'처리 상황 불러오기(시연)\'로 모의 결과를 확인해 주세요.' : '처리기한이 지났어요. 누리집에서 결과를 확인하고 기록해 주세요.'}
        </p>
      )}

      {answered && r.status !== 'rechecked' && (
        <div className="ex-recheck" role="status">
          {r.status === 'resolved' && !readOnly ? (
            <>
              <p>답변이 있었어요. 현장이 실제로 고쳐졌는지 재확인을 요청할 수 있어요.</p>
              <button type="button" onClick={goRecheck}>
                재확인 하러 가기
              </button>
            </>
          ) : (
            <p>
              답변이 있었어요. 현장이 실제로 고쳐졌는지 직접 확인해 보세요. 앱 안에서 조치가 완료로 기록되면 이 화면에서 재확인을 요청할 수 있어요.
            </p>
          )}
        </div>
      )}

      {!readOnly && home && (
        <a className="rf-btn" href={home} target="_blank" rel="noopener noreferrer">
          누리집에서 처리 상황 확인하기
        </a>
      )}
      {!readOnly && home && <span className="bm-meta">{c.channel} 누리집 첫 화면이 새 창으로 열려요. 거기서 접수번호로 조회해 주세요.</span>}

      {!readOnly && officer && <p className="bm-meta">바깥 처리 상황은 시민이 기록해요. 시연 도구에서 시민이나 검증자로 바꾸면 쓸 수 있어요.</p>}

      {!readOnly && !officer && isMock && (
        <div className="rf-actions">
          <button type="button" disabled={busy} onClick={fetchMock}>
            {busy ? '불러오고 있어요…' : '처리 상황 불러오기(시연)'}
          </button>
        </div>
      )}

      {!readOnly && !officer && !isMock && (
        <fieldset className="ex-form">
          <legend>처리 상황 기록하기</legend>
          <label className="rf-field">
            단계
            <select value={stage} onChange={(e) => setStage(e.target.value as ExternalStage)}>
              {EXTERNAL_STAGES.map((s) => (
                <option key={s}>{s}</option>
              ))}
            </select>
          </label>
          <label className="rf-field">
            날짜
            <input type="date" value={ymd || today} max={today} onChange={(e) => setYmd(e.target.value)} />
          </label>
          <label className="rf-field">
            처리 기관 이름 (선택)
            <input type="text" value={agency} maxLength={60} onChange={(e) => setAgency(e.target.value)} placeholder="답변에 적힌 기관 이름" autoComplete="off" />
          </label>
          <label className="rf-field">
            답변 요약 (선택)
            <textarea rows={3} value={memo} maxLength={500} onChange={(e) => setMemo(e.target.value)} placeholder="받은 답변의 핵심만 적어 주세요." />
          </label>
          <div className="rf-actions">
            <button type="button" className="rf-primary" onClick={save}>
              기록하기
            </button>
          </div>
        </fieldset>
      )}
      {msg && (
        <p className="rf-warn" role="alert">
          {msg}
        </p>
      )}
    </div>
  )
}
