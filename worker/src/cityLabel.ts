// 접속 지역 표시 글자(개발자 관리용). Cloudflare의 regionCode는 한국에서 「29」 또는 「KR-29」로 올 수 있어 둘 다 받는다.
const KR_REGIONS: Record<string, string> = {
  '11': '서울', '26': '부산', '27': '대구', '28': '인천', '29': '광주', '30': '대전', '31': '울산', '50': '세종',
  '41': '경기', '42': '강원', '51': '강원', '43': '충북', '44': '충남', '45': '전북', '52': '전북', '46': '전남', '47': '경북', '48': '경남', '49': '제주',
}
const KR_DO = new Set(['41', '42', '51', '43', '44', '45', '52', '46', '47', '48', '49'])

export function cityLabel(city: string | null | undefined, regionCode: string | null | undefined, country: string | null | undefined): string | null {
  const code = (regionCode ?? '').replace(/^KR-/i, '')
  if (country === 'KR' && KR_REGIONS[code]) return KR_DO.has(code) && city ? `${KR_REGIONS[code]} ${city}` : KR_REGIONS[code]
  const parts = [city, country].filter((x): x is string => !!x)
  return parts.length ? parts.join(', ') : null
}
