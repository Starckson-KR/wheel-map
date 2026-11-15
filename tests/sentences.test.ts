import { test } from 'node:test'
import assert from 'node:assert/strict'
import { splitSentences } from '../src/lib/sentences.ts'

const s = splitSentences

test('기본 문장 분리', () => {
  assert.deepEqual(s('매달 11만 원 이내로 지원해요. 결제는 누리집에서만 할 수 있어요.'), [
    '매달 11만 원 이내로 지원해요.',
    '결제는 누리집에서만 할 수 있어요.',
  ])
})
test('한 문장은 그대로', () => {
  assert.deepEqual(s('한 문장이에요.'), ['한 문장이에요.'])
  assert.deepEqual(s('마침표 없는 글'), ['마침표 없는 글'])
  assert.deepEqual(s(''), [])
})
test('!, ?, … 로 끝나는 문장', () => {
  assert.deepEqual(s('좋아요! 맞나요? 그럴 거예요… 다음 줄이에요.'), [
    '좋아요!',
    '맞나요?',
    '그럴 거예요…',
    '다음 줄이에요.',
  ])
})
test('숫자 소수점은 자르지 않는다', () => {
  assert.deepEqual(s('이용료는 11.5만 원이에요. 다음 달부터 3.5% 올라요.'), [
    '이용료는 11.5만 원이에요.',
    '다음 달부터 3.5% 올라요.',
  ])
})
test('줄임표(...)는 한 덩어리', () => {
  assert.deepEqual(s('잠시만요... 확인해 볼게요.'), ['잠시만요...', '확인해 볼게요.'])
})
test('괄호·따옴표 안 마침표는 자르지 않는다', () => {
  assert.deepEqual(s('신청해요(안 되면 문의해요. 전화로요) 그리고 끝이에요.'), [
    '신청해요(안 되면 문의해요. 전화로요) 그리고 끝이에요.',
  ])
  assert.deepEqual(s('“안내를 확인하세요. 감사합니다.” 라고 떠요. 다음이에요.'), [
    '“안내를 확인하세요. 감사합니다.” 라고 떠요.',
    '다음이에요.',
  ])
})
test('닫는 괄호·따옴표는 앞 문장에 붙인다', () => {
  assert.deepEqual(s('안내예요.(자세한 건 누리집) 다음 문장이에요.'), ['안내예요.(자세한 건 누리집) 다음 문장이에요.'])
  assert.deepEqual(s('(참고해요.) 다음이에요.'), ['(참고해요.)', '다음이에요.'])
  assert.deepEqual(s('“좋아요.” 다음이에요.'), ['“좋아요.”', '다음이에요.'])
})
test('"예: …" 는 앞 문장과 붙는다', () => {
  assert.deepEqual(s('이렇게 적어요 예: 계단 앞 턱이 높아요. 다음 문장이에요.'), [
    '이렇게 적어요 예: 계단 앞 턱이 높아요.',
    '다음 문장이에요.',
  ])
})
test('URL·주소·전화번호는 자르지 않는다', () => {
  assert.deepEqual(s('누리집은 www.bukgu.gwangju.kr 이에요. 전화는 062-410-6114예요.'), [
    '누리집은 www.bukgu.gwangju.kr 이에요.',
    '전화는 062-410-6114예요.',
  ])
  assert.deepEqual(s('https://example.com/a.b?x=1 에서 확인해요. 끝.'), [
    'https://example.com/a.b?x=1 에서 확인해요.',
    '끝.',
  ])
})
test('문장 앞 번호는 자르지 않는다', () => {
  assert.deepEqual(s('1. 신청해요. 2. 기다려요.'), ['1. 신청해요.', '2. 기다려요.'])
})
test('여러 공백·줄바꿈', () => {
  assert.deepEqual(s('첫째예요.   둘째예요.\n셋째예요.'), ['첫째예요.', '둘째예요.', '셋째예요.'])
})
test('이어 붙이면 원문 의미가 유지된다', () => {
  const t = '결제는 누리집에서만 할 수 있어요. 안 쓴 지원금은 그달에 사라져요.'
  assert.equal(s(t).join(' '), t)
})

import { tidyBreaks } from '../src/lib/sentences.ts'
test('줄바꿈 다듬기: 의존명사·숫자 단위·가운뎃점', () => {
  assert.equal(tidyBreaks('볼 수 있어요'), '볼 수 있어요')
  assert.equal(tidyBreaks('11만 원 이내'), '11만 원 이내')
  assert.equal(tidyBreaks('제보 수는 늘어요'), '제보 수는 늘어요')
  assert.equal(tidyBreaks('가·나'), '가⁠·⁠나')
  assert.equal(tidyBreaks('복지관·주간보호'), '복지관⁠·​주간보호')
  for (const t of ['가·나', '복지관·주간보호 062-410-6382 검증자(동행) 45-4 부근 11만 원 볼 수']) assert.equal(tidyBreaks(tidyBreaks(t)), tidyBreaks(t))
  assert.ok(tidyBreaks('062-410-6382').includes('⁠-⁠'))
  assert.equal(tidyBreaks('45-4 부근').includes('4 부근'), true)
  assert.equal(tidyBreaks('수업 수 있다').replace(/ /g, ' '), '수업 수 있다')
})
