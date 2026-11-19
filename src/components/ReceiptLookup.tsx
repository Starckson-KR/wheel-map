import { useRef, useState } from 'react'
import { findByReceipt } from '../lib/externalStatus'
import { go, TO } from '../lib/nav'
import { STATUS_LABEL, useReports } from '../lib/reportStore'
import type { Report } from '../types'
import { Sentences } from './Sentences'

// 접수번호로 내 제보 찾기. 서버가 없어서 이 기기에 저장된 민원에서만 찾는다.
export default function ReceiptLookup({ onOpen }: { onOpen: (id: string) => void }) {
  const reports = useReports((s) => s.reports)
  const [q, setQ] = useState('')
  const [found, setFound] = useState<Report[] | null>(null)
  const [err, setErr] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  const search = (e: React.FormEvent) => {
    e.preventDefault()
    if (!q.trim()) {
      setErr('접수번호를 입력해 주세요.')
      inputRef.current?.focus()
      return
    }
    const hit = findByReceipt(reports, q)
    if (hit.length === 1) {
      onOpen(hit[0].id)
      return
    }
    setFound(hit)
    if (hit.length === 0) {
      setErr('찾지 못했어요. 번호를 다시 확인해 주세요.')
      inputRef.current?.focus()
    }
  }

  return (
    <form className="rcpt" onSubmit={search} noValidate>
      <label className="rf-field ob-vh" htmlFor="rl-q">
        접수번호로 내 제보 찾기
      </label>
      <input
        ref={inputRef}
        id="rl-q"
        type="text"
        value={q}
        onChange={(e) => {
          setQ(e.target.value)
          setFound(null)
          setErr('')
        }}
        placeholder="접수번호를 적어 주세요"
        autoComplete="off"
        autoCapitalize="characters"
        aria-invalid={!!err}
        aria-describedby={err ? 'rl-err' : undefined}
      />
      {err && (
        <Sentences as="p" id="rl-err" className="rf-err" role="alert">
          {err}
        </Sentences>
      )}
      <button type="submit" className="pg-wide">
        찾기
      </button>
      {found && found.length === 0 && (
        <div className="empty-act">
          <button type="button" className="pg-wide" onClick={() => go(TO.newReport)}>
            문제 제보하러 가기
          </button>
        </div>
      )}
      {found && found.length > 1 && (
        <ul className="rp-list" aria-label="찾은 제보">
          {found.map((r) => (
            <li key={r.id}>
              <button type="button" className="rp-row" onClick={() => onOpen(r.id)}>
                <span className="rp-row-text">
                  <strong>{r.type}</strong>
                  <span className="bm-meta">{r.complaint?.receiptNo}</span>
                </span>
                <span className={'rp-badge rp-' + r.status}>{STATUS_LABEL[r.status]}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </form>
  )
}
