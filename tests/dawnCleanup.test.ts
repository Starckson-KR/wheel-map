import test from 'node:test'
import assert from 'node:assert/strict'
import { summarizeNear } from '../src/lib/routing/guideNotes.ts'
import { citizenMemo } from '../src/lib/reportStore.ts'
import { listAgencies, phoneParts } from '../src/lib/agencyGuide.ts'

test('summarizeNear: 버스 정류장 주의 목록도 종류별 한 줄로 줄이고 꼬리표를 뗀다', () => {
  const names = [...Array(6).fill('불법 주정차 (시민 제보)'), ...Array(5).fill('계단·턱 (시민 제보)'), '좁은 보도', '급경사']
  const line = summarizeNear(names)
  assert.equal(line, '주의 13곳 · 불법 주정차 6 · 계단·턱 5 외')
  assert.ok(!line!.includes('시민 제보'))
})

test('citizenMemo: 옛 메모의 검증 낱말만 시민 화면용으로 바꾼다', () => {
  assert.equal(citizenMemo('검증 대기'), '확인 대기')
  assert.equal(citizenMemo('검증 완료로 처리'), '확인 완료로 처리')
  assert.equal(citizenMemo('검증자 판정 추가'), '검증자 판정 추가')
})

test('담당 기관 안내: 걸 수 있는 번호는 기관 자료에 이미 있는 번호뿐이다', () => {
  for (const a of listAgencies()) {
    const tel = a.phone ? phoneParts(a.phone).find((p) => p.tel)?.tel : undefined
    if (tel) assert.ok(a.phone!.includes(tel))
  }
})
