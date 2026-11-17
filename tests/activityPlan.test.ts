import test from 'node:test'
import assert from 'node:assert/strict'
import { PRE_LOGIN_MAX, RESUME_AFTER_MS, cleanMessage, cleanStack, dayOf, errorKey, isIgnorableError, pushPending, routeOf, scrubUrls, shouldReportResume, takeError } from '../src/lib/account/activityPlan.ts'
import { DEVICE_ID_KEY, SYNCED_PREF_KEYS } from '../src/lib/account/keys.ts'

test('다시 접속 기록: 30분 넘게 숨겨졌을 때만', () => {
  assert.equal(shouldReportResume(null, 1_000_000), false)
  assert.equal(shouldReportResume(1_000_000, 1_000_000 + RESUME_AFTER_MS - 1), false)
  assert.equal(shouldReportResume(1_000_000, 1_000_000 + RESUME_AFTER_MS), true)
})

test('같은 오류(메시지+빌드)는 하루 한 번, 다음 날·다른 빌드는 다시', () => {
  const k = errorKey('앗', 'abc')
  let r = takeError({}, k, '2026-11-17')
  assert.equal(r.send, true)
  r = takeError(r.seen, k, '2026-11-17')
  assert.equal(r.send, false)
  assert.equal(takeError(r.seen, errorKey('앗', 'def'), '2026-11-17').send, true)
  assert.equal(takeError(r.seen, errorKey('다른', 'abc'), '2026-11-17').send, true)
  const next = takeError(r.seen, k, '2026-11-18')
  assert.equal(next.send, true)
  assert.deepEqual(Object.keys(next.seen), [k]) // 지난 날짜 항목은 정리된다
})

test('날짜 키는 로컬 날짜', () => {
  assert.equal(dayOf(new Date(2026, 10, 7, 23, 59)), '2026-11-07')
})

test('화면 경로: 쿼리·조각을 뺀 경로만', () => {
  assert.equal(routeOf('#/map?report=abc&x=1'), '/map')
  assert.equal(routeOf('#/home#frag'), '/home')
  assert.equal(routeOf(''), '')
  assert.equal(routeOf('#/' + 'a'.repeat(300)).length, 100)
})

test('주소의 쿼리는 지우고 일반 글의 물음표는 둔다', () => {
  assert.equal(scrubUrls('at https://x.io/a.js?token=abc:1:2'), 'at https://x.io/a.js')
  assert.equal(scrubUrls('왜 안 돼요? https://x.io/p#/map?id=3 끝'), '왜 안 돼요? https://x.io/p 끝')
})

test('메시지 300자·스택 2000자로 자른다', () => {
  assert.equal([...cleanMessage('가'.repeat(500))].length, 300)
  assert.equal([...cleanStack('나'.repeat(5000))].length, 2000)
})

test('무시할 브라우저 알림', () => {
  assert.equal(isIgnorableError('ResizeObserver loop completed with undelivered notifications.'), true)
  assert.equal(isIgnorableError('TypeError: x is undefined'), false)
})

test('로그인 전 오류는 최대 10개까지만 모은다', () => {
  let list: number[] = []
  for (let i = 0; i < 15; i++) list = pushPending(list, i)
  assert.equal(list.length, PRE_LOGIN_MAX)
  assert.deepEqual(list.slice(-1), [9])
})

test('기기 id 키는 계정 간 동기화 대상이 아니다', () => {
  assert.ok(!(SYNCED_PREF_KEYS as readonly string[]).includes(DEVICE_ID_KEY))
})
