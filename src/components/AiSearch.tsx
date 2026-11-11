import { useEffect, useId, useRef, useState } from 'react'
import Icon from './Icon'
import { TO, go } from '../lib/nav'
import { AI_INTENT_URL } from '../lib/config'
import { AI_PREF_EVENT, getAiEnabled } from '../lib/aiSearch/aiPref'
import { understand } from '../lib/aiSearch/client'
import type { FallbackReason, Understood } from '../lib/aiSearch/client'
import { targetFor } from '../lib/aiSearch/intents'
import type { MovableIntent } from '../lib/aiSearch/intents'
import { MAX_QUESTION_CHARS, cleanQuestion, hasPersonalInfo } from '../lib/aiSearch/validate'

// 홈 검색창: 질문을 쓰면 알맞은 화면을 「안내」한다. 자동으로 이동하지 않고, 사용자가 버튼을 눌러야 이동한다.
const EXAMPLES = ['경사로가 막혔어요', '가까운 저상버스', '내 접수번호 찾기', '개선된 곳 보기']

const REASON_TEXT: Record<FallbackReason, string> = {
  off: '키워드로 찾았어요 (AI 검색이 꺼져 있어요)',
  offline: '인터넷이 끊겨 키워드로 찾았어요',
  timeout: 'AI 연결이 늦어 키워드로 찾았어요',
  limit: '지금은 AI 검색을 쓸 수 없어 키워드로 찾았어요',
  error: 'AI 연결이 안 돼 키워드로 찾았어요',
  blocked: '',
}

const SLOT_NAME = { type: '종류', place: '장소', from: '출발', to: '도착' } as const

type State = { kind: 'idle' } | { kind: 'loading' } | { kind: 'done'; r: Understood }

export default function AiSearch({ onHelp }: { onHelp: () => void }) {
  const [q, setQ] = useState('')
  const [st, setSt] = useState<State>({ kind: 'idle' })
  const [aiOn, setAiOn] = useState(getAiEnabled)
  const seq = useRef(0)
  const inputId = useId()
  const hintId = useId()
  const busy = st.kind === 'loading'
  const personal = hasPersonalInfo(q)

  useEffect(() => {
    const on = () => setAiOn(getAiEnabled())
    window.addEventListener(AI_PREF_EVENT, on)
    return () => window.removeEventListener(AI_PREF_EVENT, on)
  }, [])

  const run = async (text: string) => {
    if (busy) return
    const clean = cleanQuestion(text)
    if (!clean) return
    if (clean !== text.trim()) setQ(clean) // 가려진 글을 그대로 보여 준다
    const id = ++seq.current
    setSt({ kind: 'loading' })
    const r = await understand(text, { url: AI_INTENT_URL, enabled: getAiEnabled() })
    if (id === seq.current) setSt({ kind: 'done', r })
  }

  const open = (intent: MovableIntent, question: string) => {
    const t = targetFor(intent, question)
    if (t.hash === null) onHelp()
    else go(t.hash)
  }

  const r = st.kind === 'done' ? st.r : null
  const movable = r && r.intent !== 'unknown' ? (r.intent as MovableIntent) : null
  const target = movable && r ? targetFor(movable, r.question) : null
  const slots = r ? (Object.entries(r.slots) as [keyof typeof SLOT_NAME, string][]).filter(([, v]) => v) : []

  return (
    <section className="hp-ai" aria-label="AI 검색">
      <p className="hp-ai-tag">
        <span className="hp-ai-badge">AI 검색</span>
        <span>궁금한 걸 적으면 알맞은 화면을 찾아 드려요</span>
      </p>
      <form
        role="search"
        className="hp-ask"
        onSubmit={(e) => {
          e.preventDefault()
          void run(q)
        }}
      >
        <input
          id={inputId}
          type="text"
          className="hp-ask-in"
          value={q}
          maxLength={MAX_QUESTION_CHARS}
          enterKeyHint="search"
          autoComplete="off"
          aria-label="질문 입력"
          aria-describedby={personal ? hintId : undefined}
          placeholder="무엇이든 물어보세요"
          onChange={(e) => setQ(e.target.value)}
        />
        <button type="button" className="hp-ask-btn" aria-label="휠체어 길찾기 바로 열기" onClick={() => go(TO.route)}>
          <Icon name="route" size={22} />
        </button>
        <button type="submit" className="hp-ask-btn hp-ask-go" aria-label="검색" disabled={busy || !q.trim()}>
          <Icon name="search" size={22} />
        </button>
      </form>
      {personal && (
        <p id={hintId} className="hp-ai-hint" role="note">
          개인정보는 적지 말아 주세요. 전화번호나 이메일은 보내기 전에 가려져요.
        </p>
      )}
      <ul className="hp-ai-chips" aria-label="예시 질문">
        {EXAMPLES.map((t) => (
          <li key={t}>
            <button
              type="button"
              className="hp-ai-chip"
              disabled={busy}
              onClick={() => {
                setQ(t)
                void run(t)
              }}
            >
              {t}
            </button>
          </li>
        ))}
        <li>
          <button type="button" className="hp-ai-chip hp-ai-chip-route" onClick={() => go(TO.route)}>
            <Icon name="route" size={16} /> 휠체어 길찾기
          </button>
        </li>
      </ul>

      <div className="hp-ai-live" aria-live="polite" aria-atomic="true" aria-busy={busy}>
        {st.kind === 'loading' && (
          <div className="hp-ai-card" role="status">
            <span className="sr-only">질문을 이해하는 중이에요</span>
            <div className="sk-card" aria-hidden="true">
              <span className="sk-bar sk-w40" />
              <span className="sk-bar sk-w70" />
              <span className="sk-bar" />
            </div>
          </div>
        )}
        {r && (
          <div className="hp-ai-card">
            <p className="hp-ai-meta">
              <span className="hp-ai-badge">AI 검색</span>
              {r.reason && REASON_TEXT[r.reason] && <span>{REASON_TEXT[r.reason]}</span>}
            </p>
            {movable && target ? (
              <>
                <p className="hp-ai-lead">이렇게 이해했어요</p>
                <p className="hp-ai-what">{target.label}</p>
                {slots.length > 0 && (
                  <p className="hp-ai-slots">
                    {slots.map(([k, v]) => `${SLOT_NAME[k]} ${v}`).join(' · ')}
                  </p>
                )}
                <button type="button" className="rf-primary hp-ai-go" onClick={() => open(movable, r.question)}>
                  {target.hash === null ? '안내 보기' : '이동하기'} <Icon name="chev" size={18} />
                </button>
              </>
            ) : (
              <>
                <p className="hp-ai-what">잘 모르겠어요</p>
                <p className="hp-ai-slots">이 중에 찾는 게 있나요?</p>
                <ul className="hp-ai-cands">
                  {r.candidates.map((c) => (
                    <li key={c}>
                      <button type="button" onClick={() => open(c, r.question)}>
                        <span>{targetFor(c).label}</span>
                        <Icon name="chev" size={16} />
                      </button>
                    </li>
                  ))}
                </ul>
                <p className="hp-ai-slots">다른 말로 물어봐 주세요.</p>
              </>
            )}
            <p className="hp-ai-note">AI 답변은 참고용이에요. 접수번호·처리기한·담당 기관은 해당 화면에서 확인해 주세요.</p>
          </div>
        )}
        {st.kind === 'idle' && !aiOn && <p className="hp-ai-off">AI 검색이 꺼져 있어요. 키워드로만 찾아요.</p>}
      </div>
    </section>
  )
}
