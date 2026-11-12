import { useMemo, useState } from 'react'
import Icon from './Icon'
import { BENEFITS, BENEFITS_CHECKED_AT } from '../lib/benefitsData'
import {
  CATEGORIES, buildView, categoryLabel, clearPrefs, hasPrefs, loadPrefs, periodText, savePrefs,
  type Benefit, type BenefitCategory, type BenefitPrefs, type WheelchairUse,
} from '../lib/benefits'
import { nowMs } from '../lib/reportStore'

const WHEEL: { id: WheelchairUse; label: string }[] = [
  { id: 'user', label: '이용해요' },
  { id: 'companion', label: '보호자·동행' },
  { id: 'none', label: '선택 안 함' },
]

const dateText = (iso: string) => `${iso.slice(0, 4)}년 ${Number(iso.slice(5, 7))}월 ${Number(iso.slice(8, 10))}일`

function BenefitCard({ b }: { b: Benefit }) {
  const need = b.status === '확인 필요'
  return (
    <li className="bn-card">
      <div className="bn-tags">
        <span className={'bn-tag bn-tag-' + b.category}>{categoryLabel(b.category)}</span>
        {need && <span className="bn-tag bn-tag-need">확인 필요</span>}
      </div>
      <h3>{b.title}</h3>
      <p className="bn-sum">{b.summary}</p>
      <dl className="bn-dl">
        <div><dt>대상</dt><dd>{b.target}</dd></div>
        <div><dt>기간</dt><dd>{periodText(b)}</dd></div>
        <div><dt>신청·문의</dt><dd>{b.agency}{b.contact && b.contact !== '확인 필요' ? ` · ${b.contact}` : ''}</dd></div>
      </dl>
      {b.unknowns.length > 0 && <p className="bn-unk">아직 확인하지 못한 것: {b.unknowns.join(', ')}</p>}
      <div className="bn-foot">
        <span className="bm-meta">확인일 {dateText(b.confirmedAt)} · {b.sourceName}</span>
        <a
          className="bn-link"
          href={b.sourceUrl}
          target="_blank"
          rel="noopener noreferrer"
          aria-label={`${b.title} 자세히 보기, 공식 누리집, 새 창으로 열려요`}
        >
          자세히 보기 <Icon name="chev" size={16} />
        </a>
      </div>
    </li>
  )
}

export default function MyBenefits() {
  const [prefs, setPrefs] = useState<BenefitPrefs>(loadPrefs)
  const [open, setOpen] = useState(false)
  const [showRest, setShowRest] = useState(false)
  const view = useMemo(() => buildView(BENEFITS, prefs, nowMs()), [prefs])
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
    setShowRest(false)
  }

  return (
    <section className="pg-card" id="pg-benefits" tabIndex={-1} aria-labelledby="bn-h">
      <h2 id="bn-h">나에게 맞는 혜택·행사</h2>
      <p className="bm-meta">광주 북구와 광주광역시, 중앙부처 누리집에서 직접 확인한 항목이에요.</p>

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
          <p className="bm-meta bn-priv">이 기기에만 저장돼요. 서버로 보내지 않고, 장애 유형이나 소득은 묻지 않아요.</p>
          <button type="button" className="pg-wide bn-clear" onClick={reset} disabled={!hasPrefs(prefs)}>
            설정 지우기
          </button>
        </div>
      )}

      {total === 0 ? (
        <div className="al-empty">
          <p className="bm-meta">지금 볼 수 있는 혜택·행사가 없어요. 기간이 지난 항목은 숨겨요. 공식 누리집에서 새 소식을 확인해 주세요.</p>
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
            <p className="bm-meta">설정에 맞는 혜택이 아직 없어요. 아래에서 다른 혜택을 볼 수 있어요.</p>
          ) : (
            <ul className="bn-list">{view.matched.map((b) => <BenefitCard key={b.id} b={b} />)}</ul>
          )}
          {view.groups.length > 0 && (
            <button type="button" className="pg-wide" aria-expanded={showRest || view.matched.length === 0} onClick={() => setShowRest((v) => !v)}>
              {showRest || view.matched.length === 0 ? '그 밖의 혜택 접기' : `그 밖의 혜택 ${total - view.matched.length}개 보기`}
            </button>
          )}
          {(showRest || view.matched.length === 0) && view.groups.map((g) => (
            <div key={g.category}>
              <h3 className="bn-gh">{categoryLabel(g.category)}</h3>
              <ul className="bn-list">{g.items.map((b) => <BenefitCard key={b.id} b={b} />)}</ul>
            </div>
          ))}
        </>
      ) : (
        view.groups.map((g) => (
          <div key={g.category}>
            <h3 className="bn-gh">{categoryLabel(g.category)}</h3>
            <ul className="bn-list">{g.items.map((b) => <BenefitCard key={b.id} b={b} />)}</ul>
          </div>
        ))
      )}

      {total > 0 && <p className="bn-note" role="note">내용은 바뀔 수 있어요. 신청 전에 기관 누리집에서 확인해 주세요.</p>}
      <p className="bm-meta">목록 확인일 {dateText(BENEFITS_CHECKED_AT)}</p>
    </section>
  )
}
