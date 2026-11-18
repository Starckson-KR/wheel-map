import { isExpired } from '../benefits'
import type { Benefit } from '../benefits'
import { listAgencies, channelLinks } from '../agencyGuide'
import type { Agency } from '../agencyGuide'
import { distanceM } from '../geo'
import { TO } from '../nav'
import type { PubDataset, PubItem } from '../publicLayers'
import { GUIDE_SLIDES } from '../usageGuide'
import { keywordSlots } from './keywords'

// 지식형 질문(ask) 답하기: 모델은 주제(topic)와 검색어만 고르고, 답 문장은 앱이 가진 자료(JSON)에서 그대로 꺼낸다.
// 이 파일은 순수 함수만 둔다(자료는 인자로 받는다). 자료를 불러오는 일은 knowledgeData.ts가 한다.

export const TOPICS = ['benefit', 'toilet', 'facility', 'voucher', 'bus', 'agency', 'howto'] as const
export type Topic = (typeof TOPICS)[number]
export const isTopic = (v: unknown): v is Topic => typeof v === 'string' && (TOPICS as readonly string[]).includes(v)

export type Card = { id: string; title: string; answer: string; meta?: string; source: string; sourceUrl?: string }
export type Go = { label: string; hash: string }
export type AskAnswer = { topic: Topic | null; cards: Card[]; total: number; go: Go[]; found: boolean }
export type LatLng = { lat: number; lng: number }

export type KnowledgeData = {
  benefits?: Benefit[]
  agencies?: Agency[]
  toilets?: PubDataset
  facilities?: PubDataset
  vouchers?: PubDataset
  busStops?: PubDataset
}

export const MAX_CARDS = 3

// ---------- 글자 다루기 ----------
const squash = (s: string) => s.toLowerCase().replace(/\s+/g, '')
const WORD_RE = /[가-힣a-z0-9]+/g
const rawWords = (s: string): string[] => s.toLowerCase().match(WORD_RE) ?? []

// 말 끝 조사(공백 단위 낱말 끝). 줄이면 2글자 미만이 되는 낱말은 건드리지 않는다.
const JOSA_RE = /(에서는|에서도|에서|으로는|으로|한테|까지|부터|이랑|이나|이고|인데|에는|에도|은|는|이|가|을|를|에|의|도|와|과|랑|요)$/
export function stripJosa(w: string): string {
  const m = w.replace(JOSA_RE, '')
  return m.length >= 2 ? m : w
}

// 낱말 안에서 이웃한 두 글자씩(공백을 가로지르지 않는다)
function bigramsOfWords(s: string): string[] {
  const out: string[] = []
  for (const w of rawWords(s)) for (let i = 0; i + 1 < w.length; i++) out.push(w.slice(i, i + 2))
  return out
}
// 자료 쪽은 공백을 지운 글에서 뽑는다(띄어쓰기가 달라도 맞게)
function bigramsOfText(s: string): Set<string> {
  const t = squash(s).replace(/[^가-힣a-z0-9]/g, '')
  const out = new Set<string>()
  for (let i = 0; i + 1 < t.length; i++) out.add(t.slice(i, i + 2))
  return out
}

type Index = { sets: Set<string>[]; df: Map<string, number> }
const INDEX_CACHE = new WeakMap<object, Index>()
function indexOf<T>(docs: T[], text: (d: T) => string): Index {
  const hit = INDEX_CACHE.get(docs)
  if (hit) return hit
  const sets = docs.map((d) => bigramsOfText(text(d)))
  const df = new Map<string, number>()
  for (const s of sets) for (const b of s) df.set(b, (df.get(b) ?? 0) + 1)
  const idx = { sets, df }
  INDEX_CACHE.set(docs, idx)
  return idx
}

// 질문 말투에서 나오는 흔한 두 글자(자료 낱말이 아니다)는 점수에서 뺀다.
const STOP_BIGRAMS = new Set(['어디', '어떻', '어떤', '얼마', '해요', '나요', '있어', '있나', '있는', '받아', '불러', '알려', '주세', '세요', '하는', '하나', '싶어', '궁금', '방법', '신청', '가능', '수있', '할수', '쓸수', '갈수', '될까', '인가', '입니', '이에', '해주', '해줘', '되나', '돼요', '되요', '가요', '까요', '어서', '에서', '으로', '한테', '해서', '하면', '려면', '하려', '어요', '아요', '같은', '있을', '없나', '찾아', '보여', '좀알', '말해', '무엇', '뭐가', '뭐야', '뭔가', '이랑', '이나', '하고', '지만', '인데', '는데', '은데'])

// 질문의 두 글자 조각이 자료 글에 얼마나 있는지 점수를 낸다. 드문 조각(그 자료에만 있는 낱말)일수록 크고, 모든 자료에 있는 조각은 거의 0이다.
function scoreDocs<T>(docs: T[], text: (d: T) => string, question: string): number[] {
  const { sets, df } = indexOf(docs, text)
  const n = docs.length || 1
  const norm = Math.log(1 + n)
  const qb = [...new Set(bigramsOfWords(question))].filter((b) => !STOP_BIGRAMS.has(b))
  return sets.map((s) => {
    let sum = 0
    for (const b of qb) if (s.has(b)) sum += Math.log(1 + n / (df.get(b) ?? 1)) / norm
    return sum
  })
}

// ---------- 동의어(질문에 이 말이 있으면 자료에 쓰인 말을 질문에 덧붙인다) ----------
const BENEFIT_SYN: [RegExp, string][] = [
  [/택시|콜택시|새빛콜|특별교통|이동지원|이동수단|교통약자|이동이불편/, '교통약자 이동지원 특별교통수단 새빛콜'],
  [/자동차표지|주차표지|주차증|주차스티커|장애인주차|주차카드/, '장애인 자동차 표지 발급'],
  [/보장구|전동휠체어|스쿠터|휠체어(수리|급여|구입|구매|지원|사려|살)|급여/, '보장구 건강보험 급여'],
  [/보조기기|교부/, '보조기기 교부사업'],
  [/충전/, '전동보장구 충전소'],
  [/활동지원|활동보조|활보|도우미|돌봄|간병|활동지원사/, '장애인활동지원'],
  [/연금/, '장애인연금'],
  [/수당|용돈|지원금|생활비/, '장애수당 장애아동수당'],
  [/집수리|주택개조|개조|문턱제거|문턱(을|도)?(없애|제거|낮)|욕실|집고치|집(에|을)?(턱|계단)/, '장애인 주택개조사업'],
  [/자립|복지관|복지시설|센터/, '복지시설 자립생활센터'],
  [/스포츠|운동|수영|헬스|체육|강좌이용권/, '스포츠강좌이용권'],
  [/문화누리|문화카드|문화생활|통합문화|문화바우처/, '문화누리카드 통합문화이용권'],
  [/여행|관광|무장애|나들이/, '열린관광 모두의 여행 무장애 여행지'],
  [/콘서트|공연|비엔날레|음악회|행사/, '비엔날레 문화콘서트'],
  [/음식|요리|쿠킹|전통음식|박물관/, '전통음식강좌'],
]
const GENERIC_BENEFIT = /혜택|복지|받을수|받을\s*수|지원|도움|뭐가있|뭐있/

// ---------- 주제 짐작 ----------
// 낱말로 주제를 짐작하는 표. 위에 있을수록 먼저(뜻이 분명한 낱말일수록 위). 「식당·병원」 같은 시설 종류 말은 화장실보다 앞이다(「화장실 있는 카페」는 편의시설 질문).
const TOPIC_CUES: [Topic, RegExp][] = [
  ['voucher', /상품권|가맹|지역화폐|북구카드|지역사랑|모바일상품권/],
  ['facility', /식당|음식점|밥집|맛집|카페|병원|의원|약국|마트|편의점|경로당|학교|교회|성당|주차장|대피소/],
  ['toilet', /화장실|변기|기저귀/],
  ['bus', /저상|버스|정류장|정류소|정거장/],
  ['howto', /(신고|제보|민원|접수).{0,8}(어디|어떻게|어케|방법|하는법|하려면|창구|채널|넣|해요|할래)|(어디|어떻게|어케|방법).{0,8}(신고|제보|민원|접수)|앱.{0,4}(어떻게|어케|사용법|쓰는)|사용법/],
  ['agency', /담당|소관|관할|어느기관|어디서처리|어느부서/],
  ['benefit', /택시|새빛콜|이동지원|교통약자|특별교통|혜택|수당|연금|보조기기|보장구|충전|활동지원|활동보조|자동차표지|주차(표지|증|스티커|카드)|주택개조|집(수리|고치|개조)|문턱(을|도)?(없애|제거|낮)|문화누리|스포츠|강좌|바우처|복지|행사|공연|콘서트|여행|급여|지원금|수리비|보조금|도우미|돌봄/],
  ['facility', /편의시설|엘리베이터|엘베|승강기|경사로|문턱|들어갈수|들어갈\s*수/],
]
export function guessTopics(question: string): Topic[] {
  const s = squash(question)
  const out: Topic[] = []
  for (const [t, re] of TOPIC_CUES) if (re.test(s) && !out.includes(t)) out.push(t)
  return out
}

// 시험해 볼 주제 순서: 낱말 단서로 짐작한 주제를 먼저(단서가 분명하다), 모델이 고른 주제는 그 뒤. 짐작할 단서가 없으면 모델의 주제만 쓴다.
export function candidateTopics(question: string, modelTopic?: string): Topic[] {
  const out = guessTopics(question)
  if (isTopic(modelTopic) && !out.includes(modelTopic)) out.push(modelTopic)
  return out
}

// ---------- 공통 ----------
const GO: Record<Topic, Go[]> = {
  benefit: [{ label: '혜택·행사 보기', hash: TO.benefits }],
  toilet: [{ label: '장애인화장실 지도 보기', hash: '#/map?layer=toilet' }],
  facility: [{ label: '휠체어 길찾기 열기', hash: TO.route }],
  voucher: [{ label: '가맹점 지도 보기', hash: '#/map?layer=voucher' }],
  bus: [{ label: '저상버스 도착 보기', hash: TO.bus }],
  agency: [{ label: '담당 기관 안내 보기', hash: TO.agency }],
  howto: [{ label: '신고하기 열기', hash: TO.newReport }],
}

const clean = (v: unknown): string => (typeof v === 'string' ? v.trim() : '')
// 자료의 evalInfo는 같은 항목이 두 번 적힌 곳이 있어 한 번씩만 보여 준다.
const uniqInfo = (v: string): string => [...new Set(v.split(',').map((x) => x.trim()).filter(Boolean))].join(', ')
const dedupeCards = (cards: Card[]): Card[] => {
  const seen = new Set<string>()
  return cards.filter((c) => {
    const k = squash(`${c.title}${c.answer}`)
    if (seen.has(k)) return false
    seen.add(k)
    return true
  })
}
const known = (v: string) => !!v && v !== '확인 필요' && !v.startsWith('TODO')

// 질문 속 장소 낱말(OO동·OO대·OO로 …)이 자료의 이름·주소에 실제로 있으면 그 자료만 남긴다. 어느 자료에도 없거나 거의 전부에 있으면 걸러 내지 않는다.
const PLACE_RE = /^[가-힣0-9]{2,}(동|구|길|역|대|대학교|대학|시장|공원|구청|청사|센터|병원|아파트|마을|단지|사거리|터미널|교)$|^[가-힣0-9]{2,}(대로|로)$/
const NOT_PLACE = new Set(['교환대', '접수대', '안내대', '세면대', '계산대', '진열대', '승강대', '경사로', '아파트', '대학교', '복지센터', '진입로', '접근로', '미끄럼방지', '엘리베이터', '이용할수', '갈수있는', '인도', '차도'])
export function placeWords(question: string): string[] {
  const out: string[] = []
  for (const w of rawWords(question)) {
    for (const v of [w, stripJosa(w)]) {
      if (NOT_PLACE.has(v) || !PLACE_RE.test(v)) continue
      if (!out.includes(v)) out.push(v)
    }
  }
  return out
}
// 동·역·대학·병원 이름처럼 분명한 장소 낱말이 자료 어디에도 없으면, 엉뚱한 곳을 보여 주지 않고 결과를 비운다.
const STRICT_PLACE_RE = /^[가-힣0-9]{2,}(동|역|대|대학교|대학|병원|시장|공원|구청|아파트|센터)$/
function placeFilter<T>(items: T[], question: string, text: (t: T) => string): T[] {
  let cur = items
  for (const w of placeWords(question)) {
    const next = cur.filter((i) => squash(text(i)).includes(w))
    if (next.length === 0 && STRICT_PLACE_RE.test(w)) return []
    if (next.length > 0 && next.length < cur.length) cur = next
  }
  return cur
}

// 가까운 순(위치를 아는 경우), 아니면 주어진 점수 순
function pickCards<T extends { lat: number | null; lng: number | null }>(items: T[], origin: LatLng | undefined, score: (i: T) => number): T[] {
  const withD = items.map((i) => ({ i, d: origin && i.lat != null && i.lng != null ? distanceM(origin.lat, origin.lng, i.lat, i.lng) : null, s: score(i) }))
  withD.sort((a, b) => (a.d !== null && b.d !== null ? a.d - b.d : b.s - a.s))
  return withD.map((x) => x.i)
}
export function distanceText(m: number): string {
  if (m < 1000) return `약 ${Math.max(10, Math.round(m / 10) * 10)}m`
  return `약 ${(m / 1000).toFixed(1)}km`
}
function metaOf(address: string, item: { lat: number | null; lng: number | null }, origin?: LatLng): string | undefined {
  const parts: string[] = []
  if (origin && item.lat != null && item.lng != null) parts.push(distanceText(distanceM(origin.lat, origin.lng, item.lat, item.lng)))
  if (address) parts.push(address.replace(/^(전남광주통합특별시|광주광역시|광주)\s*/, ''))
  return parts.length ? parts.join(' · ') : undefined
}

// ---------- 편의시설 항목(evalInfo) ----------
// 질문 속 조건 → 자료(evalInfo)에 쓰인 항목 이름. 공백을 지워 비교한다.
const FEATURES: [RegExp, string][] = [
  [/경사로|문턱|단차|높이차|계단(이|은)?없|턱(이|은)?없|턱없|휠체어(로|가)?들어|휠체어(로|가)?갈수|휠체어(로|가)?이용|휠체어접근/, '주출입구높이차이제거'],
  [/엘리베이터|엘베|승강기/, '승강기'],
  [/장애인화장실|화장실/, '장애인사용가능화장실'],
  [/장애인주차|주차/, '장애인전용주차구역'],
  [/접근로|진입로/, '주출입구접근로'],
  [/점자|안내설비|유도/, '유도및안내설비'],
]
const wantedFeatures = (question: string): string[] => {
  const s = squash(question)
  return FEATURES.filter(([re]) => re.test(s)).map(([, f]) => f)
}
const hasFeature = (evalInfo: string, f: string) => squash(evalInfo).includes(f)

// 시설 종류 말 → 자료(faclTyCd) 이름 판정
const FACILITY_TYPES: [RegExp, RegExp][] = [
  [/식당|음식점|밥집|맛집|한식|분식|치킨|고깃집|술집|레스토랑/, /음식점/],
  [/카페|커피|제과|빵집|베이커리/, /휴게음식점|제과/],
  [/약국/, /약국/],
  [/병원|의원|내과|치과|한의원|정형외과|소아과|클리닉/, /병원|의원/],
  [/마트|편의점|슈퍼|가게|상점|시장/, /소매점|마트|판매시설|재래시장|^시장/],
  [/경로당|복지관|노인|요양|주간보호/, /노인|복지|경로/],
  [/학교|초등|중학|고등|대학/, /학교|학원|교육/],
  [/교회|성당|사찰|예배|종교/, /종교/],
  [/주차장/, /주차장/],
  [/대피소|피난/, /대피소/],
  [/아파트|빌라|연립|다세대/, /아파트|연립|다세대|주택/],
  [/주민센터|구청|동사무소|관공서|행정복지|공공기관/, /공공|청사|관공/],
]
const facilityTypeTests = (question: string): RegExp[] => {
  const s = squash(question)
  return FACILITY_TYPES.filter(([re]) => re.test(s)).map(([, t]) => t)
}

// ---------- 주제별 검색 ----------
type Hit = { cards: Card[]; total: number }

function searchBenefits(q: string, d: KnowledgeData, now: number): Hit {
  const all = (d.benefits ?? []).filter((b) => !isExpired(b, now))
  if (!all.length) return { cards: [], total: 0 }
  const s = squash(q)
  const extra = BENEFIT_SYN.filter(([re]) => re.test(s)).map(([, add]) => add).join(' ')
  const scores = scoreDocs(all, (b) => `${b.title} ${b.summary}`, `${q} ${extra}`)
  const ranked = all.map((b, i) => ({ b, sc: scores[i] })).sort((x, y) => y.sc - x.sc)
  let pool = ranked.filter((r) => r.sc >= 0.7 && r.sc >= ranked[0].sc * 0.7)
  if (!pool.length && GENERIC_BENEFIT.test(q)) pool = all.filter((b) => b.wheelchairRelevant === true).map((b) => ({ b, sc: 0 }))
  const card = (b: Benefit): Card => ({
    id: b.id,
    title: b.title,
    answer: b.summary,
    meta: known(b.agency) ? b.agency : undefined,
    source: b.sourceName,
    sourceUrl: b.sourceUrl,
  })
  return { cards: pool.slice(0, MAX_CARDS).map((r) => card(r.b)), total: pool.length }
}

function searchToilets(q: string, d: KnowledgeData, origin?: LatLng): Hit {
  const ds = d.toilets
  if (!ds) return { cards: [], total: 0 }
  const s = squash(q)
  const f = (it: PubItem) => it.fields as Record<string, unknown>
  let pool = ds.items.filter((i) => i.lat != null && i.lng != null)
  const wantAccessible = /장애인|휠체어|경사로|턱|문턱/.test(s)
  if (wantAccessible) pool = pool.filter((i) => Number(f(i)['장애인용위생시설합계'] ?? 0) > 0)
  if (/24시|밤|새벽|상시|언제나/.test(s)) pool = pool.filter((i) => /상시|24/.test(clean(f(i)['개방시간'])))
  if (/기저귀|아기|유아/.test(s)) pool = pool.filter((i) => clean(f(i)['기저귀교환대유무']) === 'Y')
  if (/비상벨/.test(s)) pool = pool.filter((i) => clean(f(i)['비상벨설치여부']) === 'Y')
  pool = placeFilter(pool, q, (i) => `${i.name} ${i.address}`)
  // 경사로·승강기 같은 출입 조건은 같은 곳의 편의시설 자료(evalInfo)에 있는 경우만 확인할 수 있다.
  const feats = wantedFeatures(q).filter((x) => x !== '장애인사용가능화장실' && x !== '장애인전용주차구역')
  if (feats.length && d.facilities) {
    const facs = d.facilities.items.filter((i) => /화장실/.test(clean(f(i)['faclTyCd'])) && clean(f(i)['evalInfo']) && feats.every((x) => hasFeature(clean(f(i)['evalInfo']), x)) && hasFeature(clean(f(i)['evalInfo']), '장애인사용가능화장실'))
    const byFac = facs.map((it) => ({ it, info: clean(f(it)['evalInfo']) }))
    const filtered = placeFilter(byFac, q, (x) => `${x.it.name} ${x.it.address}`)
    const ordered = pickCards(filtered.map((x) => ({ ...x, lat: x.it.lat, lng: x.it.lng })), origin, (x) => x.info.length)
    const cards = dedupeCards(ordered.slice(0, MAX_CARDS * 4).map((x): Card => ({
      id: x.it.id,
      title: x.it.name,
      answer: `${clean(f(x.it)['faclTyCd'])} · ${uniqInfo(x.info)}`,
      meta: metaOf(x.it.address, x.it, origin),
      source: d.facilities?.source ?? '장애인편의시설 현황',
    }))).slice(0, MAX_CARDS)
    return { cards, total: filtered.length }
  }
  const ordered = pickCards(pool, origin, (i) => Number(f(i)['장애인용위생시설합계'] ?? 0))
  const cards = ordered.slice(0, MAX_CARDS).map((i): Card => {
    const n = Number(f(i)['장애인용위생시설합계'] ?? 0)
    const time = clean(f(i)['개방시간'])
    const bits = [clean(f(i)['구분명']), n > 0 ? `장애인용 시설 ${n}개` : '', /상시|24/.test(time) ? '상시 개방' : '', clean(f(i)['기저귀교환대유무']) === 'Y' ? '기저귀 교환대 있음' : ''].filter(Boolean)
    return { id: i.id, title: i.name, answer: bits.join(' · '), meta: metaOf(i.address, i, origin), source: ds.source }
  })
  return { cards, total: pool.length }
}

function searchFacilities(q: string, d: KnowledgeData, origin?: LatLng): Hit {
  const ds = d.facilities
  if (!ds) return { cards: [], total: 0 }
  const f = (it: PubItem) => it.fields as Record<string, unknown>
  const feats = wantedFeatures(q)
  const types = facilityTypeTests(q)
  // 출입 조건은 편의시설 상세(evalInfo)가 있는 시설에서만 확인할 수 있다.
  let pool = ds.items.filter((i) => i.lat != null && i.lng != null && clean(f(i)['evalInfo']))
  if (feats.length) pool = pool.filter((i) => feats.every((x) => hasFeature(clean(f(i)['evalInfo']), x)))
  if (types.length) pool = pool.filter((i) => types.some((t) => t.test(clean(f(i)['faclTyCd']))))
  pool = placeFilter(pool, q, (i) => `${i.name} ${i.address}`)
  // 종류도 조건도 장소도 못 알아들었으면 답할 수 없다(아무 시설이나 보여 주지 않는다).
  if (!types.length && placeWords(q).length === 0) return { cards: [], total: 0 }
  const ordered = pickCards(pool, origin, (i) => clean(f(i)['evalInfo']).length)
  const cards = dedupeCards(
    ordered.slice(0, MAX_CARDS * 4).map((i): Card => ({
      id: i.id,
      title: i.name,
      answer: `${clean(f(i)['faclTyCd'])} · ${uniqInfo(clean(f(i)['evalInfo']))}`,
      meta: metaOf(i.address, i, origin),
      source: ds.source,
    })),
  ).slice(0, MAX_CARDS)
  return { cards, total: pool.length }
}

const CATEGORY_WORDS: [RegExp, RegExp][] = [
  [/식당|음식점|밥집|맛집|한식|분식|치킨|고깃집|술집|카페|커피|먹/, /음식점/],
  [/마트|편의점|슈퍼|소매|쇼핑|옷|신발|안경|꽃/, /소매업/],
  [/미용|이발|머리|세탁|네일|피부/, /개인 서비스/],
  [/학원|교육|공부|과외/, /교육/],
  [/병원|약국|의원|한의원|치과|보건/, /보건/],
  [/헬스|운동|당구|노래방|오락|체육|스포츠|볼링/, /스포츠|오락/],
  [/수리|정비|카센터|세차/, /수리/],
]
function searchVouchers(q: string, d: KnowledgeData, origin?: LatLng): Hit {
  const ds = d.vouchers
  if (!ds) return { cards: [], total: 0 }
  const s = squash(q)
  const vf = (it: PubItem) => it.fields as { category?: string; vouchers?: string[]; access?: string; facility?: { evalInfo?: string | null } | null }
  let pool = ds.items.filter((i) => i.lat != null && i.lng != null)
  const cats = CATEGORY_WORDS.filter(([re]) => re.test(s)).map(([, c]) => c)
  if (cats.length) pool = pool.filter((i) => cats.some((c) => c.test(vf(i).category ?? '')))
  const wantAccess = /휠체어|경사로|턱|문턱|들어갈|출입|갈수있|접근|장애/.test(s)
  if (wantAccess) {
    const withInfo = pool.filter((i) => vf(i).access === 'info')
    pool = withInfo
  }
  const card = vf
  pool = placeFilter(pool, q, (i) => `${i.name} ${i.address}`)
  // 이름으로 찾는 경우(가게 이름 낱말)
  // 「가게」「상품권」 같은 흔한 말은 가게 이름 찾기에 쓰지 않는다. 이름 낱말이 두 조각 이상 겹칠 때만 이름으로 찾는다.
  const nameQ = q.replace(/상품권|가맹점|가게|집|식당|음식점|쓸\s*수|사용|돼요|되나요|되나|됩니까|되는|있는|있어요|근처|가까운/g, ' ')
  const named = scoreDocs(pool, (i) => i.name, nameQ)
  if (!cats.length && named.some((x) => x >= 1.2)) pool = pool.filter((_, k) => named[k] >= 1.2)
  const ordered = pickCards(pool, origin, (i) => (vf(i).access === 'info' ? 2 : vf(i).access === 'partial' ? 1 : 0))
  const cards = ordered.slice(0, MAX_CARDS).map((i): Card => {
    const v = card(i)
    const info = v.access === 'info' ? uniqInfo(clean(v.facility?.evalInfo)) : ''
    const bits = [v.category ?? '', ...(v.vouchers?.length ? [`${v.vouchers.join('·')} 가맹점`] : []), info ? `출입 정보: ${info}` : ''].filter(Boolean)
    return { id: i.id, title: i.name, answer: bits.join(' · '), meta: metaOf(i.address, i, origin), source: ds.source }
  })
  return { cards, total: pool.length }
}

function searchBus(q: string, d: KnowledgeData, origin?: LatLng): Hit {
  const ds = d.busStops
  const places = placeWords(q)
  if (ds && places.length) {
    const stops = placeFilter(ds.items.filter((i) => i.lat != null && i.lng != null), q, (i) => `${i.name} ${clean(i.fields['행정동'])} ${i.address}`)
    // 장소 낱말이 하나도 자료에 안 맞으면 placeFilter가 그대로 돌려주므로, 실제로 맞는지 다시 확인한다.
    const real = stops.filter((i) => places.some((p) => squash(`${i.name} ${clean(i.fields['행정동'])} ${i.address}`).includes(p)))
    if (real.length) {
      const ordered = pickCards(real, origin, () => 0)
      const seen = new Set<string>()
      const cards: Card[] = []
      for (const i of ordered) {
        if (seen.has(i.name)) continue
        seen.add(i.name)
        cards.push({ id: i.id, title: i.name, answer: `${clean(i.fields['행정동']) || '북구'} 버스정류장`, meta: metaOf(i.address, i, origin), source: ds.source })
        if (cards.length >= MAX_CARDS) break
      }
      return { cards, total: real.length }
    }
  }
  // 장소를 못 짚으면 앱 화면 안내(고정 문구)
  return { cards: [{ id: 'bus-screen', title: '저상버스 도착 정보', answer: '정류장을 누르면 다음 저상버스를 볼 수 있어요.', source: '앱 안내' }], total: 1 }
}

function searchAgencies(q: string, d: KnowledgeData): Hit {
  const list = d.agencies ?? listAgencies()
  const type = keywordSlots(q, 'report_new').type
  if (!type) return { cards: [], total: 0 }
  const hits = list.filter((a) => a.verified && a.types.includes(type))
  const cards = hits.slice(0, MAX_CARDS).map((a): Card => ({ id: a.id, title: a.name, answer: `${type} · ${a.department}`, source: '소관 기관 안내', sourceUrl: a.sourceUrl || undefined }))
  return { cards, total: hits.length }
}

type HowDoc = { id: string; title: string; answer: string; kw: string; go: Go }
function howDocs(d: KnowledgeData, now: number): HowDoc[] {
  const channels = channelLinks(d.agencies ?? listAgencies(), now)
    .map((c) => c.label)
    .filter((l, i, a) => a.indexOf(l) === i)
  const slide = (icon: string) => GUIDE_SLIDES.find((s) => s.icon === icon)?.text ?? ''
  const docs: HowDoc[] = [
    { id: 'how-report', title: '사진으로 신고하기', answer: slide('report'), kw: '신고 제보 민원 사진 올리기 접수 장애물 불편', go: { label: '신고하기 열기', hash: TO.newReport } },
    { id: 'how-channel', title: '신고를 받는 곳', answer: channels.join(' · '), kw: '신고 접수 창구 채널 어디 기관 민원 국민신문고 안전신문고 120', go: { label: '담당 기관 안내 보기', hash: TO.agency } },
    { id: 'how-status', title: '신고 처리 상황 보기', answer: slide('bell'), kw: '처리 상황 진행 알림 결과 신고한 접수번호', go: { label: '내 민원 진행 상황', hash: '#/report?section=mine' } },
    { id: 'how-route', title: '휠체어 길찾기', answer: slide('route'), kw: '길찾기 길 경로 가는 방법 휠체어', go: { label: '휠체어 길찾기 열기', hash: TO.route } },
    { id: 'how-map', title: '지도로 보기', answer: slide('map'), kw: '지도 불편한 곳 확인', go: { label: '지도 열기', hash: TO.map } },
  ]
  return docs.filter((x) => x.answer)
}
function searchHowto(q: string, d: KnowledgeData, now: number): Hit & { go: Go[] } {
  const docs = howDocs(d, now)
  const scores = scoreDocs(docs, (x) => `${x.title} ${x.kw} ${x.answer}`, q)
  const ranked = docs.map((x, i) => ({ x, sc: scores[i] })).sort((a, b) => b.sc - a.sc)
  const pool = ranked.filter((r) => r.sc >= 0.7 && r.sc >= ranked[0].sc * 0.6).slice(0, MAX_CARDS)
  return {
    cards: pool.map((r): Card => ({ id: r.x.id, title: r.x.title, answer: r.x.answer, source: '앱 안내' })),
    total: pool.length,
    go: pool.slice(0, 2).map((r) => r.x.go),
  }
}

// ---------- 진입점 ----------
export type AskOptions = { topic?: string; query?: string; data: KnowledgeData; origin?: LatLng; now?: number }

// 한 주제에서 찾는다. 찾으면 카드와 이동 버튼을 돌려준다.
function searchTopic(topic: Topic, q: string, o: AskOptions): (Hit & { go?: Go[] }) | null {
  const now = o.now ?? Date.now()
  switch (topic) {
    case 'benefit': return searchBenefits(q, o.data, now)
    case 'toilet': return searchToilets(q, o.data, o.origin)
    case 'facility': return searchFacilities(q, o.data, o.origin)
    case 'voucher': return searchVouchers(q, o.data, o.origin)
    case 'bus': return searchBus(q, o.data, o.origin)
    case 'agency': return searchAgencies(q, o.data)
    case 'howto': return searchHowto(q, o.data, now)
  }
}

// 질문에 앱 자료로 답한다. 자료에 없으면 found=false로 돌려주고 문장을 지어내지 않는다.
export function askKnowledge(question: string, o: AskOptions): AskAnswer {
  const q = `${question} ${o.query ?? ''}`.trim()
  const topics = candidateTopics(question, o.topic)
  for (const t of topics) {
    const hit = searchTopic(t, q, o)
    if (hit && hit.cards.length) return { topic: t, cards: hit.cards, total: hit.total, go: hit.go?.length ? hit.go : GO[t], found: true }
  }
  return { topic: topics[0] ?? null, cards: [], total: 0, go: topics[0] ? GO[topics[0]] : [], found: false }
}

// 위치가 필요한 질문인가(「근처」「가까운」 같은 말)
export const wantsNearby = (question: string): boolean => /근처|가까|주변|내\s*위치|여기서|이\s*근방|바로\s*앞/.test(question)

// 자료를 어떤 순서로 불러야 하는지(주제별 필요한 자료 이름)
export function dataNeeds(topics: Topic[]): ('toilets' | 'facilities' | 'vouchers' | 'busStops')[] {
  const need = new Set<'toilets' | 'facilities' | 'vouchers' | 'busStops'>()
  for (const t of topics) {
    if (t === 'toilet') {
      need.add('toilets')
      need.add('facilities')
    }
    if (t === 'facility') need.add('facilities')
    if (t === 'voucher') need.add('vouchers')
    if (t === 'bus') need.add('busStops')
  }
  return [...need]
}
