import { REPORT_TYPES } from '../reportTypes'
import { SLOT_KEYS, isIntent } from './intents'
import type { AiIntent, SlotKey, Slots } from './intents'

// Worker 응답은 믿지 않고 앱에서 다시 검증한다. 모델이 만든 문장은 쓰지 않고 의도 id와 검증된 빈칸 값만 남긴다.
export const MAX_QUESTION_CHARS = 120
export const MAX_SLOT_CHARS = 20
const TYPE_VALUES: readonly string[] = REPORT_TYPES.map((t) => t.type)

const INVISIBLE_RE = new RegExp('[\u200B-\u200F\u2028-\u202E\u2060-\u206F\uFEFF]', 'g')

export function stripControl(s: string): string {
  return s
    // oxlint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001F\u007F-\u009F]/g, ' ')
    .replace(INVISIBLE_RE, '')
    .replace(/\s+/g, ' ')
    .trim()
}

// 개인정보 패턴(전화번호·이메일·긴 숫자열). 입력창 안내와 전송 전 마스킹에 같이 쓴다.
const EMAIL_RE = /[\w.+-]+@[\w-]+(\.[\w-]+)+/g
const PHONE_RE = /(?<!\d)(\+?82[-.\s]?)?0\d{1,2}[-.\s]?\d{3,4}[-.\s]?\d{4}(?!\d)/g
const LONG_NUM_RE = /\d(?:[\s-]?\d){7,}/g
export function hasPersonalInfo(s: string): boolean {
  return new RegExp(EMAIL_RE.source).test(s) || new RegExp(PHONE_RE.source).test(s) || new RegExp(LONG_NUM_RE.source).test(s)
}
export function maskPersonal(s: string): string {
  return s.replace(EMAIL_RE, '[이메일]').replace(PHONE_RE, '[전화]').replace(LONG_NUM_RE, '[숫자]')
}

// 보내기 전 정리: 제어문자 제거 → 120자 → 개인정보 가리기
export function cleanQuestion(raw: string): string {
  return maskPersonal(stripControl(raw)).slice(0, MAX_QUESTION_CHARS)
}

// 유형 값이 질문의 낱말로 뒷받침되는지 본다(모델이 엉뚱한 유형을 고르는 경우를 걸러 낸다). 앱 유형 목록 12개 기준.
const TYPE_HINTS: Record<string, RegExp> = {
  '계단·턱': /계단|턱|단차/,
  '좁은 보도': /좁/,
  '급경사': /급경사|가파|경사/,
  '파손 노면': /구멍|패|파손|파인|깨|포트홀|울퉁|덜컹|노면|단차/,
  '경사로 없음': /경사로/,
  '수동문': /문/,
  '장애인화장실 없음': /화장실/,
  '쓰레기': /쓰레기|적치/,
  '킥보드·자전거': /킥보드|자전거/,
  '입간판·노점': /입간판|노점|좌판/,
  '공사 자재': /공사|자재/,
  '불법 주정차': /주정차|주차/,
}

const compact = (s: string) => s.replace(/\s+/g, '')

export type Verified = { intent: AiIntent; slots: Slots; confidence: number }

function cleanSlot(v: unknown): string | null {
  if (typeof v !== 'string') return null
  const s = stripControl(v)
  if (s.length < 2 || s.length > MAX_SLOT_CHARS) return null
  if (!/^[가-힣0-9 ]+$/.test(s)) return null
  return s
}

// 빈칸 검증: 허용 키만, 길이·문자 검사. type은 앱의 제보 유형 목록에 있는 값만, 나머지는 사용자가 쓴 글에 실제로 있는 구절만.
export function verifySlots(intent: AiIntent, given: unknown, question: string): Slots {
  const out: Slots = {}
  if (!given || typeof given !== 'object' || Array.isArray(given)) return out
  const g = given as Record<string, unknown>
  const q = compact(question)
  for (const k of SLOT_KEYS[intent] as readonly SlotKey[]) {
    const raw = g[k]
    if (k === 'type') {
      const t = typeof raw === 'string' ? stripControl(raw) : ''
      if (TYPE_VALUES.includes(t) && TYPE_HINTS[t]?.test(question)) out.type = t
      continue
    }
    const v = cleanSlot(raw)
    if (v && q.includes(compact(v))) out[k] = v
  }
  if (out.from && out.to && out.from === out.to) {
    delete out.from
    delete out.to
  }
  return out
}

// Worker 응답 전체를 검증한다. 형식이 깨졌거나(null) Worker가 실패를 알린 경우 호출한 쪽이 키워드 폴백을 쓴다.
// 허용 목록 밖 의도는 unknown, 신뢰도가 0.3 미만이어도 unknown.
export function verifyResponse(body: unknown, question: string): Verified | null {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return null
  const b = body as Record<string, unknown>
  if (b.ok !== true || b.fallback === true) return null
  if (typeof b.intent !== 'string') return null
  const intent: AiIntent = isIntent(b.intent) ? b.intent : 'unknown'
  const c = typeof b.confidence === 'number' && Number.isFinite(b.confidence) ? Math.min(1, Math.max(0, b.confidence)) : 0.5
  if (intent === 'unknown' || c < 0.3) return { intent: 'unknown', slots: {}, confidence: c }
  return { intent, slots: verifySlots(intent, b.slots, question), confidence: c }
}
