import { test } from 'node:test'
import assert from 'node:assert/strict'
import { summarizeNear, summarizeAvoid, bareName, detourLine } from '../src/lib/routing/guideNotes.ts'

test('주의 안내: 없으면 줄이 없다', () => {
  assert.equal(summarizeNear([]), null)
  assert.equal(summarizeAvoid([]), null)
})

test('주의 안내: 하나면 유형만, 괄호 설명은 뗀다', () => {
  assert.equal(summarizeNear(['급경사 (시민 제보)']), '이 근처에 급경사')
  assert.equal(summarizeAvoid(['계단·턱 (시민 제보)']), '계단·턱 때문에 돌아가요')
})

test('주의 안내: 여럿이면 한 줄로, 많은 유형 두 가지만', () => {
  const names = ['좁은 보도 (시민 제보)', '쓰레기 (시민 제보)', '좁은 보도 (시민 제보)', '급경사 (시민 제보)', '쓰레기 (시민 제보)', '좁은 보도 (시민 제보)']
  assert.equal(summarizeNear(names), '주의 6곳 · 좁은 보도 3 · 쓰레기 2 외')
  assert.equal(summarizeNear(['쓰레기', '쓰레기']), '주의 2곳 · 쓰레기 2')
  assert.equal(summarizeAvoid(['계단·턱', '급경사']), '2곳을 피해 돌아가요')
})

test('이름 끝 괄호 설명만 뗀다', () => {
  assert.equal(bareName('급경사 (시민 제보)'), '급경사')
  assert.equal(bareName('북구청 앞 횡단보도'), '북구청 앞 횡단보도')
  assert.equal(bareName('(이름 없음)'), '(이름 없음)')
})

test('돌아가는 까닭 한 줄: 한 곳은 이름, 같은 종류는 종류와 개수, 섞이면 개수만', () => {
  assert.equal(detourLine([], '97m'), null)
  assert.equal(detourLine(['북구청 앞 횡단보도'], '97m'), '북구청 앞 횡단보도를 피해 97m 돌아가요')
  assert.equal(detourLine(['계단·턱 (시민 제보)'], '97m'), '계단·턱을 피해 97m 돌아가요')
  assert.equal(detourLine(['급경사 (시민 제보)', '급경사 (시민 제보)'], '120m'), '급경사 2곳을 피해 120m 돌아가요')
  assert.equal(detourLine(['계단·턱', '급경사', '쓰레기'], null), '3곳을 피해 돌아가요')
  assert.equal(detourLine(['R15'], null), 'R15을(를) 피해 돌아가요')
})
