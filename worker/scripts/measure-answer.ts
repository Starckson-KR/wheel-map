// 사용법(저장소 루트에서): node worker/scripts/measure-answer.ts [번호,번호…] [--effort=low|medium] [--thinking=disabled] [--full]
// AI 답변 엔진(worker/src/answer.ts의 runAnswer)을 실제 질문으로 돌려 질문마다 첫 글자까지 걸린 시간·전체 시간·검색 횟수·토큰·달러와 돌아온 조각을 표로 찍는다.
// 실제로 돈이 나간다(검색 1번 약 1센트 + 토큰). 번호를 주면 그 질문만 돌린다(예: 1,6,8). --full은 답 전문과 출처 주소도 찍는다.
// 키는 저장소 루트 .env의 ANTHROPIC_API_KEY 줄에서 읽는다(줄 끝 # 주석·따옴표·공백은 걷어 낸다). 키 값은 어디에도 찍지 않는다.
import { readFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { runAnswer } from '../src/answer.ts'
import { DEFAULT_CLAUDE_MODEL } from '../src/claude.ts'
import { sanitizeQuestion } from '../src/intents.ts'
import type { AnswerFinal, HistoryTurn } from '../src/answerCore.ts'

// 달러/100만 토큰(Haiku 5.5, 프롬프트 10만 토큰 이하) + 웹 검색 1,000번에 10달러
const PRICE = { input: 0.1, output: 0.5, cacheRead: 0.01, cacheWrite: 0.125, search: 0.01 }

type Case = { q: string; want: string; history?: HistoryTurn[] }
const SET: Case[] = [
  { q: '휠체어로 병원 갈 때 차를 부를 수 있나요?', want: 'answer' },
  { q: '장애인 주차표지는 어디서 신청해요?', want: 'answer' },
  { q: '경사로가 막혔는데 어디에 알려요?', want: 'answer' },
  { q: '장애인 활동지원 서비스는 어떻게 신청해요?', want: 'answer' },
  { q: '새빛콜 요금은 얼마예요?', want: 'answer' },
  { q: '지원받을 수 있는 게 있을까요?', want: 'clarify' },
  { q: '신청하려면 뭐가 필요해요?', want: 'clarify' },
  { q: '근처 맛집 추천해 줘', want: 'out_of_scope' },
  { q: '용봉동 보도 공사는 언제 끝나요?', want: 'not_found' },
  {
    q: '밤에도 부를 수 있어요?',
    want: 'answer',
    history: [{ q: '휠체어로 병원 갈 때 차를 부를 수 있나요?', a: '네, 부를 수 있어요. 광주광역시교통약자이동지원센터(새빛콜)에 가입한 뒤 전화나 앱으로 접수해요.' }],
  },
]

function readKey(): string | null {
  const p = fileURLToPath(new URL('../../.env', import.meta.url))
  if (!existsSync(p)) return null
  for (const line of readFileSync(p, 'utf8').split(/\r?\n/)) {
    const m = /^\s*ANTHROPIC_API_KEY\s*=\s*(.*)$/.exec(line)
    if (!m) continue
    let v = m[1].trim()
    const q = /^(["'])(.*?)\1/.exec(v)
    v = q ? q[2] : v.replace(/\s*#.*$/, '')
    v = v.trim()
    return v || null
  }
  return null
}

const key = readKey()
if (!key) {
  console.log('키 대기: 저장소 루트 .env에 ANTHROPIC_API_KEY=... 줄이 없어 아무것도 부르지 않았습니다.')
  process.exit(0)
}

const args = process.argv.slice(2)
const flag = (name: string) => args.find((a) => a.startsWith(`--${name}=`))?.split('=')[1]
const full = args.includes('--full')
const effort = (flag('effort') as 'low' | 'medium' | 'high' | undefined) ?? 'low'
const thinking = flag('thinking') === 'disabled' ? 'disabled' : 'adaptive'
const pick = args.find((a) => /^[\d,]+$/.test(a))
const cases = pick ? pick.split(',').map((n) => SET[Number(n) - 1]).filter(Boolean) : SET
const model = process.env.ANSWER_MODEL || DEFAULT_CLAUDE_MODEL
const sec = (ms: number | null) => (ms === null ? '-' : (ms / 1000).toFixed(1) + '초')
const cell = (s: string) => s.replace(/\|/g, '/').replace(/\s+/g, ' ')

console.log(`질문 ${cases.length}개 · ${model} · effort=${effort} · thinking=${thinking}\n`)
console.log('| # | 질문 | 기대→결과 | 첫 조각 | 첫 글자 | 전체 | 검색 | 입력/출력 토큰(캐시 읽기) | 달러 | need | 답 앞 80자 | 출처 | actions | followups |')
console.log('|---|---|---|---|---|---|---|---|---|---|---|---|---|---|')

let total = 0
const details: string[] = []
for (const [i, c] of cases.entries()) {
  const t0 = Date.now()
  let firstEvent: number | null = null
  let firstText: number | null = null
  const trail: string[] = []
  try {
    const { final, usage } = await runAnswer({ apiKey: key, model, question: sanitizeQuestion(c.q), history: c.history, effort, thinking }, (e) => {
      firstEvent ??= Date.now() - t0
      if (e.type === 'delta') firstText ??= Date.now() - t0
      else if (e.type === 'status') trail.push(e.phase === 'searching' ? `검색「${e.query}」` : `읽음 ${e.sites.map((s) => s.domain).join(',')}`)
      else if (e.type === 'reset') trail.push('reset')
    })
    const ms = Date.now() - t0
    const cost = (usage.input * PRICE.input + usage.output * PRICE.output + usage.cacheRead * PRICE.cacheRead + usage.cacheWrite * PRICE.cacheWrite) / 1e6 + usage.searches * PRICE.search
    total += cost
    const f: AnswerFinal = final
    const body = f.kind === 'clarify' ? `${f.clarify?.question} [${f.clarify?.options.join(' / ')}]` : f.answer.slice(0, 80)
    console.log(
      `| ${i + 1} | ${cell(c.q)} | ${c.want}→${f.kind}${c.want === f.kind ? '' : ' ✗'} | ${sec(firstEvent)} | ${sec(firstText)} | ${sec(ms)} | ${usage.searches} | ${usage.input}/${usage.output} (${usage.cacheRead}) | $${cost.toFixed(4)} | ${cell(f.need)} | ${cell(body)} | ${[...new Set(f.sources.map((s) => s.domain))].join(', ')} | ${f.actions.map((a) => (a.id === 'call' ? `call:${a.phone}` : a.id === 'route' && a.to ? `route:${a.to}` : a.id)).join(', ')} | ${cell(f.followups.join(' / '))} |`,
    )
    if (full) details.push(`[${i + 1}] ${c.q}\n  진행: ${trail.join(' → ')}\n  답: ${f.answer}\n${f.sources.map((s) => `  출처: ${s.name} ${s.url}`).join('\n')}`)
  } catch (e) {
    // 오류 메시지에는 키가 들어가지 않는다(SDK가 헤더를 메시지에 넣지 않는다). 그래도 앞 160자만 찍는다.
    console.log(`| ${i + 1} | ${cell(c.q)} | ${c.want}→오류 | - | - | ${sec(Date.now() - t0)} | - | - | - | ${cell(e instanceof Error ? `${e.name}: ${e.message}`.slice(0, 160) : 'error')} | | | | |`)
  }
}
console.log(`\n합계 약 $${total.toFixed(4)} (질문당 평균 $${(total / cases.length).toFixed(4)})`)
if (details.length) console.log('\n' + details.join('\n\n'))
