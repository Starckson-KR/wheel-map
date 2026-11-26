import test from 'node:test'
import assert from 'node:assert/strict'
import { lineLabel, sameLine } from '../src/lib/bus/types.ts'

test('노선 번호는 괄호 앞까지만 보인다', () => {
  assert.equal(lineLabel('160(나주역.나주.본덕.광주송정.광주공항)'), '160')
  assert.equal(lineLabel('마을777'), '마을777')
  assert.equal(lineLabel('07'), '07')
  assert.equal(lineLabel('(급행)'), '(급행)')
})

test('괄호 설명이 붙은 노선도 실시간 도착 노선과 맞는다', () => {
  assert.ok(sameLine('160', '160(나주역.나주.본덕.광주송정.광주공항)'))
  assert.ok(sameLine('160(나주역)', '160'))
  assert.ok(!sameLine('1160', '160(나주역)'))
})
