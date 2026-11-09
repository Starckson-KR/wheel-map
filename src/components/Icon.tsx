// 직접 그린 단순 선 아이콘(외부 이미지·다른 앱 그림 없음)
const P: Record<string, string> = {
  user: 'M12 4a4 4 0 1 0 0 8 4 4 0 0 0 0-8zM4 21c0-4.4 3.6-7 8-7s8 2.6 8 7',
  map: 'M12 21s7-6.2 7-11.5a7 7 0 0 0-14 0C5 14.8 12 21 12 21zM12 7a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5z',
  report: 'M6 3h9l4 4v14H6zM15 3v4h4M12 11v6M9 14h6',
  bell: 'M6 16v-5a6 6 0 0 1 12 0v5l1.5 2h-15zM10 21h4',
  route: 'M6 16a2 2 0 1 0 0 4 2 2 0 0 0 0-4zM18 4a2 2 0 1 0 0 4 2 2 0 0 0 0-4zM8 18h6a3 3 0 0 0 0-6h-4a3 3 0 0 1 0-6h6',
  list: 'M5 6a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v13a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2zM9 11h6M9 15h4',
  bus: 'M7 4h10a3 3 0 0 1 3 3v10H4V7a3 3 0 0 1 3-3zM4 12h16M8 17v3M16 17v3',
  building: 'M5 21V5l7-2 7 2v16zM9 21v-4h6v4M9 9h2M13 9h2M9 13h2M13 13h2',
  cross: 'M3 8h18M3 12h18M3 16h18',
  enter: 'M14 3h5v18h-5M4 12h11M11 8l4 4-4 4',
  help: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.7.4-1 1-1 1.7M12 17h.01',
  search: 'M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zM16.5 16.5L20 20',
  chev: 'M9 6l6 6-6 6',
  chevL: 'M15 6l-6 6 6 6',
  chevD: 'M6 9l6 6 6-6',
  home: 'M4 11l8-7 8 7v9h-5v-6H9v6H4z',
  plus: 'M12 5v14M5 12h14',
  menu: 'M4 7h16M4 12h16M4 17h16',
  check: 'M5 12.5l4.5 4.5L19 7.5',
  star: 'M12 3.5l2.7 5.6 6.1.8-4.5 4.2 1.1 6-5.4-3-5.4 3 1.1-6-4.5-4.2 6.1-.8z',
  clock: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM12 7v5l3 2',
  close: 'M6 6l12 12M18 6L6 18',
}
export default function Icon({ name, size = 24 }: { name: string; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      <path d={P[name] ?? ''} />
    </svg>
  )
}
