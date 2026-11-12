import test from 'node:test'
import assert from 'node:assert/strict'
import { normalizeText, fingerprint, extractTitle, classifyResponse, judge, problemSignature } from '../scripts/watchBenefits.mjs'

const page = (body, extra = '') =>
  `<html><head><title>장애인 시책</title><script>var t="abc${extra}"</script><style>.a{}</style></head><body><!-- ${extra} -->${body}</body></html>`
const fp = (h) => fingerprint(normalizeText(h))

test('잡음(주석·스크립트·날짜·조회수·토큰)만 다른 두 페이지는 같은 지문', () => {
  const a = page('<p>장애수당 월 6만원</p><p>조회수: 1,234</p><p>2026-11-12 10:03:11</p><i>sid=0123456789abcdef0123456789abcdef</i>', 'x1')
  const b = page('<p>장애수당   월 6만원</p><p>조회수: 1,299</p><p>2026.11.13 09:01</p><i>sid=fedcba98765432100123456789abcdef</i>', 'x2')
  assert.equal(fp(a), fp(b))
})

test('본문이 바뀌면 지문이 달라진다', () => {
  assert.notEqual(fp(page('<p>장애수당 월 6만원</p>')), fp(page('<p>장애수당 월 7만원</p>')))
})

test('제목 추출', () => assert.equal(extractTitle(page('')), '장애인 시책'))

test('응답 분류: 4xx·5xx는 깨짐, 403·429·네트워크 오류는 막힘 의심', () => {
  assert.equal(classifyResponse({ status: 200 }), 'ok')
  assert.equal(classifyResponse({ status: 404 }), 'broken')
  assert.equal(classifyResponse({ status: 500 }), 'broken')
  assert.equal(classifyResponse({ status: 403 }), 'blocked')
  assert.equal(classifyResponse({ error: 'ECONNRESET' }), 'blocked')
})

const base = { status: 200, finalUrl: 'https://a/', title: 'T', fingerprint: 'f1' }
test('판정', () => {
  assert.equal(judge({ ...base }, base).verdict, 'same')
  assert.equal(judge({ ...base, fingerprint: 'f2' }, base).verdict, 'changed')
  assert.equal(judge({ ...base, finalUrl: 'https://a/new' }, base).verdict, 'changed')
  assert.equal(judge({ status: 404 }, base).verdict, 'broken')
  assert.equal(judge({ error: 'ECONNRESET' }, base).verdict, 'blocked')
  assert.equal(judge({ ...base }, undefined).verdict, 'new')
})

test('상태만 감시하면 지문이 달라도 같음', () => {
  assert.equal(judge({ ...base, fingerprint: 'zz', title: 'U' }, base, { statusOnly: true }).verdict, 'same')
})

test('문제 서명: 같은 변경은 같은 서명, 새 지문이면 다른 서명, 문제 없으면 빈 값', () => {
  const r = (fingerprint) => [{ url: 'u', verdict: 'changed', cur: { status: 200, fingerprint } }, { url: 'v', verdict: 'same', cur: { status: 200 } }]
  assert.equal(problemSignature(r('a')), problemSignature(r('a')))
  assert.notEqual(problemSignature(r('a')), problemSignature(r('b')))
  assert.equal(problemSignature([{ url: 'v', verdict: 'same', cur: {} }]), '')
})

test('리포트에 문제가 있으면 서명 주석이 들어가고, 없으면 들어가지 않는다', async () => {
  const { buildReport } = await import('../scripts/watchBenefits.mjs')
  const bad = [{ url: 'u', ids: ['a'], verdict: 'changed', reason: 'r', cur: { status: 200, fingerprint: 'f' } }]
  assert.match(buildReport(bad, 't'), /<!-- watch-sig:[0-9a-f]+ -->/)
  const blocked = [{ url: 'u', ids: ['a'], verdict: 'blocked', reason: 'r', cur: { error: 'ECONNRESET' } }]
  assert.match(buildReport(blocked, 't'), /<!-- watch-sig:[0-9a-f]+ -->/)
  assert.doesNotMatch(buildReport([{ url: 'u', ids: ['a'], verdict: 'same', cur: { status: 200 } }], 't'), /watch-sig/)
})
