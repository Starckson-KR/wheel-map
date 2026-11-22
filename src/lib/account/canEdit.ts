import type { Report } from '../../types'
import { useAccount } from './api'

// 서버는 이미 있는 제보를 작성자와 개발자 계정의 변경만 받는다(이웃 확인 투표 제외). 그 밖의 버튼은 보이지 않게 한다.
// 로그인하지 않은 시연(이 기기에만 저장)은 모두 고칠 수 있다.
export const canEditReport = (r: Pick<Report, 'userId'>, user: { id: string; role?: string } | null): boolean => !user || user.role === 'dev' || r.userId === user.id
export const useCanEdit = (r: Pick<Report, 'userId'>): boolean => canEditReport(r, useAccount((s) => s.user))
