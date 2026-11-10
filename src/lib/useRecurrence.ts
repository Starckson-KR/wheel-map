import { useMemo } from 'react'
import { computeRecurrence, type RecurrenceResult } from './recurrence'
import { useReports } from './reportStore'

// 저장된 민원 전체에서 재발 건을 계산한다(화면 어디서나 같은 결과).
export function useRecurrence(): RecurrenceResult {
  const reports = useReports((s) => s.reports)
  return useMemo(() => computeRecurrence(reports), [reports])
}
