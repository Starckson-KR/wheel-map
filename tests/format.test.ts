import { test } from 'node:test'
import assert from 'node:assert/strict'
import { fmtDateTime, fmtDay, won } from '../src/lib/format.ts'

// 기기 시간대와 상관없이 같은 값이 나오도록 로컬 시각으로 만든다
const NOW = new Date(2026, 10, 21, 12, 0).getTime()
const at = (y: number, mo: number, d: number, h: number, mi: number) => new Date(y, mo - 1, d, h, mi).getTime()

test('fmtDay: 올해는 월/일, 올해가 아니면 앞에 연도', () => {
  assert.equal(fmtDay(at(2026, 11, 18, 22, 19), NOW), '11/18')
  assert.equal(fmtDay(at(2026, 1, 5, 0, 0), NOW), '1/5')
  assert.equal(fmtDay(at(2025, 11, 18, 22, 19), NOW), '2025/11/18')
  assert.equal(fmtDay(new Date(2025, 11, 31, 23, 59).toISOString(), NOW), '2025/12/31')
})

test('fmtDateTime: 월/일 오전·오후 시:분', () => {
  assert.equal(fmtDateTime(at(2026, 11, 18, 22, 19), NOW), '11/18 오후 10:19')
  assert.equal(fmtDateTime(at(2026, 11, 18, 9, 5), NOW), '11/18 오전 9:05')
  assert.equal(fmtDateTime(at(2026, 11, 18, 0, 0), NOW), '11/18 오전 12:00')
  assert.equal(fmtDateTime(at(2026, 11, 18, 12, 30), NOW), '11/18 오후 12:30')
  assert.equal(fmtDateTime(at(2025, 3, 2, 13, 7), NOW), '2025/3/2 오후 1:07')
})

test('날짜가 아닌 값은 빈 글자', () => {
  assert.equal(fmtDay('날짜 아님', NOW), '')
  assert.equal(fmtDateTime('', NOW), '')
})

test('won: 천 단위 쉼표', () => {
  assert.equal(won(1234567), '1,234,567')
})
