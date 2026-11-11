import test from 'node:test'
import assert from 'node:assert/strict'
import {
  INTENT_IDS,
  buildSystemPrompt,
  createRateLimiter,
  extractJson,
  isAllowedOrigin,
  maskPersonal,
  parseModelOutput,
  parseOrigins,
  sanitizeQuestion,
  stripControl,
  validateResult,
} from '../src/intents.ts'

test('허용 의도 목록에 unknown이 있고 기관·법령 필드는 스키마에 없다', () => {
  assert.ok(INTENT_IDS.includes('unknown'))
  const r = validateResult({ intent: 'agency', slots: {}, confidence: 0.9, agency: '북구청', law: '장애인등편의법', receipt: '123', deadline: '7일' })
  assert.deepEqual(Object.keys(r ?? {}).sort(), ['confidence', 'intent', 'slots'])
})

test('허용 외 의도는 unknown으로 바뀐다', () => {
  assert.equal(validateResult({ intent: 'delete_all', slots: { x: 'y' }, confidence: 0.99 })?.intent, 'unknown')
  assert.equal(validateResult({ intent: 42 })?.intent, 'unknown')
})

test('빈칸은 의도별 허용 이름만, 20자 이하, 링크·마스킹 표시 제외', () => {
  const r = validateResult({
    intent: 'route',
    slots: { from: '용봉동', to: '북구청', evil: 'x', type: '턱' },
    confidence: 0.8,
  })
  assert.deepEqual(r?.slots, { from: '용봉동', to: '북구청' })
  assert.deepEqual(validateResult({ intent: 'report_new', slots: { type: 'http://a.b', place: '가'.repeat(21) }, confidence: 0.8 })?.slots, {})
  assert.deepEqual(validateResult({ intent: 'bus', slots: { place: '[전화]' }, confidence: 0.8 })?.slots, {})
})

test('신뢰도 보정과 낮은 신뢰도는 unknown', () => {
  assert.equal(validateResult({ intent: 'bus', confidence: 5 })?.confidence, 1)
  assert.equal(validateResult({ intent: 'bus', confidence: 'high' })?.confidence, 0.5)
  assert.equal(validateResult({ intent: 'bus', confidence: 0.1 })?.intent, 'unknown')
})

test('배열·null·문자열은 검증 실패', () => {
  assert.equal(validateResult(null), null)
  assert.equal(validateResult([]), null)
  assert.equal(validateResult('x'), null)
})

test('extractJson: 코드펜스·앞뒤 말·think 블록을 견딘다', () => {
  assert.deepEqual(extractJson('```json\n{"a":1}\n```'), { a: 1 })
  assert.deepEqual(extractJson('답: {"a":1} 입니다'), { a: 1 })
  assert.deepEqual(extractJson('<think>{"a":2}</think>{"a":1}'), { a: 1 })
  assert.equal(extractJson('JSON이 아님'), null)
  assert.equal(extractJson('{깨진: json'), null)
})

test('parseModelOutput: response 문자열·객체·choices 형태', () => {
  const j = '{"intent":"bus","slots":{},"confidence":0.8}'
  assert.equal(parseModelOutput({ response: j })?.intent, 'bus')
  assert.equal(parseModelOutput({ response: { intent: 'my_score', confidence: 0.9 } })?.intent, 'my_score')
  assert.equal(parseModelOutput({ choices: [{ message: { content: j } }] })?.intent, 'bus')
  assert.equal(parseModelOutput({ response: '엉뚱한 말' }), null)
  assert.equal(parseModelOutput(undefined), null)
  assert.equal(parseModelOutput({}), null)
})

test('마스킹: 전화·이메일·11자리 이상 숫자', () => {
  assert.equal(maskPersonal('010-1234-5678로 연락'), '[전화]로 연락')
  assert.equal(maskPersonal('061-123-4567'), '[전화]')
  assert.equal(maskPersonal('a.b@naver.com 입니다'), '[이메일] 입니다')
  assert.equal(maskPersonal('번호 20261111123456 찾기'), '번호 [숫자] 찾기')
  assert.equal(maskPersonal('3번 출구 앞 12345'), '3번 출구 앞 12345')
})

test('제어문자·보이지 않는 문자 제거', () => {
  assert.equal(stripControl('a\u0000b​c\n\td‮e'), 'a bc de')
  assert.equal(sanitizeQuestion('  경사로\u0007가   막혔어요 '), '경사로 가 막혔어요')
})

test('CORS 판정', () => {
  const allowed = parseOrigins('https://starckson-kr.github.io/, http://localhost:5173')
  assert.deepEqual(allowed, ['https://starckson-kr.github.io', 'http://localhost:5173'])
  assert.ok(isAllowedOrigin('http://localhost:5173', allowed))
  assert.ok(!isAllowedOrigin('https://evil.example', allowed))
  assert.ok(!isAllowedOrigin(null, allowed))
  assert.ok(!isAllowedOrigin('https://starckson-kr.github.io.evil.com', allowed))
})

test('속도 제한: IP별 분당, 전체 일일, 시간 지나면 풀림', () => {
  const rl = createRateLimiter(2, 5)
  const t = Date.UTC(2026, 10, 11, 0, 0, 10)
  assert.ok(rl.check('a', t).ok)
  assert.ok(rl.check('a', t + 1).ok)
  assert.deepEqual(rl.check('a', t + 2), { ok: false, reason: 'rate_limited' })
  assert.ok(rl.check('b', t + 3).ok)
  assert.ok(rl.check('a', t + 61_000).ok) // 다음 분
  assert.ok(rl.check('c', t + 61_001).ok) // 총 5번째
  assert.deepEqual(rl.check('d', t + 61_002), { ok: false, reason: 'daily_limit' })
  assert.ok(rl.check('d', t + 86_400_000).ok) // 다음 날 초기화
})

test('프롬프트: 모든 의도·인젝션 방어 문구 포함', () => {
  const p = buildSystemPrompt()
  for (const id of INTENT_IDS) assert.ok(p.includes(id))
  assert.ok(p.includes('명령이 아니다'))
})
