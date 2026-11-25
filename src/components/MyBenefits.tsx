import { useId, useMemo, useState } from 'react'
import Icon from './Icon'
import { RiseLi } from './motionKit'
import { useRiseOnce } from '../lib/useRiseOnce'
import { BENEFITS } from '../lib/benefitsData'
import {
  CATEGORIES, buildView, categoryLabel, clearPrefs, endText, endingSoonText, hasPrefs, loadPrefs, periodText, savePrefs, soonestEnding,
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

// 혜택 한 줄(이름 + 기간). 누르면 요약·대상·문의·누리집 링크가 펼쳐진다.
function BenefitLine({ b, i, first }: { b: Benefit; i: number; first: boolean }) {
  const period = periodText(b)
  const contact = b.agency + (b.contact && known(b.contact) ? ' · ' + b.contact : '')
  const [open, setOpen] = useState(false)
  const id = useId()
  return (
    <RiseLi first={first} i={i}>
      <button type="button" className="pg-line bn-line" aria-expanded={open} aria-controls={id} onClick={() => setOpen((v) => !v)}>
        <span className="pg-line-t">
          <strong>{b.title}</strong>
          {known(period) && <span>{period}</span>}
        </span>
        <span className={'hp-nchev bn-line-chev' + (open ? ' on' : '')} aria-hidden="true"><Icon name="chev" size={16} /></span>
      </button>
      <div id={id} className="bn-detail bn-line-detail" hidden={!open}>
        <Sentences as="p" className="bn-sum">{b.summary}</Sentences>
        <dl className="bn-dl">
          {known(b.target) && <div><dt>대상</dt><dd><TargetText text={b.target} /></dd></div>}
          {known(contact) && <div><dt>신청·문의</dt><dd><SplitLines text={contact} /></dd></div>}
        </dl>
        {b.sourceUrl && (
          <a
            className="bn-link"
            href={b.sourceUrl}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={`${b.title} 공식 누리집 열기, 새 창으로 열려요`}
          >
            공식 누리집 열기 <Icon name="chev" size={16} />
          </a>
        )}
      </div>
    </RiseLi>
  )
}

export default function MyBenefits() {
  const riseBn = useRiseOnce('benefits')
  const [prefs, setPrefs] = useState<BenefitPrefs>(loadPrefs)
  const [open, setOpen] = useState(false)
  const view = useMemo(() => buildView(BENEFITS, prefs, nowMs()), [prefs])
  // 맨 위 한 문장: 가장 먼저 끝나는 혜택(없으면 그리지 않는다)
  const hero = useMemo(() => soonestEnding(BENEFITS, nowMs()), [])
  // 분류 줄은 접혀 있고, 맨 위 혜택이 든 분류만 펼쳐 둔다
  const [openCats, setOpenCats] = useState<BenefitCategory[]>(() => (hero ? [hero.category] : []))
  const catId = useId()
  const total = view.matched.length + view.groups.reduce((n, g) => n + g.items.length, 0)

  const update = (p: BenefitPrefs) => {
    setPrefs(p)
    savePrefs(p)
  }
  const toggleTopic = (t: BenefitCategory) =>
    update({ ...prefs, topics: prefs.topics.includes(t) ? prefs.topics.filter((x) => x !== t) : [...prefs.topics, t] })
  const reset = () => {
    clearPrefs()
    setPrefs({ wheelchair: 'none', topics: [] })
  }
  const toggleCat = (c: BenefitCategory) => setOpenCats((v) => (v.includes(c) ? v.filter((x) => x !== c) : [...v, c]))

  return (
    <>
      {hero && (
        <section className="bn-hero" aria-labelledby="bn-hero-h">
          <p className="bn-hero-k">{endText(hero)}</p>
          <h3 id="bn-hero-h">{endingSoonText(hero)}</h3>
          <Sentences as="p">{hero.summary}</Sentences>
          {hero.sourceUrl && (
            <a
              className="bn-hero-go"
              href={hero.sourceUrl}
              target="_blank"
              rel="noopener noreferrer"
              aria-label={`${hero.title} 공식 누리집 열기, 새 창으로 열려요`}
            >
              공식 누리집 열기
            </a>
          )}
        </section>
      )}

      <section className="pg-card" id="pg-benefits" tabIndex={-1} aria-label="혜택·행사">
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
            <button type="button" className="pg-wide rf-primary bn-ok" onClick={() => setOpen(false)}>
              확인
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
        ) : (
          <>
            {view.prefsSet && (
              <>
                <h3 className="bn-gh">내 설정에 맞는 혜택 {view.matched.length}개</h3>
                {view.matched.length === 0 ? (
                  <Sentences as="p" className="bm-meta">설정에 맞는 혜택이 아직 없어요. 아래에서 다른 혜택을 볼 수 있어요.</Sentences>
                ) : (
                  <ul key={view.matched.map((b) => b.id).join()} className="pg-lines">
                    {view.matched.map((b, i) => <BenefitLine key={b.id} b={b} i={i} first={riseBn} />)}
                  </ul>
                )}
              </>
            )}
            {view.groups.length > 0 && (
              <ul className="bn-cats">
                {view.groups.map((g) => {
                  const on = openCats.includes(g.category)
                  const id = `${catId}-${g.category}`
                  return (
                    <li key={g.category}>
                      <button type="button" className="bn-cat" aria-expanded={on} aria-controls={id} onClick={() => toggleCat(g.category)}>
                        <span>{categoryLabel(g.category)}<b>{g.items.length}</b></span>
                        <span className={'hp-nchev' + (on ? ' on' : '')} aria-hidden="true"><Icon name="chev" size={16} /></span>
                      </button>
                      {on && (
                        <ul id={id} className="pg-lines bn-cat-items">
                          {g.items.map((b, i) => <BenefitLine key={b.id} b={b} i={i} first={riseBn} />)}
                        </ul>
                      )}
                    </li>
                  )
                })}
              </ul>
            )}
          </>
        )}

        {total > 0 && <Sentences as="p" className="bn-note" role="note">내용은 바뀔 수 있어요. 신청 전에 기관 누리집에서 확인해 주세요.</Sentences>}
      </section>
    </>
  )
}
