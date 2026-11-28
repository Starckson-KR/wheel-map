// AI 답변(/answer)이 찾아봐도 되는 공공 사이트 목록. 여기 있는 곳에서만 검색한다(웹 검색 도구의 allowed_domains).
// 넣는 기준: 공공기관이 운영하는 사이트이고, 직접 열어 주소와 사이트 이름을 확인한 것만. `.go.kr`이 아니어도 확인된 공공기관이면 넣는다.
// 적는 법: 스킴(https://)·www 없이 도메인만(ASCII). 하위 도메인은 자동으로 포함된다(gwangju.go.kr → www.gwangju.go.kr).
// name은 그 사이트 첫 화면의 제목·기관 이름 그대로다(화면의 출처 줄에 쓴다).
// 확인: 2026-11-28 첫 화면을 열어 제목 확인(HTTP 200).
export type PublicSite = { domain: string; name: string }

export const PUBLIC_SITES: readonly PublicSite[] = [
  { domain: 'mohw.go.kr', name: '보건복지부' },
  { domain: 'bokjiro.go.kr', name: '복지로' },
  { domain: 'gov.kr', name: '정부24' },
  { domain: 'law.go.kr', name: '국가법령정보센터' },
  { domain: 'mois.go.kr', name: '행정안전부' },
  { domain: 'molit.go.kr', name: '국토교통부' },
  { domain: 'kead.or.kr', name: '한국장애인고용공단' },
  { domain: 'ableservice.or.kr', name: '장애인활동지원' },
  { domain: 'nhis.or.kr', name: '국민건강보험' },
  { domain: 'safekorea.go.kr', name: '국민안전24' },
  { domain: 'data.go.kr', name: '공공데이터포털' },
  { domain: 'gwangju.go.kr', name: '전남광주통합특별시(구 광주광역시)' },
  { domain: 'bukgu.gwangju.kr', name: '전남광주통합특별시 북구' },
  { domain: 'gjtsc.com', name: '광주광역시교통약자이동지원센터' }, // 새빛콜. 공공기관이지만 go.kr이 아니다
]

export const ALLOWED_DOMAINS: string[] = PUBLIC_SITES.map((s) => s.domain)

// 주소가 목록 안의 사이트(또는 그 하위 도메인)면 그 사이트를, 아니면 null을 돌려준다.
export function siteOf(url: string): PublicSite | null {
  let host: string
  try {
    const u = new URL(url)
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return null
    host = u.hostname.toLowerCase()
  } catch {
    return null
  }
  // 더 구체적인 도메인(bukgu.gwangju.kr)이 먼저 맞도록 긴 것부터 본다.
  const sorted = [...PUBLIC_SITES].sort((a, b) => b.domain.length - a.domain.length)
  return sorted.find((s) => host === s.domain || host.endsWith('.' + s.domain)) ?? null
}
