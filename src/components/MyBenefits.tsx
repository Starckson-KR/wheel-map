import { useId, useMemo, useState } from 'react'
import Icon from './Icon'
import { RiseLi } from './motionKit'
import { useRiseOnce } from '../lib/useRiseOnce'
import { BENEFITS } from '../lib/benefitsData'
import {
  CATEGORIES, buildView, categoryLabel, clearPrefs, hasPrefs, loadPrefs, periodText, savePrefs,
  type Benefit, type BenefitCategory, type BenefitPrefs, type WheelchairUse,
} from '../lib/benefits'
import { nowMs } from '../lib/reportStore'
import { Sentences } from './Sentences'
import { tidyBreaks } from '../lib/sentences'

const WHEEL: { id: WheelchairUse; label: string }[] = [
  { id: 'user', label: '이용해요' },
  { id: 'companion', label: '보호자·동행' },
  { id: 'none', label: '선택 안 함' },
]


// 긴 문의 글: " · "로 이어 붙인 항목은 줄을 나누고, 전화번호는 한 덩어리로 둔다(글은 그대로).
function SplitLines({ text }: { text: string }) {
  const raw = text.split(' · ')
  const parts = raw.filter((p) => !raw.some((q) => q !== p && q.includes(p)))
  if (parts.length < 2) return <>{tidyBreaks(text)}</>
  return <>{parts.map((p, i) => <span key={i} className="sent">{tidyBreaks(p)}</span>)}</>
}

// 대상 칸: 끝에 붙은 긴 괄호 설명(10자 넘음)은 "자세히"를 눌러야 펼친다. 짧은 괄호는 그대로 보인다.
function TargetText({ text }: { text: string }) {
  const [open, setOpen] = useState(false)
  const id = useId()
  const m = text.match(/^(.+?)\s*(\([^()]+\))$/)
  if (!m || m[2].length - 2 <= 10) return <>{tidyBreaks(text)}</>
  return (
    <>
      <span className="sent">{tidyBreaks(m[1])}</span>
      <button type="button" className="bn-fold" aria-expanded={open} aria-controls={id} onClick={() => setOpen((v) => !v)}>
        {open ? '접기' : '자세히'}
      </button>
      <span id={id} className="sent bn-fold-body" hidden={!open}>{tidyBreaks(m[2])}</span>
    </>
  )
}

// 정해지지 않은 값("확인 필요")은 그 칸을 보여 주지 않는다.
const known = (v: string) => v.trim() !== '' && !v.includes('확인 필요')

function BenefitCard({ b, i, first, showTag }: { b: Benefit; i: number; first: boolean; showTag?: boolean }) {
  const period = periodText(b)
  const contact = b.agency + (b.contact && known(b.contact) ? ' · ' + b.contact : '')
  const [open, setOpen] = useState(false)
  const id = useId()
  return (
    <RiseLi className="bn-card" first={first} i={i}>
      {showTag && (
        <div className="bn-tags">
          <span className={'bn-tag bn-tag-' + b.category}>{categoryLabel(b.category)}</span>
        </div>
      )}
      <h3>{b.title}</h3>
      <Sentences as="p" className="bn-sum">{b.summary}</Sentences>
      <button type="button" className="bn-more" aria-expanded={open} aria-controls={id} onClick={() => setOpen((v) => !v)}>
        {open ? '접기' : '자세히 보기'}
      </button>
      <div id={id} className="bn-detail" hidden={!open}>
        <dl className="bn-dl">
          {known(b.target) && <div><dt>대상</dt><dd><TargetText text={b.target} /></dd></div>}
          {known(period) && <div><dt>기간</dt><dd>{period}</dd></div>}
          {known(contact) && <div><dt>신청·문의</dt><dd><SplitLines text={contact} /></dd></div>}
        </dl>
        <a
          className="bn-link"
          href={b.sourceUrl}
          target="_blank"
          rel="noopener noreferrer"
          aria-label={`${b.title} 공식 누리집 열기, 새 창으로 열려요`}
        >
          공식 누리집 열기 <Icon name="chev" size={16} />
        </a>
      </div>
    </RiseLi>
  )
}

export default function MyBenefits() {
  const riseBn = useRiseOnce('benefits')
  const [prefs, setPrefs] = useState<BenefitPrefs>(loadPrefs)
  const [open, setOpen] = useState(false)
  const [showRest, setShowRest] = useState(false)
  const view = useMemo(() => buildView(BENEFITS, prefs, nowMs()), [prefs])
  const total = view.matched.length + view.groups.reduce((n, g) => n + g.items.length, 0)
  // 맞는 혜택이 모두 같은 분류면 분류 딱지를 카드마다 되풀이하지 않고 목록 위에 한 번만 보인다
  const oneCategory = view.matched.length > 1 && view.matched.every((b) => b.category === view.matched[0].category) ? view.matched[0].category : null

  const update = (p: BenefitPrefs) => {
    setPrefs(p)
    savePrefs(p)
  }
  const toggleTopic = (t: BenefitCategory) =>
    update({ ...prefs, topics: prefs.topics.includes(t) ? prefs.topics.filter((x) => x !== t) : [...prefs.topics, t] })
  const reset = () => {
    clearPrefs()
    setPrefs({ wheelchair: 'none', topics: [] })
    setShowRest(false)
  }

  return (
    <section className="pg-card" id="pg-benefits" tabIndex={-1} aria-labelledby="bn-h">
      <h2 id="bn-h">나에게 맞는 혜택·행사</h2>

      <button type="button" className="bn-set" aria-expanded={open} aria-controls="bn-panel" onClick={() => setOpen((v) => !v)}>
        <span>나에게 맞게 보기 <small>{hasPrefs(prefs) ? '설정했어요' : '선택 사항'}</small></span>
        <span className={'hp-nchev' + (open ? ' on' : '')}><Icon name="chev" size={16} /></span>
      </button>

      {open && (
        <div className="bn-panel" id="bn-panel">
          <div role="group" aria-labelledby="bn-w">
            <p id="bn-w" className="bn-q">휠체어를 이용하세요? <small>답하지 않아도 돼요</small></p>
            <div className="al-chips">
              {WHEEL.map((w) => (
                <button key={w.id} type="button" className="al-chip" aria-pressed={prefs.wheelchair === w.id} onClick={() => update({ ...prefs, wheelchair: w.id })}>
                  {w.label}
                </button>
              ))}
            </div>
          </div>
          <div role="group" aria-labelledby="bn-t">
            <p id="bn-t" className="bn-q">관심 분야 <small>여러 개 골라도 돼요</small></p>
            <div className="al-chips">
              {CATEGORIES.map((c) => (
                <button key={c.id} type="button" className="al-chip" aria-pressed={prefs.topics.includes(c.id)} onClick={() => toggleTopic(c.id)}>
                  {c.label}
                </button>
              ))}
            </div>
          </div>
          <button type="button" className="pg-wide bn-clear" onClick={reset} disabled={!hasPrefs(prefs)}>
            설정 지우기
          </button>
        </div>
      )}

      {total === 0 ? (
        <div className="al-empty">
          <Sentences as="p" className="bm-meta">지금 볼 수 있는 혜택·행사가 없어요.</Sentences>
          <div className="empty-act">
            <a className="bn-open" href="https://bukgu.gwangju.kr/menu.es?mid=a10305000000" target="_blank" rel="noopener noreferrer" aria-label="북구청 장애인복지 누리집 열기, 새 창으로 열려요">
              북구청 장애인복지 보기
            </a>
          </div>
        </div>
      ) : view.prefsSet ? (
        <>
          <h3 className="bn-gh">내 설정에 맞는 혜택 {view.matched.length}개</h3>
          {view.matched.length === 0 ? (
            <Sentences as="p" className="bm-meta">설정에 맞는 혜택이 아직 없어요. 아래에서 다른 혜택을 볼 수 있어요.</Sentences>
          ) : (
            <>
              {oneCategory && (
                <div className="bn-tags">
                  <span className={'bn-tag bn-tag-' + oneCategory}>{categoryLabel(oneCategory)}</span>
                </div>
              )}
              <ul key={view.matched.map((b) => b.id).join()} className="bn-list">{view.matched.map((b, i) => <BenefitCard key={b.id} b={b} i={i} first={riseBn} showTag={!oneCategory} />)}</ul>
            </>
          )}
          {view.groups.length > 0 && (
            <button type="button" className="pg-wide" aria-expanded={showRest || view.matched.length === 0} onClick={() => setShowRest((v) => !v)}>
              {showRest || view.matched.length === 0 ? '그 밖의 혜택 접기' : `그 밖의 혜택 ${total - view.matched.length}개 보기`}
            </button>
          )}
          {(showRest || view.matched.length === 0) && view.groups.map((g) => (
            <div key={g.category}>
              <h3 className="bn-gh">{categoryLabel(g.category)}</h3>
              <ul className="bn-list">{g.items.map((b, i) => <BenefitCard key={b.id} b={b} i={i} first={riseBn} />)}</ul>
            </div>
          ))}
        </>
      ) : (
        view.groups.map((g) => (
          <div key={g.category}>
            <h3 className="bn-gh">{categoryLabel(g.category)}</h3>
            <ul className="bn-list">{g.items.map((b, i) => <BenefitCard key={b.id} b={b} i={i} first={riseBn} />)}</ul>
          </div>
        ))
      )}

      {total > 0 && <Sentences as="p" className="bn-note" role="note">내용은 바뀔 수 있어요. 신청 전에 기관 누리집에서 확인해 주세요.</Sentences>}
    </section>
  )
}
