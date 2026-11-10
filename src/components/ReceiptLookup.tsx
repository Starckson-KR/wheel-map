import { useState } from 'react'
import { findByReceipt } from '../lib/externalStatus'
import { STATUS_LABEL, useReports } from '../lib/reportStore'
import type { Report } from '../types'

// 접수번호로 내 민원 찾기. 서버가 없어서 이 기기에 저장된 민원에서만 찾는다.
export default function ReceiptLookup({ onOpen }: { onOpen: (id: string) => void }) {
  const reports = useReports((s) => s.reports)
  const [q, setQ] = useState('')
  const [found, setFound] = useState<Report[] | null>(null)

  const search = (e: React.FormEvent) => {
    e.preventDefault()
    const hit = findByReceipt(reports, q)
    if (hit.length === 1) {
      onOpen(hit[0].id)
      return
    }
    setFound(hit)
  }

  return (
    <form className="rl" onSubmit={search}>
      <label className="rf-field">
        접수번호로 내 민원 찾기
        <input
          type="text"
          value={q}
          onChange={(e) => {
            setQ(e.target.value)
            setFound(null)
          }}
          placeholder="접수하고 받은 번호"
          autoComplete="off"
          autoCapitalize="characters"
        />
      </label>
      <p className="bm-meta">이 앱에는 서버가 없어서 이 기기에 저장된 민원에서만 찾아요. 대소문자와 하이픈(-)은 구분하지 않아요.</p>
      <button type="submit" className="pg-wide" disabled={!q.trim()}>
        찾기
      </button>
      {found && found.length === 0 && (
        <p className="rf-warn" role="status">
          이 기기에 저장된 민원에서 찾지 못했어요. 번호를 다시 확인하거나, 다른 기기에서 접수한 민원이라면 이 앱에는 없을 수 있어요.
        </p>
      )}
      {found && found.length > 1 && (
        <ul className="rp-list" aria-label="찾은 민원">
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
