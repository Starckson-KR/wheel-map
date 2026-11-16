import { useEffect, useMemo, useRef, useState } from 'react'
import { AnimatePresence, m, useIsPresent } from 'motion/react'
import Icon from '../components/Icon'
import { PressButton, RiseLi } from '../components/motionKit'
import { useRiseOnce } from '../lib/useRiseOnce'
import { FADE, FADE_OUT, SPRING } from '../lib/motionTokens'
import DemoTools, { MockStrip } from '../components/DemoTools'
import ViewSettings from '../components/ViewSettings'
import DevAdmin from '../components/DevAdmin'
import { readDevReturn } from '../lib/devReturn'
import SheetHandle from '../components/SheetHandle'
import { loadBarriers } from '../lib/seed'
import { TO, go } from '../lib/nav'
import { computeRanking } from '../lib/ranking'
import { nowMs, rankingUserIds, useReports } from '../lib/reportStore'
import { prefersCalm } from '../lib/viewPrefs'
import { openGuide } from '../lib/usageGuide'
import { confirmSheet, toast } from '../lib/uiStore'
import { CountText } from '../components/CountUp'
import AiSearch from '../components/AiSearch'
import { BENEFITS } from '../lib/benefitsData'
import { homeCount, loadPrefs } from '../lib/benefits'
import { loadPubDataset } from '../lib/publicLayers'
import { pickCandidates } from '../lib/demoLarge'
import { Sentences } from '../components/Sentences'
import { Wordmark } from '../components/Wordmark'

const TILES = [
  { icon: 'report', label: '문제 신고하기', to: TO.newReport },
  { icon: 'list', label: '내 민원 현황', to: TO.report },
  { icon: 'bus', label: '저상버스 도착', to: TO.bus },
  { icon: 'map', label: '동행지도', to: TO.map },
  { icon: 'check', label: '개선 현황', to: TO.progress },
  { icon: 'building', label: '담당 기관 안내', to: TO.agency },
]

// 안내 문구는 앱에 이미 있는 기능을 쓰는 방법만 적는다. t는 할 일, d는 앱에서 누를 곳.
const GUIDES = [
  {
    id: 'bus', icon: 'bus', label: '버스 타기',
    lines: [
      { t: '저상버스가 오는지 먼저 확인해요', d: "길찾기에서 '버스 타고'를 골라요", to: TO.bus },
      { t: '정류장 근처에서 다음 저상버스를 봐요', d: '길찾기 결과의 정류장을 눌러요', to: TO.bus },
      { t: '타기 불편한 정류장이 있는지 봐요', d: '지도에서 정류장 표시를 눌러요', to: TO.map },
      { t: '불편한 정류장을 알려 줘요', d: '문제 신고하기에서 정류장 유형을 골라요', to: TO.newReport },
    ],
  },
  {
    id: 'cross', icon: 'cross', label: '길 건너기',
    lines: [
      { t: '건너기 어려운 곳을 피해 가요', d: "길찾기에서 '걸어서'를 골라요", to: TO.route },
      { t: '결과에서 지나기 어려운 곳을 확인해요', d: '○ △ X 표시와 설명을 읽어요', to: TO.route },
      { t: '횡단보도 불편을 알려 줘요', d: '문제 신고하기에서 위치와 사진을 남겨요', to: TO.newReport },
    ],
  },
  {
    id: 'enter', icon: 'enter', label: '건물 출입',
    lines: [
      { t: '도착지 출입이 불편한지 먼저 봐요', d: '길찾기 결과의 도착지 출입 안내를 읽어요', to: TO.route },
      { t: '출입구 주변 불편을 지도에서 찾아요', d: '지도에서 출입구 표시를 눌러요', to: TO.map },
      { t: '출입구 불편을 알려 줘요', d: '문제 신고하기에서 위치와 사진을 남겨요', to: TO.newReport },
    ],
  },
  {
    id: 'file', icon: 'help', label: '신고 방법',
    lines: [
      { t: '문제 신고하기로 시작해요', d: '유형, 위치, 사진과 설명 순서로 남겨요', to: TO.newReport },
      { t: '내 민원 진행 상황을 확인해요', d: '민원신고 탭에서 단계를 볼 수 있어요', to: TO.report },
      { t: '담당 기관을 확인해요', d: '문제에 따라 맡은 기관이 달라요', to: TO.agency },
      { t: '상태가 바뀌면 알림에서 봐요', d: '혜택알림 탭에서 변화를 볼 수 있어요', to: TO.alerts },
    ],
  },
]
const FOLDED = 2

const MENU = [
  { icon: 'home', label: '홈', to: TO.home },
  { icon: 'map', label: '동행지도', to: TO.map },
  { icon: 'bus', label: '저상버스 도착', to: TO.bus },
  { icon: 'report', label: '문제 신고하기', to: TO.newReport },
  { icon: 'list', label: '내 민원 현황', to: TO.report },
  { icon: 'check', label: '개선 현황', to: TO.progress },
  { icon: 'building', label: '담당 기관 안내', to: TO.agency },
  { icon: 'bell', label: '혜택알림', to: TO.alerts },
  { icon: 'user', label: '내 정보', to: TO.me },
]

function MenuSheet({ onClose }: { onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null)
  const present = useIsPresent()
  useEffect(() => {
    if (!present) return // 닫히는 동안에는 키 입력을 받지 않는다
    ref.current?.querySelector('button')?.focus()
    const k = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', k)
    return () => window.removeEventListener('keydown', k)
  }, [onClose, present])
  return (
    <m.div
      className="hs-back"
      onClick={onClose}
      inert={!present}
      aria-hidden={!present || undefined}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1, transition: FADE }}
      exit={{ opacity: 0, transition: FADE_OUT }}
    >
      <m.div
        ref={ref}
        className="hs-sheet"
        role="dialog"
        aria-modal="true"
        aria-label="전체메뉴"
        onClick={(e) => e.stopPropagation()}
        initial={{ y: '100%' }}
        animate={{ y: 0, transition: SPRING.sheet }}
        exit={{ y: '100%', transition: { ...SPRING.sheet, restDelta: 0.5 } }}
      >
        <div className="hs-head">
          <h2>전체메뉴</h2>
          <button type="button" className="hs-x" aria-label="닫기" onClick={onClose}><Icon name="close" size={22} /></button>
        </div>
        <ul className="hs-list">
          {MENU.map((m) => (
            <li key={m.label}>
              <button type="button" className="hs-item" onClick={() => { onClose(); go(m.to) }}>
                <span className="hs-ic"><Icon name={m.icon} size={20} /></span>
                <span>{m.label}</span>
                <Icon name="chev" size={16} />
              </button>
            </li>
          ))}
        </ul>
      </m.div>
    </m.div>
  )
}

declare const __BUILD_HASH__: string
declare const __BUILD_TIME__: string

const BARRIERS = loadBarriers()

// 설정 시트: 화면 설정과 시연 도구(기존 컴포넌트 재사용), 행정 화면 입구
function SettingsSheet({ onClose }: { onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null)
  const resetAll = useReports((s) => s.resetAll)
  const onReset = async () => {
    if (!(await confirmSheet({ title: '시연 데이터를 모두 지울까요?', body: '시연 중에 만든 제보와 사진을 모두 지워요. 팀 조사 데이터는 그대로예요.', confirmLabel: '모두 지우기', danger: true }))) return
    const err = await resetAll()
    if (err) toast(err)
    else toast('시연 데이터를 모두 지웠어요.')
  }
  useEffect(() => {
    ref.current?.querySelector<HTMLElement>('.bm-close')?.focus()
    const k = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', k)
    return () => window.removeEventListener('keydown', k)
  }, [onClose])
  return (
    <>
      <div className="ms-dim" onClick={onClose} />
      <div ref={ref} className="ms" data-sheet role="dialog" aria-modal="true" aria-label="설정">
        <SheetHandle onDown={onClose} />
        <div className="ms-head">
          <div>
            <h2>설정</h2>
          </div>
          <button type="button" className="bm-close" onClick={onClose}>닫기</button>
        </div>
        <ul className="pg-set">
          <li>
            <span>화면 설정<small>다크·라이트, 앱·PC 보기</small></span>
            <ViewSettings row />
          </li>
          <li>
            <span>시연 도구<small>발표용 설정이에요</small></span>
            <DemoTools row page="map" onReset={onReset} barriers={BARRIERS} />
          </li>
          <li>
            <span>행정 화면<small>담당 공무원용 화면이에요</small></span>
            <button type="button" className="hm-tool hm-tool-row" aria-label="행정 화면 열기" onClick={() => { onClose(); go(TO.admin) }}><Icon name="chev" size={18} /></button>
          </li>
          <DevAdmin />
        </ul>
        <p className="ms-build">버전 {__BUILD_HASH__} · {__BUILD_TIME__}</p>
      </div>
    </>
  )
}

export default function HomePage() {
  const reports = useReports((s) => s.reports)
  const userId = useReports((s) => s.userId)
  const [gid, setGid] = useState(GUIDES[0].id)
  const [menu, setMenu] = useState(false)
  const riseTiles = useRiseOnce('home-tiles')
  const riseNews = useRiseOnce('home-news')
  const [settings, setSettings] = useState(() => readDevReturn() !== null) // 개발자 관리에서 신고를 보고 뒤로 왔으면 설정 시트를 다시 연다
  const [more, setMore] = useState(false)
  const [filling, setFilling] = useState(false)
  const [fillMsg, setFillMsg] = useState('')
  const [skipTrial, setSkipTrial] = useState(false)
  const fillDemo = useReports((s) => s.fillDemo)
  const fillLargeDemo = useReports((s) => s.fillLargeDemo)
  // 체험 데이터(대규모 시연 데이터)가 없을 때만 홈 맨 위에 안내 카드를 보인다
  const needTrial = !skipTrial && !reports.some((r) => r.demoSet === 'large')
  // 시연 도구의 「대규모 시연 데이터 채우기」와 같은 store 함수를 쓴다(시민 A 몫은 기존 시연 10건 fillDemo가 채운다)
  const fillTrial = async () => {
    setFilling(true)
    setFillMsg('가상 데이터를 만드는 중이에요…')
    try {
      const barriers = loadBarriers()
      const [cw, bus, fac] = await Promise.all([loadPubDataset('crosswalk'), loadPubDataset('bus'), loadPubDataset('facility')])
      fillDemo(barriers)
      const n = fillLargeDemo(pickCandidates({ crosswalk: cw.items, bus: bus.items, facility: fac.items }), barriers)
      setFillMsg('')
      toast(n > 0 ? '체험 데이터를 채웠어요.' : '체험 데이터가 이미 있어요.')
      go(TO.map)
    } catch {
      setFillMsg('위치 자료를 불러오지 못했어요. 인터넷 연결을 확인하고 다시 눌러 주세요.')
    } finally {
      setFilling(false)
    }
  }
  const chipsRef = useRef<HTMLUListElement>(null)
  // AI 검색의 「이용 안내」 결과도 사용법 슬라이드를 연다
  const openHelp = openGuide
  const guide = GUIDES.find((g) => g.id === gid) ?? GUIDES[0]
  const lines = more ? guide.lines : guide.lines.slice(0, FOLDED)
  const canMore = guide.lines.length > FOLDED
  // 고른 항목이 칩 줄 안에서 보이도록 맞춘다
  const shownGid = useRef(gid)
  useEffect(() => {
    if (shownGid.current === gid) return
    shownGid.current = gid
    const el = chipsRef.current?.querySelector('[aria-pressed="true"]')
    const calm = prefersCalm()
    el?.scrollIntoView({ inline: 'center', block: 'nearest', behavior: calm ? 'auto' : 'smooth' })
  }, [gid])

  const news = useMemo(() => {
    const mine = reports.filter((r) => r.userId === userId)
    const doing = mine.filter((r) => ['verified', 'filed', 'assigned', 'in_progress'].includes(r.status)).length
    const recheck = mine.filter((r) => r.status === 'resolved').length
    // 이번 주(월~일) 점수와 순위는 혜택알림의 참여 랭킹과 같은 계산을 쓴다
    const ids = rankingUserIds()
    const row = computeRanking(reports, ids.includes(userId) ? ids : [...ids, userId], 'week', nowMs(), 0, false).rows.find((x) => x.userId === userId)
    const pts = row?.points ?? 0
    const myRank = row?.rank
    const wait = reports.filter((r) => r.userId !== userId && r.status === 'pending').length
    const bn = homeCount(BENEFITS, loadPrefs(), nowMs())
    // 알릴 것이 없는(0인) 소식은 그리지 않는다
    return [
      ...(doing > 0 ? [{ tone: 'blue', t: `처리 중인 내 민원이 ${doing}건 있어요`, to: TO.report }] : []),
      ...(pts > 0 || myRank ? [{ tone: 'green', t: myRank ? `이번 주 내 순위 ${myRank}위예요 · ${pts}점을 모았어요` : `이번 주 참여 점수 ${pts}점을 모았어요`, to: TO.alerts }] : []),
      ...(recheck > 0 ? [{ tone: 'amber', t: `재확인을 기다리는 민원이 ${recheck}건 있어요`, to: TO.report }] : []),
      ...(wait > 0 ? [{ tone: 'purple', t: `확인할 제보가 ${wait}건 있어요`, to: TO.report }] : []),
      ...(bn.count > 0 ? [{ tone: 'green', wide: true, t: bn.personal ? `나에게 맞는 혜택 ${bn.count}개를 찾았어요` : `알아두면 좋은 혜택·행사 ${bn.count}개를 모았어요`, to: TO.benefits }] : []),
    ]
  }, [reports, userId])

  return (
    <div className="bm pg">
      <div className="pg-scroll">
        <div className="pg-col hp">
          <MockStrip />
          <header className="pg-top">
            <h1 className="pg-brand">
              <button type="button" aria-label="이의있음 홈" onClick={() => go(TO.home)}><Wordmark decorative /></button>
            </h1>
            <div className="pg-icons">
              <button type="button" className="pg-ic" aria-label="설정" aria-haspopup="dialog" onClick={() => { setMenu(false); setSettings(true) }}><Icon name="gear" size={22} /><span>설정</span></button>
              <button type="button" className="pg-ic" aria-label="전체메뉴 열기" aria-haspopup="dialog" onClick={() => { setSettings(false); setMenu(true) }}><Icon name="menu" size={22} /><span>전체메뉴</span></button>
            </div>
          </header>


          {needTrial && (
            <section className="hp-trial" aria-labelledby="h-trial">
              <h2 id="h-trial">처음이세요?</h2>
              <Sentences as="p">체험 데이터를 채우면 지도와 랭킹이 채워져요. 모두 가상이고, 민원은 실제로 접수되지 않아요.</Sentences>
              <div className="hp-trial-act">
                <button type="button" className="rf-primary" disabled={filling} onClick={fillTrial}>체험 데이터 채우기</button>
                <button type="button" disabled={filling} onClick={() => setSkipTrial(true)}>그냥 둘러보기</button>
              </div>
              {fillMsg && <Sentences as="p" className="hp-trial-msg" role="status">{fillMsg}</Sentences>}
            </section>
          )}

          <div className="hp-notice">
            <button type="button" aria-haspopup="dialog" onClick={openGuide}>
              <Icon name="help" size={18} />
              <span>이용 안내 · 이렇게 해 보세요</span>
              <span className="hp-nchev"><Icon name="chev" size={16} /></span>
            </button>
          </div>

          <AiSearch onHelp={openHelp} />

          <section className="hp-svc" aria-labelledby="h-svc">
            <div className="hp-sh">
              <h2 id="h-svc">자주 찾는 서비스</h2>
              <button type="button" className="hp-plus" aria-label="전체 기능 보기" onClick={() => setMenu(true)}><Icon name="plus" size={20} /></button>
            </div>
            <ul className="hp-tiles">
              {TILES.map((t, i) => (
                <RiseLi key={t.label} first={riseTiles} i={i}>
                  <PressButton type="button" className="hp-tile" onClick={() => go(t.to)}>
                    <span className="hp-tile-t">{t.label}</span>
                    <span className="hp-tile-ic"><Icon name={t.icon} size={20} /></span>
                  </PressButton>
                </RiseLi>
              ))}
            </ul>
          </section>

          <section aria-labelledby="h-news">
            <h2 id="h-news" className="hp-tab"><span>소식 <Icon name="chev" size={14} /></span></h2>
            <div className="hp-board">
              {news.length === 0 && <p className="hp-news-empty">새 소식이 없어요</p>}
              <ul className="hp-news">
                {news.map((n, i) => (
                  <RiseLi key={n.t} first={riseNews} i={i} className={'wide' in n ? 'hp-news-wide' : undefined}>
                    <PressButton type="button" className={'hp-n hp-n-' + n.tone} onClick={() => go(n.to)}>
                      <span><CountText text={n.t} /></span>
                    </PressButton>
                  </RiseLi>
                ))}
              </ul>
            </div>
          </section>

          <section aria-labelledby="h-guide">
            <div className="hp-tabrow">
              <h2 id="h-guide" className="hp-tab"><span>상황별 이동 가이드 <Icon name="chev" size={14} /></span></h2>
            </div>
            <div className="hp-board">
              <ul className="hp-chips" ref={chipsRef}>
                {GUIDES.map((g) => (
                  <li key={g.id}>
                    <button type="button" className="hp-chip" aria-pressed={g.id === gid} onClick={() => setGid(g.id)}>
                      <span className="hp-chip-ic"><Icon name={g.icon} size={26} /></span>
                      <span>{g.label}</span>
                    </button>
                  </li>
                ))}
              </ul>
              <ul className="hp-rows" aria-label={`${guide.label} 안내`}>
                {lines.map((l) => (
                  <li key={l.t}>
                    <button type="button" className="hp-row" onClick={() => go(l.to)}>
                      <span className="hp-row-t"><strong>{l.t}</strong><span>{l.d}</span></span>
                      <Icon name="chev" size={18} />
                    </button>
                  </li>
                ))}
              </ul>
              {canMore && (
                <button type="button" className="hp-more" aria-expanded={more} onClick={() => setMore((v) => !v)}>
                  {more ? '접기' : `더보기 (${guide.lines.length - FOLDED})`} <span className={more ? 'hp-up' : ''}><Icon name="chevD" size={16} /></span>
                </button>
              )}
            </div>
          </section>
        </div>
      </div>
      <AnimatePresence>{menu && <MenuSheet onClose={() => setMenu(false)} />}</AnimatePresence>
      {settings && <SettingsSheet onClose={() => setSettings(false)} />}
    </div>
  )
}
