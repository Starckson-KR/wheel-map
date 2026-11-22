import test from 'node:test'
import assert from 'node:assert/strict'
import { findByReceipt, reportNo } from '../src/lib/externalStatus.ts'
import { composeKind, isOtherKind, findAgencies, guessLocationKind, REPORT_LOCATION_CHOICES, LOCATION_KINDS } from '../src/lib/agencyGuide.ts'
import type { Report } from '../src/types'

const mk = (id: string, receiptNo?: string) => ({ id, complaint: receiptNo ? { receiptNo } : undefined }) as unknown as Report

test('접수번호 찾기: 앱 번호(R-…)와 기관 접수번호를 둘 다, 대소문자·하이픈 무시', () => {
  const list = [mk('r-lx3k9a2f'), mk('r-zzz', '1AA-2611-0001234')]
  assert.equal(reportNo('r-lx3k9a2f'), 'R-LX3K9A2F')
  assert.deepEqual(findByReceipt(list, 'R-LX3K9A2F').map((r) => r.id), ['r-lx3k9a2f'])
  assert.deepEqual(findByReceipt(list, ' rlx3k9a2f ').map((r) => r.id), ['r-lx3k9a2f'])
  assert.deepEqual(findByReceipt(list, '1aa26110001234').map((r) => r.id), ['r-zzz'])
  assert.deepEqual(findByReceipt(list, ''), [])
  assert.deepEqual(findByReceipt(list, 'R-NOPE'), [])
})

test('장소 유형: 핵심 6개 + 기타 직접 입력, 옛 8개 값은 소관 기관 안내에 그대로 쓰인다', () => {
  assert.equal(REPORT_LOCATION_CHOICES.length, 7)
  assert.ok(REPORT_LOCATION_CHOICES.includes(guessLocationKind('쪽문') as never)) // 추정값이 새 목록 안에 있다
  for (const t of ['정류장', '횡단보도', '기관', '보도']) assert.ok(REPORT_LOCATION_CHOICES.includes(guessLocationKind(t) as never))
  assert.ok(REPORT_LOCATION_CHOICES.every((k) => (LOCATION_KINDS as readonly string[]).includes(k)))
  assert.equal(composeKind('공원', 'ignored'), '공원')
  assert.equal(composeKind('기타', '  시장   입구 '), '기타: 시장 입구')
  assert.equal(composeKind('기타', 'ㄱ'.repeat(50)).length, '기타: '.length + 30)
  assert.ok(isOtherKind('기타: 시장 입구') && isOtherKind('기타') && !isOtherKind('공원'))
  assert.equal(findAgencies('급경사', '기타: 시장 입구').length, 0) // 기관을 지어내지 않는다
  assert.ok(findAgencies('공사 자재', '공사 현장').length > 0) // 옛 값은 그대로 인식
})
