import type { PubItem } from './publicLayers'

// 편의시설 자료(건축물 현황)의 이름에는 지번·건축물 용도·괄호 속 소유자 이름이 그대로 들어 있는 것이 있다.
// 화면에는 그런 원본 이름을 보이지 않고, 상호로 쓸 만한 이름만 쓴다. 쓸 만한 이름이 없으면 자료에 실제 있는 업종과 주소(도로명·동)로 만든다. 없는 이름은 지어내지 않는다.

const CITY_RE = /^(전남광주통합특별시|광주광역시|광주)\s*/
const USE_WORDS = /근린생활시설|단독주택|다가구|다세대|연립주택|공동주택|제\s*\d\s*종|업무시설|판매시설|창고|공장|숙박시설/
const LOT_RE = /[가-힣]+\d*[동리가]\s*산?\d+(-\d+)?/

/** 괄호와 그 안의 글(사람 이름 등)을 뺀 이름 */
export const stripParens = (s: string): string => s.replace(/\([^)]*\)?/g, ' ').replace(/\s+/g, ' ').trim()

function typeShort(type: string): string {
  const t = type.trim()
  if (t.length <= 12) return t
  return t.split(/[·,(]/)[0].trim()
}

/** 상호로 쓸 만한 이름이면 그 이름, 아니면 null */
export function usableName(name: string, type: string): string | null {
  const n = stripParens(name)
  if (n.length < 2) return null
  if (USE_WORDS.test(n) || LOT_RE.test(n)) return null
  const generic = typeShort(type)
  if (n === type.trim() || n === generic || /^[·\s가-힣]*(음식점|제과점|소매점|의원|병원)$/.test(n) && n.includes('·')) return null
  return n
}

/** 도로명 주소(또는 동)와 동 이름 */
function place(address: string): string {
  const dong = /\(([가-힣0-9]+동)/.exec(address)?.[1]
  const base = stripParens(address).replace(CITY_RE, '').replace(/^북구\s*/, '').trim()
  return [base, dong && !base.includes(dong) ? dong : ''].filter(Boolean).join(' ')
}

/** 카드·팝업에 보일 시설 이름 */
export function facilityTitle(it: Pick<PubItem, 'name' | 'address' | 'fields'>): string {
  const type = String(it.fields['faclTyCd'] ?? '')
  const ok = usableName(it.name, type)
  if (ok) return ok
  const where = place(it.address)
  const t = typeShort(type)
  return [t, where].filter(Boolean).join(' · ') || '편의시설'
}
