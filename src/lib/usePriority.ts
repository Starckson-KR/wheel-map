import { useEffect, useMemo, useState } from 'react'
import type { Barrier } from '../types'
import { loadPubDataset, type PubDataset } from './publicLayers'
import { computePriority, type Cand } from './priority'
import { useReports } from './reportStore'
import { loadNoAlt } from './routing/noAlt.ts'

// 우선순위 화면과 개선계획·예산 화면이 함께 쓰는 계산 훅.
export function usePriority(barriers: Barrier[]): { rows: Cand[]; data: { bus: PubDataset; fac: PubDataset } | null; err: string } {
  const reports = useReports((s) => s.reports)
  const [data, setData] = useState<{ bus: PubDataset; fac: PubDataset } | null>(null)
  const [err, setErr] = useState('')

  useEffect(() => {
    let cancelled = false
    Promise.all([loadPubDataset('bus'), loadPubDataset('facility')])
      .then(([bus, fac]) => !cancelled && setData({ bus, fac }))
      .catch(() => !cancelled && setErr('이용 수요 자료(정류장·시설)를 불러오지 못했어요.'))
    return () => {
      cancelled = true
    }
  }, [])

  const rows = useMemo<Cand[]>(() => (data ? computePriority(barriers, reports, data, loadNoAlt()) : []), [data, barriers, reports])
  return { rows, data, err }
}
