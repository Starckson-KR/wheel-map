// 해시 라우팅 도우미: #/(홈) #/map #/report #/me #/alerts, 기존 #/verify #/admin
export type PageId = 'home' | 'map' | 'report' | 'me' | 'alerts' | 'verify' | 'admin'
export type Route = { page: PageId; query: string }

export function parseHash(hash: string): Route {
  const [p, q = ''] = hash.replace(/^#/, '').split('?')
  const seg = p.replace(/^\/+/, '').split('/')[0]
  const page: PageId = (['map', 'report', 'me', 'alerts', 'verify', 'admin'] as const).find((x) => x === seg) ?? 'home'
  return { page, query: q }
}

export const go = (to: string) => {
  location.hash = to
}

export const TO = {
  home: '#/',
  map: '#/map',
  route: '#/map?go=route',
  bus: '#/map?go=route&mode=bus',
  progress: '#/map?go=progress',
  newReport: '#/map?go=report',
  report: '#/report',
  agency: '#/report?section=agency',
  me: '#/me',
  alerts: '#/alerts',
  admin: '#/admin',
  openReport: (id: string) => `#/map?report=${encodeURIComponent(id)}`,
}
