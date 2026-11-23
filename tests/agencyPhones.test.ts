// 실행: node --import ./scripts/registerTs.mjs --test tests/agencyPhones.test.ts
import test from 'node:test'
import assert from 'node:assert/strict'
import { channelLinks, listAgencies, phoneParts, telHref } from '../src/lib/agencyGuide.ts'

test('telHref: 하이픈을 뺀 숫자 링크', () => {
  assert.equal(telHref('062-410-8000'), 'tel:0624108000')
  assert.equal(telHref('010-4107-8572', 'sms'), 'sms:01041078572')
})

test('channelLinks: 확인된 번호만 채운다', () => {
  const all = listAgencies()
  const links = channelLinks(all, new Date('2026-11-23').getTime())
  const by = (l: string) => links.find((x) => x.label === l)
  assert.equal(by('안전신문고')?.tel, '1600-7395')
  assert.equal(by('국민신문고')?.tel, '110')
  assert.equal(by('120 빛고을콜센터')?.tel, '062-120')
  assert.equal(by('북구청 누리집 민원')?.tel, '062-410-8000')
  assert.equal(by('북구청장 바로문자 365·생활불편신고 콜센터')?.sms, '010-4107-8572')
  for (const l of links) for (const n of [l.tel, l.sms]) if (n) assert.ok(['1600-7395', '110', '062-120', '062-410-8000', '010-4107-8572'].includes(n))
})

test('phoneParts: 확인 못 한 번호는 링크로 만들지 않는다', () => {
  const p = phoneParts('062-410-8282 (예시) / 062-410-8000 (대표) / 044-205-4238')
  assert.deepEqual(p.filter((x) => x.tel).map((x) => x.tel), ['062-410-8000'])
  assert.equal(phoneParts('1600-7395 (이용문의) / 044-205-4238').filter((x) => x.tel).length, 1)
})
