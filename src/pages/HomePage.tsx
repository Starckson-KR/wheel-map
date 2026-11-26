import { useEffect, useMemo, useRef, useState } from 'react'
import { AnimatePresence, m, useIsPresent } from 'motion/react'
import Icon from '../components/Icon'
import { PressButton, RiseLi, Swap } from '../components/motionKit'
import { useRiseOnce } from '../lib/useRiseOnce'
import { FADE, FADE_OUT, SPRING } from '../lib/motionTokens'
import DemoTools, { MockStrip } from '../components/DemoTools'
import ViewSettings from '../components/ViewSettings'
import { DATA_SOURCES } from '../lib/dataSources'
import DevAdmin from '../components/DevAdmin'
import CityConsentRow from '../components/CityConsentRow'
import PrivacyNotice from '../components/PrivacyNotice'
import { readDevReturn } from '../lib/devReturn'
import SheetHandle from '../components/SheetHandle'
import { loadBarriers } from '../lib/seed'
import { TO, go } from '../lib/nav'
import { EXTRA_TILES, FIXED_TILES, HOME_EXTRA_KEY, mineLines, parseHomeExtra, summarizeMine } from '../lib/homeSummary'
import { useReports } from '../lib/reportStore'
import { openGuide } from '../lib/usageGuide'
import { confirmSheet, toast } from '../lib/uiStore'
import { CountText } from '../components/CountUp'
import AiSearch from '../components/AiSearch'
import { loadPubDataset } from '../lib/publicLayers'
import { pickCandidates } from '../lib/demoLarge'
import { Sentences } from '../components/Sentences'
import { useXmas } from '../lib/useXmas'
import { dismissXmasGift, tapStep, type TapState } from '../lib/xmas'
import { prefersCalm } from '../lib/viewPrefs'
import XmasSnow, { type SnowHandle } from '../components/XmasSnow'
import XmasGift from '../components/XmasGift'
import { Wordmark } from '../components/Wordmark'
import { usePullRefresh } from '../components/usePullRefresh'
import { WeatherLine } from '../components/WeatherBits'
import InstallBanner from '../components/onboarding/InstallBanner'

// 전체메뉴: 묶음별로. to가 주소면 그 화면으로, act면 시트·안내를 연다.
type MenuItem = { id: string; icon: string; label: string; to?: string; act?: 'settings' | 'guide' }
const MENU_GROUPS: { title: string; items: MenuItem[] }[] = [
  { title: '둘러보기', items: [
    { id: 'home', icon: 'home', label: '홈', to: TO.home },
    { id: 'map', icon: 'map', label: '동행지도', to: TO.map },
    { id: 'progress', icon: 'check', label: '개선 현황', to: TO.progress },
  ] },
  { title: '제보', items: [
    { id: 'new', icon: 'report', label: '제보하기', to: TO.newReport },
    { id: 'mine', icon: 'list', label: '내 제보', to: TO.report },
    { id: 'agency', icon: 'building', label: '담당 기관 안내', to: TO.agency },
  ] },
  { title: '혜택·참여', items: [
    { id: 'alerts', icon: 'bell', label: '혜택알림', to: TO.alerts },
    { id: 'ranking', icon: 'star', label: '랭킹', to: '#/me?section=ranking' },
    { id: 'challenge', icon: 'medal', label: '챌린지', to: '#/me?section=challenge' },
  ] },
  { title: '내 정보·설정', items: [
    { id: 'me', icon: 'user', label: '내 정보', to: TO.me },
    { id: 'settings', icon: 'gear', label: '설정', act: 'settings' },
    { id: 'guide', icon: 'help', label: '이용 안내', act: 'guide' },
  ] },
]
const MENU_ITEMS = MENU_GROUPS.flatMap((g) => g.items)

type SheetItem = { id: string; icon: string; label: string }

// 아래에서 올라오는 목록 시트: 전체메뉴와 「+ 추가」가 같이 쓴다.
// selectedId가 있으면 그 줄에 체크가 붙고, onClear가 있으면 맨 아래에 「비우기」가 보인다.
function ListSheet({ title, items, groups, selectedId, onPick, onClear, onClose }: { title: string; items?: SheetItem[]; groups?: { title: string; items: SheetItem[] }[]; selectedId?: string; onPick: (id: string) => void; onClear?: () => void; onClose: () => void }) {
  const rows = (list: SheetItem[]) =>
    list.map((it) => (
      <li key={it.id}>
        <button type="button" className="hs-item" aria-current={it.id === selectedId || undefined} onClick={() => onPick(it.id)}>
          <span className="hs-ic"><Icon name={it.icon} size={20} /></span>
          <span>{it.label}</span>
          <Swap k={it.id === selectedId ? 'check' : 'chev'} pop><Icon name={it.id === selectedId ? 'check' : 'chev'} size={it.id === selectedId ? 18 : 16} /></Swap>
        </button>
      </li>
    ))
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
        className={'hs-sheet' + (groups ? ' hs-grouped' : '')}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(e) => e.stopPropagation()}
        initial={{ y: '100%' }}
        animate={{ y: 0, transition: SPRING.sheet }}
        exit={{ y: '100%', transition: { ...SPRING.sheet, restDelta: 0.5 } }}
      >
        <div className="hs-head">
          <h2>{title}</h2>
          <button type="button" className="hs-x" aria-label="닫기" onClick={onClose}><Icon name="close" size={22} /></button>
        </div>
        {groups ? (
          groups.map((g) => (
            <section key={g.title} className="hs-group" aria-label={g.title}>
              <h3 className="hs-gh">{g.title}</h3>
              <ul className="hs-list">{rows(g.items)}</ul>
            </section>
          ))
        ) : (
        <ul className="hs-list">
          {rows(items ?? [])}
          {onClear && (
            <li>
              <button type="button" className="hs-item hs-clear" onClick={onClear}>
                <span className="hs-ic"><Icon name="close" size={20} /></span>
                <span>비우기</span>
              </button>
            </li>
          )}
        </ul>
        )}
      </m.div>
    </m.div>
  )
}

declare const __BUILD_HASH__: string
declare const __BUILD_TIME__: string

const BARRIERS = loadBarriers()
// 설정 시트: 화면 설정, 접어 둔 「데이터 출처」와 「발표용」(시연 도구·행정 화면 입구·버전)
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
      <div ref={ref} className="ms ms-settings" data-sheet role="dialog" aria-modal="true" aria-label="설정">
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
          <CityConsentRow />
          <PrivacyNotice />
          <DevAdmin />
        </ul>
        <details className="ms-fold">
          <summary>데이터 출처<span className="hp-nchev"><Icon name="chev" size={16} /></span></summary>
          <ul className="ms-src">
            {DATA_SOURCES.map((t) => (
              <li key={t}>{t}</li>
            ))}
          </ul>
        </details>
        <details className="ms-fold">
          <summary>발표용<span className="hp-nchev"><Icon name="chev" size={16} /></span></summary>
          <ul className="pg-set">
            <li>
              <span>시연 도구</span>
              <DemoTools row page="map" onReset={onReset} barriers={BARRIERS} />
            </li>
            <li>
              <span>행정 화면<small>담당 공무원용 화면이에요</small></span>
              <button type="button" className="hm-tool hm-tool-row" aria-label="행정 화면 열기" onClick={() => { onClose(); go(TO.admin) }}><Icon name="chev" size={18} /></button>
            </li>
          </ul>
          <p className="ms-build">버전 {__BUILD_HASH__} · {__BUILD_TIME__}</p>
        </details>
      </div>
    </>
  )
}

const readExtra = () => {
  try {
    return localStorage.getItem(HOME_EXTRA_KEY)
  } catch {
    return null
  }
}

export default function HomePage() {
  const reports = useReports((s) => s.reports)
  const userId = useReports((s) => s.userId)
  const [menu, setMenu] = useState(false)
  const riseTiles = useRiseOnce('home-tiles')
  // 6번째 칸: 목록에서 고른 화면(localStorage에만 기억, 계정 동기화 없음)
  const [extraId, setExtraId] = useState<string | null>(() => parseHomeExtra(readExtra())?.id ?? null)
  const [picker, setPicker] = useState(false)
  const extra = parseHomeExtra(extraId)
  const saveExtra = (id: string | null) => {
    setExtraId(id)
    setPicker(false)
    try {
      if (id) localStorage.setItem(HOME_EXTRA_KEY, id)
      else localStorage.removeItem(HOME_EXTRA_KEY)
    } catch {
      /* 저장하지 못해도 이번에는 바뀐다 */
    }
  }
  const openTile = (to: string) => (to ? go(to) : openGuide())
  const [settings, setSettings] = useState(() => readDevReturn() !== null) // 개발자 관리에서 신고를 보고 뒤로 왔으면 설정 시트를 다시 연다
  const [filling, setFilling] = useState(false)
  const [fillMsg, setFillMsg] = useState('')
  // 「처음이세요?」는 첫 방문 때만: 한 번 눌러 닫거나 체험 데이터를 채우면 다시 보이지 않는다
  const [skipTrial, setSkipTrialState] = useState(() => {
    try {
      return localStorage.getItem('wheelmap.trialSeen') === '1'
    } catch {
      return false
    }
  })
  const setSkipTrial = (v: boolean) => {
    setSkipTrialState(v)
    try {
      localStorage.setItem('wheelmap.trialSeen', v ? '1' : '0')
    } catch {
      /* 저장하지 못해도 이번에는 닫힌다 */
    }
  }
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
      setSkipTrial(true)
      toast(n > 0 ? '체험 데이터를 채웠어요.' : '체험 데이터가 이미 있어요.')
      go(TO.map)
    } catch {
      setFillMsg('위치 자료를 불러오지 못했어요. 인터넷 연결을 확인하고 다시 눌러 주세요.')
    } finally {
      setFilling(false)
    }
  }
  // 당겨서 새로고침: 「내 제보」 숫자를 다시 계산하고 등장 연출을 다시 보인다. 새로 받아 오는 자료는 없다.
  const [tick, setTick] = useState(0)
  const scrollRef = useRef<HTMLDivElement>(null)
  const bodyRef = useRef<HTMLDivElement>(null)
  const indRef = useRef<HTMLDivElement>(null)
  const { refresh } = usePullRefresh({ scrollRef, bodyRef, indRef, onRefresh: () => setTick((t) => t + 1) })
  // AI 검색의 「이용 안내」 결과도 사용법 슬라이드를 연다
  const openHelp = openGuide

  const mine = useMemo(() => mineLines(summarizeMine(reports, userId)), [reports, userId, tick])

  // 크리스마스 「첫눈」: 켜짐 기간에 로고를 연달아 5번 누르면 눈이 내리고, 내리는 중에 한 번 더 누르면 그친다
  const xmas = useXmas()
  const [snow, setSnow] = useState(false)
  // 크리스마스 모드(관리자가 켬)에서는 첫 화면 연출을 닫자마자 눈이 내린다
  const snowAuto = xmas.mode && !xmas.intro
  useEffect(() => {
    if (snowAuto) setSnow(true)
  }, [snowAuto])
  const pageRef = useRef<HTMLDivElement>(null)
  const snowRef = useRef<SnowHandle>(null)
  const tapRef = useRef<TapState>({ n: 0, t: 0 })
  useEffect(() => {
    if (!xmas.on) setSnow(false)
  }, [xmas.on])
  const onLogoTap = (btn: HTMLButtonElement) => {
    if (!xmas.on) return
    if (!prefersCalm()) {
      btn.classList.remove('xs-wob')
      void btn.offsetWidth
      btn.classList.add('xs-wob')
    }
    if (snow) {
      tapRef.current = { n: 0, t: 0 }
      setSnow(false)
      return
    }
    const r = tapStep(tapRef.current, performance.now())
    tapRef.current = r
    if (r.fire) return setSnow(true)
    const b = btn.querySelector('.wordmark-bang')?.getBoundingClientRect()
    if (b) snowRef.current?.hint(b.left + b.width / 2, b.bottom + 2)
  }

  return (
    <div className="bm pg" ref={pageRef}>
      {xmas.on && <div className={'xs-sky' + (snow ? ' on' : '')} aria-hidden="true" />}
      <div className="pr-ind" ref={indRef} role="status" aria-live="polite" data-phase="idle">
        <svg className="pr-ic" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
          <path d="M20 12a8 8 0 1 1-2.6-5.9M20 4v5h-5" />
        </svg>
        <span data-pr-label />
      </div>
      <div className="pg-scroll hp-scroll" ref={scrollRef}>
        <div className="pg-col hp" ref={bodyRef}>
          <MockStrip />
          <InstallBanner />
          <header className="pg-top">
            <h1 className="pg-brand">
              <button type="button" aria-label="이의있음 홈" onClick={(e) => { go(TO.home); onLogoTap(e.currentTarget) }}><Wordmark decorative /></button>
            </h1>
            <div className="pg-icons">
              <button type="button" className="pg-ic" aria-label="전체 메뉴 열기" aria-haspopup="dialog" onClick={() => { setSettings(false); setMenu(true) }}><Icon name="menu" size={24} /></button>
            </div>
          </header>
          <WeatherLine />

          {/* 「처음이세요?」 카드가 닫힐 때: 카드는 흐려지며 빠지고, 아래 내용(.hp-rest)은 제자리로 미끄러져 올라온다 */}
          <AnimatePresence mode="popLayout" initial={false}>
          {needTrial && (
            <m.section key="trial" className="hp-trial" aria-labelledby="h-trial" exit={{ opacity: 0, scale: 0.97, transition: FADE_OUT }}>
              <h2 id="h-trial">처음이세요?</h2>
              <Sentences as="p">체험 데이터를 채우면 지도와 랭킹이 채워져요. 모두 가상이고, 제보는 실제로 접수되지 않아요.</Sentences>
              <div className="hp-trial-act">
                <button type="button" className="rf-primary" disabled={filling} onClick={fillTrial}>체험 데이터 채우기</button>
                <button type="button" disabled={filling} onClick={() => setSkipTrial(true)}>그냥 둘러보기</button>
              </div>
              {fillMsg && <Sentences as="p" className="hp-trial-msg" role="status">{fillMsg}</Sentences>}
            </m.section>
          )}
          </AnimatePresence>

          <m.div className="hp-rest" layout="position" transition={SPRING.screen}>

          <section className="hp-ask-wrap" aria-labelledby="h-q">
            <h2 id="h-q" className="hp-q">어디가 불편하세요?</h2>
            <AiSearch onHelp={openHelp} home />
          </section>

          <section className="hp-mine" aria-labelledby="h-mine">
            <PressButton type="button" className="hp-mine-go" onClick={() => go('#/report?section=mine')}>
              <span id="h-mine" className="hp-mine-t">내 제보</span>
              <span id="h-mine-n" className="hp-mine-n"><CountText text={mine.big} /></span>
              {mine.sub && <span className="hp-mine-s">{mine.sub}</span>}
              <span className="hp-mine-chev" aria-hidden="true"><Icon name="chev" size={20} /></span>
            </PressButton>
            <button type="button" className="hp-mine-re" aria-label="내 제보 새로고침" onClick={refresh}><Icon name="refresh" size={20} /></button>
          </section>

          <section className="hp-svc" aria-labelledby="h-svc">
            <div className="hp-sh">
              <h2 id="h-svc">자주 쓰는 서비스</h2>
              <button type="button" className="hp-link" onClick={() => setPicker(true)}>편집</button>
            </div>
            <ul className="hp-tiles">
              {FIXED_TILES.map((t, i) => (
                <RiseLi key={t.id + tick} first={riseTiles || tick > 0} i={i}>
                  <PressButton type="button" className="hp-tile" onClick={() => go(t.to)}>
                    <span className="hp-tile-ic"><Icon name={t.icon} size={26} /></span>
                    <span className="hp-tile-t">{t.label}</span>
                  </PressButton>
                </RiseLi>
              ))}
              {/* 여섯 번째 칸: 고르거나 비우면 이전 칸은 작아지며 사라지고 새 칸이 살짝 커지며 나타난다 */}
              <RiseLi key={'extra' + tick} className="hp-tile-slot" first={riseTiles || tick > 0} i={FIXED_TILES.length}>
                <AnimatePresence mode="popLayout" initial={false}>
                  <m.div
                    key={extra?.id ?? 'add'}
                    className="hp-tile-swap"
                    initial={{ opacity: 0, scale: 0.9 }}
                    animate={{ opacity: 1, scale: 1, transition: { scale: SPRING.screen, opacity: FADE } }}
                    exit={{ opacity: 0, scale: 0.94, transition: FADE_OUT }}
                  >
                    {extra ? (
                      <PressButton type="button" className="hp-tile" onClick={() => openTile(extra.to)}>
                        <span className="hp-tile-ic"><Icon name={extra.icon} size={26} /></span>
                        <span className="hp-tile-t">{extra.label}</span>
                      </PressButton>
                    ) : (
                      <PressButton type="button" className="hp-tile hp-tile-add" aria-haspopup="dialog" onClick={() => setPicker(true)}>
                        <span className="hp-tile-ic"><Icon name="plus" size={26} /></span>
                        <span className="hp-tile-t">추가</span>
                      </PressButton>
                    )}
                  </m.div>
                </AnimatePresence>
              </RiseLi>
            </ul>
          </section>
          </m.div>
        </div>
      </div>
      {xmas.on && <XmasSnow ref={snowRef} on={snow} host={pageRef} chime={xmas.mode} />}
      {xmas.gift && <XmasGift onDone={dismissXmasGift} />}
      <AnimatePresence>
        {menu && (
          <ListSheet
            key="menu"
            title="전체 메뉴"
            groups={MENU_GROUPS}
            onPick={(id) => {
              const it = MENU_ITEMS.find((x) => x.id === id)
              setMenu(false)
              if (it?.act === 'settings') setSettings(true)
              else if (it?.act === 'guide') openGuide()
              else go(it?.to ?? TO.home)
            }}
            onClose={() => setMenu(false)}
          />
        )}
        {picker && (
          <ListSheet
            key="extra"
            title="여섯 번째 칸"
            items={EXTRA_TILES.map(({ id, icon, label }) => ({ id, icon, label }))}
            selectedId={extra?.id}
            onPick={saveExtra}
            onClear={extra ? () => saveExtra(null) : undefined}
            onClose={() => setPicker(false)}
          />
        )}
      </AnimatePresence>
      {settings && <SettingsSheet onClose={() => setSettings(false)} />}
    </div>
  )
}
