// 신고 유형 아이콘: 직접 그린 단순 선 아이콘(Icon.tsx와 같은 24칸, 굵기 2). 외부 이미지·다른 앱 그림 없음
const PATHS: Record<string, string> = {
  '계단·턱': 'M4 20h4v-4h4v-4h4V8h4M4 20h16',
  '좁은 보도': 'M9 4v16M15 4v16M2 12h4M22 12h-4M4 10l-2 2 2 2M20 10l2 2-2 2',
  '급경사': 'M3 19h18V8L3 19zM8 16l2-2',
  '파손 노면': 'M3 20h18M4 8l5 3-3 3 6 2-2 4M15 9l2 3-2 2',
  '경사로 없음': 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM5.6 5.6l12.8 12.8',
  '수동문': 'M6 21V4h12v17M3 21h18M14 12h.01',
  '장애인화장실 없음': 'M12 3a2 2 0 1 0 0 4 2 2 0 0 0 0-4zM8 21v-6M16 21v-6M7 9h10l-1 6H8z',
  '쓰레기': 'M5 7h14M9 7V4h6v3M7 7l1 14h8l1-14M10 11v6M14 11v6',
  '킥보드·자전거': 'M5 20a2 2 0 1 0 0-4 2 2 0 0 0 0 4zM19 20a2 2 0 1 0 0-4 2 2 0 0 0 0 4zM7 18h10M17 18L15 4h-3',
  '입간판·노점': 'M6 20l2-14h8l2 14M5 20h14M9 11h6',
  '공사 자재': 'M12 3l5 16H7zM5 21h14M9.5 11h5',
  '불법 주정차': 'M4 16v-4l2-5h12l2 5v4zM4 16v3M20 16v3M7 13h.01M17 13h.01',
}

export default function ReportTypeIcon({ type, size = 24 }: { type: string; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      <path d={PATHS[type] ?? 'M12 5v14M5 12h14'} />
    </svg>
  )
}
