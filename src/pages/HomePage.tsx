import { useEffect, useMemo, useRef, useState } from 'react'
import Icon from '../components/Icon'
import { MockStrip } from '../components/DemoTools'
import { TO, go } from '../lib/nav'
import { computeRewards } from '../lib/rewards'
import { nowMs, useReports } from '../lib/reportStore'
import { prefersCalm } from '../lib/viewPrefs'

const TILES = [
  { icon: 'route', label: '휠체어 길찾기', to: TO.route },
  { icon: 'report', label: '문제 신고하기', to: TO.newReport },
  { icon: 'list', label: '내 민원 진행 상황', to: TO.report },
  { icon: 'bus', label: '저상버스 도착', to: TO.bus },
  { icon: 'map', label: '동행지도', to: TO.map },
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
    id: 'enter', icon: 'enter', label: '건물 들어가기',
    lines: [
      { t: '도착지 출입이 불편한지 먼저 봐요', d: '길찾기 결과의 도착지 출입 안내를 읽어요', to: TO.route },
      { t: '출입구 주변 불편을 지도에서 찾아요', d: '지도에서 출입구 표시를 눌러요', to: TO.map },
      { t: '출입구 불편을 알려 줘요', d: '문제 신고하기에서 위치와 사진을 남겨요', to: TO.newReport },
    ],
  },
  {
    id: 'file', icon: 'help', label: '민원 넣는 법',
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
  { icon: 'route', label: '휠체어 길찾기', to: TO.route },
  { icon: 'bus', label: '저상버스 도착', to: TO.bus },
  { icon: 'report', label: '문제 신고하기', to: TO.newReport },
  { icon: 'list', label: '내 민원 진행 상황', to: TO.report },
  { icon: 'building', label: '담당 기관 안내', to: TO.agency },
  { icon: 'bell', label: '혜택알림', to: TO.alerts },
  { icon: 'user', label: '내 정보', to: TO.me },
]

function MenuSheet({ onClose }: { onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    ref.current?.querySelector('button')?.focus()
    const k = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', k)
    return () => window.removeEventListener('keydown', k)
  }, [onClose])
  return (
    <div className="hs-back" onClick={onClose}>
      <div ref={ref} className="hs-sheet" role="dialog" aria-modal="true" aria-label="전체메뉴" onClick={(e) => e.stopPropagation()}>
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
      </div>
    </div>
  )
}

export default function HomePage() {
  const reports = useReports((s) => s.reports)
  const userId = useReports((s) => s.userId)
  const [gid, setGid] = useState(GUIDES[0].id)
  const [menu, setMenu] = useState(false)
  const [notice, setNotice] = useState(false)
  const [more, setMore] = useState(false)
  const chipsRef = useRef<HTMLUListElement>(null)
  const guide = GUIDES.find((g) => g.id === gid) ?? GUIDES[0]
  const gi = GUIDES.findIndex((g) => g.id === guide.id)
  const lines = more ? guide.lines : guide.lines.slice(0, FOLDED)
  const canMore = guide.lines.length > FOLDED
  const slide = (d: number) => setGid(GUIDES[Math.min(GUIDES.length - 1, Math.max(0, gi + d))].id)
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
    const week = nowMs() - 7 * 86400000
    const rw = computeRewards(reports, [userId])[userId]
    const pts = rw.events.filter((e) => new Date(e.at).getTime() >= week).reduce((s, e) => s + e.points, 0)
    const wait = reports.filter((r) => r.userId !== userId && r.status === 'pending').length
    return [
      { tone: 'blue', t: doing > 0 ? `처리 중인 내 민원이 ${doing}건 있어요` : '처리 중인 내 민원이 아직 없어요', to: TO.report },
      { tone: 'green', t: `이번 주 참여 점수 ${pts}점을 모았어요`, to: TO.alerts },
      { tone: 'amber', t: recheck > 0 ? `재확인을 기다리는 민원이 ${recheck}건 있어요` : '재확인을 기다리는 민원이 없어요', to: TO.report },
      { tone: 'purple', t: wait > 0 ? `확인을 기다리는 제보가 ${wait}건 있어요` : '확인을 기다리는 제보가 없어요', to: TO.report },
    ]
  }, [reports, userId])

  return (
    <div className="bm pg">
      <div className="pg-scroll">
        <div className="pg-col hp">
          <MockStrip />
          <header className="pg-top">
            <h1 className="pg-brand">
              <button type="button" aria-label="북구동행지도 홈" onClick={() => go(TO.home)}>북구동행지도</button>
            </h1>
            <div className="pg-icons">
              <button type="button" className="pg-ic" aria-label="혜택알림" onClick={() => go(TO.alerts)}><Icon name="bell" size={22} /><span>알림</span></button>
              <button type="button" className="pg-ic" aria-label="내 정보" onClick={() => go(TO.me)}><Icon name="user" size={22} /><span>내 정보</span></button>
              <button type="button" className="pg-ic" aria-label="전체메뉴 열기" aria-haspopup="dialog" onClick={() => setMenu(true)}><Icon name="menu" size={22} /><span>전체메뉴</span></button>
            </div>
          </header>

          <div className="hp-notice">
            <button type="button" aria-expanded={notice} onClick={() => setNotice((v) => !v)}>
              <Icon name="bell" size={18} />
              <span>이용 안내 확인하기</span>
              <span className={'hp-nchev' + (notice ? ' on' : '')}><Icon name="chev" size={16} /></span>
            </button>
            {notice && <p role="note">발표용 시연 프로토타입이에요. 민원 접수는 실제로 보내지지 않아요.</p>}
          </div>

          <button type="button" className="hp-search" aria-label="어디로 가세요? 휠체어 길찾기" onClick={() => go(TO.route)}>
            <span><span className="hp-search-in">어디로 가세요? 휠체어 길찾기</span><Icon name="search" size={22} /></span>
          </button>

          <section className="hp-svc" aria-labelledby="h-svc">
            <div className="hp-sh">
              <h2 id="h-svc">자주 찾는 서비스</h2>
              <button type="button" className="hp-plus" aria-label="전체 기능 보기" onClick={() => setMenu(true)}><Icon name="plus" size={20} /></button>
            </div>
            <ul className="hp-tiles">
              {TILES.map((t) => (
                <li key={t.label}>
                  <button type="button" className="hp-tile" onClick={() => go(t.to)}>
                    <span className="hp-tile-t">{t.label}</span>
                    <span className="hp-tile-ic"><Icon name={t.icon} size={20} /></span>
                  </button>
                </li>
              ))}
            </ul>
          </section>

          <section aria-labelledby="h-news">
            <h2 id="h-news" className="hp-tab"><span>소식 <Icon name="chev" size={14} /></span></h2>
            <div className="hp-board">
              <ul className="hp-news">
                {news.map((n) => (
                  <li key={n.t}>
                    <button type="button" className={'hp-n hp-n-' + n.tone} onClick={() => go(n.to)}>
                      <span>{n.t}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          </section>

          <section aria-labelledby="h-guide">
            <div className="hp-tabrow">
              <h2 id="h-guide" className="hp-tab"><span>상황별 이동 가이드 <Icon name="chev" size={14} /></span></h2>
              <div className="hp-arrows">
                <button type="button" aria-label="이전 항목" disabled={gi <= 0} onClick={() => slide(-1)}><Icon name="chevL" size={16} /></button>
                <button type="button" aria-label="다음 항목" disabled={gi >= GUIDES.length - 1} onClick={() => slide(1)}><Icon name="chev" size={16} /></button>
              </div>
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
      {menu && <MenuSheet onClose={() => setMenu(false)} />}
    </div>
  )
}
