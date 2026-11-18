// 처음 들어온 사람에게 뜨는 초기 설정 게이트(아이폰 첫 설정처럼).
// 로그인 안 됨 → 언어부터 / 로그인됐지만 초기 설정 전 → 이동 방식부터 / 둘 다 끝 → 바로 앱.
// 앱 위를 덮는 전체 화면이고, 끝나면 부드럽게 앱이 드러난다. 사용법: <OnboardingGate>{앱}</OnboardingGate>
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import '../../styles/onboarding.css'
import { m } from 'motion/react'
import Icon from '../Icon'
import { PressButton, SegBg } from '../motionKit'
import { SPRING } from '../../lib/motionTokens'
import PinPad from './PinPad'
import WelcomeScreen from './WelcomeScreen'
import InstallGuide from './InstallGuide'
import { guessDevice, isStandalone, type Device } from './installEnv'
import Stage from './Stage'
import { accountConnected, logIn, signUp, useGateAccount } from './accountAdapter'
import {
  DOT_COUNT, MOBILITY_OPTIONS, afterDevice, afterWelcome, ONBOARDED_KEY, ONBOARDING_EVENT, PROFILE_KEY, afterAuth, authMessage, cleanName, dotIndex, isSkipHash, nameOk,
  parsePreview, parseProfile, startScreen, toBenefitPrefs, type AuthCode, type Mobility, type Profile, type Screen,
} from './flow'
import { CATEGORIES, savePrefs, type BenefitCategory } from '../../lib/benefits'
import { getLang, setLang, type Lang } from '../../lib/i18n'
import { ONBOARDED_EVENT } from '../../lib/usageGuide'
import {
  getMotionReduce, getTextSize, getTheme, PREFS_CHANGE_EVENT, prefersCalm, setMotionReduce, setTextSize, setTheme, type TextSize, type ThemeMode,
} from '../../lib/viewPrefs'
import { Sentences } from '../Sentences'


const read = (k: string): string | null => {
  try {
    return localStorage.getItem(k)
  } catch {
    return null
  }
}
const isOnboarded = () => read(ONBOARDED_KEY) === '1'
const writeKey = (k: string, v: string | null) => {
  try {
    if (v === null) localStorage.removeItem(k)
    else localStorage.setItem(k, v)
  } catch {
    /* 저장이 막혀도 이번 화면에는 적용된다 */
  }
}

type Flow = { stack: Screen[]; dir: 1 | -1 }
type Mode = 'login' | 'signup'

const GREETS: { text: string; lang: string }[] = [
  { text: '안녕하세요', lang: 'ko' },
  { text: 'Hello', lang: 'en' },
  { text: 'こんにちは', lang: 'ja' },
  { text: '你好', lang: 'zh' },
  { text: 'Hola', lang: 'es' },
]

function Title({ children, id }: { children: ReactNode; id?: string }) {
  const ref = useRef<HTMLHeadingElement>(null)
  useEffect(() => {
    ref.current?.focus({ preventScroll: true })
  }, [])
  return (
    <h1 className="ob-title" tabIndex={-1} ref={ref} id={id}>
      {children}
    </h1>
  )
}

export default function OnboardingGate({ children, skipPages = ['admin', 'verify'] }: { children: ReactNode; skipPages?: string[] }) {
  const { user } = useGateAccount()
  const [hash, setHash] = useState(() => location.hash)
  const [flowState, setFlow] = useState<Flow | null>(null)
  const [leaving, setLeaving] = useState(false)
  const [mode, setMode] = useState<Mode>('signup')
  const [name, setName] = useState('')
  const [pin, setPin] = useState('')
  const [pin2, setPin2] = useState('')
  const [notice, setNotice] = useState<{ text: string; code?: AuthCode } | null>(null)
  const [shake, setShake] = useState(0)
  const [busy, setBusy] = useState(false)
  const [lang, setLangState] = useState<Lang>(() => getLang() ?? 'ko')
  const [profile, setProfile] = useState<Profile>(() => parseProfile(read(PROFILE_KEY)))
  const [device, setDevice] = useState<Device | null>(() => guessDevice(navigator.userAgent))
  const [picked, setPicked] = useState<Mobility | null>(() => (read(PROFILE_KEY) ? parseProfile(read(PROFILE_KEY)).mobility : null))
  const [text, setText] = useState<TextSize>(getTextSize)
  const [theme, setThemeState] = useState<ThemeMode>(getTheme)
  const [motion, setMotion] = useState(getMotionReduce)
  const mounted = useRef(true)
  const leaveTimer = useRef(0)
  const userRef = useRef(user)
  useEffect(() => {
    userRef.current = user
  })

  useEffect(() => {
    const sync = () => {
      setText(getTextSize())
      setThemeState(getTheme())
    }
    window.addEventListener(PREFS_CHANGE_EVENT, sync)
    return () => window.removeEventListener(PREFS_CHANGE_EVENT, sync)
  }, [])

  useEffect(() => {
    mounted.current = true
    const onHash = () => setHash(location.hash)
    window.addEventListener('hashchange', onHash)
    return () => {
      mounted.current = false
      window.removeEventListener('hashchange', onHash)
      window.clearTimeout(leaveTimer.current)
    }
  }, [])

  const preview = import.meta.env.DEV ? parsePreview(hash) : { on: false, step: 'lang' as Screen }
  const skip = !preview.on && isSkipHash(hash, skipPages)
  const wanted: Screen | null = skip ? null : preview.on ? preview.step : startScreen({ loggedIn: Boolean(user), onboarded: isOnboarded() })
  // 사용자가 화면을 넘기기 전의 시작 화면(상태로 옮기지 않고 그때그때 계산한다)
  const synthetic = useMemo<Flow | null>(() => (wanted && !leaving ? { stack: [wanted], dir: 1 } : null), [wanted, leaving])
  const flow = flowState ?? synthetic

  // 내 정보 탭: "초기 설정 다시 하기"
  useEffect(() => {
    const onEvt = () => {
      writeKey(ONBOARDED_KEY, null)
      setProfile(parseProfile(read(PROFILE_KEY)))
      setPicked(read(PROFILE_KEY) ? parseProfile(read(PROFILE_KEY)).mobility : null)
      setFlow({ stack: [userRef.current ? 'mobility' : 'lang'], dir: 1 })
    }
    window.addEventListener(ONBOARDING_EVENT, onEvt)
    return () => window.removeEventListener(ONBOARDING_EVENT, onEvt)
  }, [])

  const top = flow ? flow.stack[flow.stack.length - 1] : null
  const goTo = useCallback(
    (s: Screen) =>
      setFlow((f) => {
        const b = f ?? synthetic
        return b ? { stack: [...b.stack, s], dir: 1 } : b
      }),
    [synthetic],
  )
  const back = useCallback(() => {
    setNotice(null)
    setFlow((f) => {
      const b = f ?? synthetic
      return b && b.stack.length > 1 ? { stack: b.stack.slice(0, -1), dir: -1 } : b
    })
  }, [synthetic])
  const resetTo = (stack: Screen[], dir: 1 | -1) => setFlow({ stack, dir })

  const finish = useCallback(() => {
    if (!preview.on) writeKey(ONBOARDED_KEY, '1')
    else location.hash = '#/'
    // 초기 설정을 마친 직후: 사용법 슬라이드가 이 신호를 받아 한 번 뜬다
    if (!preview.on) window.dispatchEvent(new Event(ONBOARDED_EVENT))
    setLeaving(true)
    window.clearTimeout(leaveTimer.current)
    leaveTimer.current = window.setTimeout(
      () => {
        if (!mounted.current) return
        setFlow(null)
        setLeaving(false)
      },
      prefersCalm() ? 160 : 460,
    )
  }, [preview.on])

  const fail = (text: string, code?: AuthCode) => {
    setNotice({ text, code })
    setShake((n) => n + 1)
  }

  const onAuthOk = () => {
    setBusy(false)
    setNotice(null)
    setPin('')
    setPin2('')
    const next = afterAuth(isOnboarded())
    if (next) resetTo([next], 1)
    else finish()
  }

  const submit = async (m: Mode, p: string) => {
    setBusy(true)
    const r = m === 'login' ? await logIn(cleanName(name), p) : await signUp(cleanName(name), p)
    if (!mounted.current) return
    if (r.ok) return onAuthOk()
    setBusy(false)
    if (r.code === 'taken') {
      setPin('')
      setPin2('')
      fail(authMessage('taken', m), 'taken')
      resetTo(['lang', 'choose', 'name'], -1)
      return
    }
    if (r.code === 'bad_input' && m === 'signup') {
      setPin('')
      setPin2('')
      fail(authMessage('bad_input', m), 'bad_input')
      resetTo(['lang', 'choose', 'name'], -1)
      return
    }
    if (m === 'login') setPin('')
    setPin2('')
    fail(authMessage(r.code, m), r.code)
  }

  const onPin = (v: string) => {
    setPin(v)
    setNotice(null)
    if (v.length === 4) {
      if (mode === 'login') window.setTimeout(() => void submit('login', v), 140)
      else window.setTimeout(() => goTo('confirm'), 160)
    }
  }
  const onPin2 = (v: string) => {
    setPin2(v)
    setNotice(null)
    if (v.length === 4) {
      window.setTimeout(() => {
        if (v === pin) void submit('signup', v)
        else {
          setPin2('')
          fail('비밀번호가 달라요. 한 번 더 눌러 주세요')
        }
      }, 140)
    }
  }

  const savePersona = (p: Profile) => {
    setProfile(p)
    if (!preview.on) {
      writeKey(PROFILE_KEY, JSON.stringify(p))
      savePrefs(toBenefitPrefs(p))
    }
  }
  const nextMobility = () => {
    const m = picked ?? 'skip'
    const p = { ...profile, mobility: m }
    savePersona(p)
    goTo('interests')
  }
  const toggleInterest = (c: BenefitCategory) => {
    setProfile((p) => ({ ...p, interests: p.interests.includes(c) ? p.interests.filter((x) => x !== c) : [...p.interests, c] }))
  }
  const nextInterests = () => {
    savePersona({ ...profile, mobility: picked ?? profile.mobility })
    goTo('view')
  }

  const pickLang = (l: Lang) => {
    setLangState(l)
    setLang(l)
  }

  // ───── 화면 ─────
  const render = (s: Screen) => {
    const live = s === top
    const foot = (node: ReactNode) => <div className="ob-foot">{node}</div>
    const next = (label: string, onClick: () => void, disabled = false) => (
      <PressButton type="button" className="ob-btn ob-btn-primary" onClick={onClick} disabled={disabled}>
        {label}
      </PressButton>
    )

    if (s === 'welcome') return <WelcomeScreen onStart={() => goTo(afterWelcome(isStandalone({ navStandalone: (navigator as Navigator & { standalone?: boolean }).standalone, matchMedia: (q) => window.matchMedia(q) })))} />

    if (s === 'device') {
      return (
        <>
          <div className="ob-body">
            <Title>어떤 폰을 쓰세요?</Title>
            <Sentences as="p" className="ob-sub">홈 화면에 추가하는 방법을 알려 드려요.</Sentences>
            <div className="ob-list" role="radiogroup" aria-label="폰 종류">
              {([['ios', '아이폰', 'Safari'], ['android', '갤럭시', '삼성 인터넷 · Chrome']] as const).map(([id, label, hint]) => (
                <PressButton key={id} type="button" role="radio" aria-checked={device === id} className={'ob-opt' + (device === id ? ' is-on' : '')} onClick={() => setDevice(id)}>
                  <span className="ob-opt-main">
                    <strong>{label}</strong>
                    <small>{hint}</small>
                  </span>
                  <span className="ob-radio" aria-hidden="true" />
                </PressButton>
              ))}
            </div>
            <button type="button" className="ob-link" onClick={() => { setDevice(null); goTo('lang') }}>
              건너뛰기
            </button>
          </div>
          {foot(next('다음', () => goTo(afterDevice(device)), !device))}
        </>
      )
    }

    if (s === 'install') {
      return (
        <>
          <div className="ob-body">
            <InstallGuide device={device ?? 'ios'} />
          </div>
          {foot(next('다음', () => goTo('lang')))}
        </>
      )
    }

    if (s === 'lang') {
      return (
        <>
          <div className="ob-body ob-hero">
            <h1 className="ob-greet" tabIndex={-1} aria-label="안녕하세요. Hello." ref={(el) => el?.focus({ preventScroll: true })}>
              {GREETS.map((g, i) => (
                <span key={g.text} className="ob-greet-w" lang={g.lang} aria-hidden="true" style={{ animationDelay: `${i * 3}s` }}>
                  {g.text}
                </span>
              ))}
            </h1>
            <Sentences as="p" className="ob-sub">언어를 골라 주세요. Choose your language.</Sentences>
            <div className="ob-list" role="radiogroup" aria-label="언어 Language">
              {([['ko', '한국어', '안내를 한국어로 볼게요'], ['en', 'English', 'Coming soon']] as const).map(([id, label, hint]) => (
                <PressButton key={id} type="button" role="radio" aria-checked={lang === id} className={'ob-opt' + (lang === id ? ' is-on' : '')} onClick={() => pickLang(id)}>
                  <span className="ob-opt-main">
                    <strong lang={id}>{label}</strong>
                    <small>{hint}</small>
                  </span>
                  <span className="ob-radio" aria-hidden="true" />
                </PressButton>
              ))}
            </div>
            {lang === 'en' && (
              <p className="ob-note" role="status">
                영어는 준비 중이에요. 지금은 한국어로 안내해요.
                <br />
                <Sentences as="span" lang="en">English is coming soon. For now, the app is in Korean.</Sentences>
              </p>
            )}
          </div>
          {foot(next('계속 · Continue', () => goTo('choose')))}
        </>
      )
    }

    if (s === 'choose') {
      return (
        <>
          <div className="ob-body">
            <Title>계정이 있으세요?</Title>
            <div className="ob-list">
              <PressButton type="button" className="ob-opt" onClick={() => { setMode('login'); setNotice(null); goTo('name') }}>
                <span className="ob-opt-main">
                  <strong>로그인</strong>
                  <small>만들어 둔 계정으로 들어가요</small>
                </span>
                <Icon name="chev" size={20} />
              </PressButton>
              <PressButton type="button" className="ob-opt" onClick={() => { setMode('signup'); setNotice(null); goTo('name') }}>
                <span className="ob-opt-main">
                  <strong>처음이에요</strong>
                  <small>이름과 숫자 4자리로 계정을 만들어요</small>
                </span>
                <Icon name="chev" size={20} />
              </PressButton>
            </div>
          </div>
        </>
      )
    }

    if (s === 'name') {
      const go = () => {
        if (!nameOk(name)) return
        setPin('')
        setPin2('')
        setNotice(null)
        goTo('pin')
      }
      return (
        <>
          <div className="ob-body">
            <Title>{mode === 'login' ? '이름을 입력해 주세요' : '어떻게 불러 드릴까요?'}</Title>
            <Sentences as="p" className="ob-sub">{mode === 'login' ? '계정을 만들 때 쓴 이름이에요.' : '한글 이름도 괜찮아요. 최대 20자예요.'}</Sentences>
            <label className="ob-field">
              <span className="ob-vh">이름</span>
              <input
                className="ob-input"
                type="text"
                value={name}
                maxLength={20}
                autoComplete="off"
                autoCapitalize="off"
                spellCheck={false}
                enterKeyHint="next"
                placeholder="이름"
                disabled={!live}
                onChange={(e) => { setName(e.target.value); setNotice(null) }}
                onKeyDown={(e) => { if (e.key === 'Enter' && !e.nativeEvent.isComposing) go() }}
              />
            </label>
            {notice && live && (
              <p className="ob-err" role="alert">
                {notice.text}
              </p>
            )}
            {notice?.code === 'taken' && live && (
              <button type="button" className="ob-link" onClick={() => { setMode('login'); setNotice(null) }}>
                로그인으로 바꾸기
              </button>
            )}
          </div>
          {foot(next('다음', go, !nameOk(name)))}
        </>
      )
    }

    if (s === 'pin' || s === 'confirm') {
      const second = s === 'confirm'
      const title = mode === 'login' ? '비밀번호 4자리를 눌러 주세요' : second ? '한 번 더 눌러 주세요' : '비밀번호 4자리를 정해 주세요'
      return (
        <div className="ob-body ob-padbody">
          <Title>{title}</Title>
          <Sentences as="p" className="ob-sub">{mode === 'signup' && !second ? '체험 계정이라 숫자 4자리면 돼요. 다른 곳에 쓰는 비밀번호는 넣지 마세요.' : (cleanName(name) ? `${cleanName(name)}님` : '')}</Sentences>
          <div className="ob-msg" role="alert" aria-live="assertive">
            {live && notice ? notice.text : ''}
          </div>
          {!accountConnected && live && <p className="ob-hint">계정 서버를 아직 연결하지 못했어요.</p>}
          <PinPad
            value={second ? pin2 : pin}
            onChange={second ? onPin2 : onPin}
            disabled={busy || !live}
            shake={live ? shake : 0}
            label={second ? '비밀번호 확인' : '비밀번호'}
          />
        </div>
      )
    }

    if (s === 'mobility') {
      return (
        <>
          <div className="ob-body">
            <Title>어떻게 이동하세요?</Title>
            <Sentences as="p" className="ob-sub">모두 선택 사항이에요. 알려 주시면 나에게 맞는 혜택을 먼저 보여 드려요.</Sentences>
            <div className="ob-list" role="radiogroup" aria-label="이동 방식">
              {MOBILITY_OPTIONS.map((o) => (
                <PressButton key={o.id} type="button" role="radio" aria-checked={picked === o.id} className={'ob-opt' + (picked === o.id ? ' is-on' : '')} onClick={() => setPicked(o.id)}>
                  <span className="ob-opt-main">
                    <strong>{o.label}</strong>
                    <small>{o.hint}</small>
                  </span>
                  <span className="ob-radio" aria-hidden="true" />
                </PressButton>
              ))}
            </div>
          </div>
          {foot(next(picked ? '다음' : '건너뛰기', nextMobility))}
        </>
      )
    }

    if (s === 'interests') {
      return (
        <>
          <div className="ob-body">
            <Title>관심 있는 분야를 골라 주세요</Title>
            <Sentences as="p" className="ob-sub">여러 개 골라도 돼요. 건너뛰어도 괜찮아요.</Sentences>
            <div className="ob-chips" role="group" aria-label="관심 분야">
              {CATEGORIES.map((c) => {
                const on = profile.interests.includes(c.id)
                return (
                  <PressButton key={c.id} type="button" aria-pressed={on} className={'ob-chip' + (on ? ' is-on' : '')} onClick={() => toggleInterest(c.id)}>
                    <span className="ob-chip-check" aria-hidden="true">
                      <m.span style={{ display: 'grid' }} initial={false} animate={{ scale: on ? 1 : 0.4 }} transition={SPRING.quick}>
                        <Icon name="check" size={16} />
                      </m.span>
                    </span>
                    {c.label}
                  </PressButton>
                )
              })}
            </div>
          </div>
          {foot(next(profile.interests.length ? '다음' : '건너뛰기', nextInterests))}
        </>
      )
    }

    if (s === 'view') {
      const seg = <T extends string>(label: string, value: T, opts: { id: T; label: string }[], on: (v: T) => void) => (
        <div className="ob-setrow">
          <span className="ob-setlabel" id={`ob-set-${label}`}>{label}</span>
          <div className="ob-seg" role="radiogroup" aria-labelledby={`ob-set-${label}`}>
            {opts.map((o) => (
              <PressButton key={o.id} type="button" role="radio" aria-checked={value === o.id} className={value === o.id ? 'is-on' : ''} onClick={() => on(o.id)}>
                {value === o.id && <SegBg group={`seg-ob-${label}`} />}
                {o.label}
              </PressButton>
            ))}
          </div>
        </div>
      )
      return (
        <>
          <div className="ob-body">
            <Title>보기 편하게 맞춰 볼까요?</Title>
            <Sentences as="p" className="ob-sub">바로 아래 카드에서 확인해 보세요. 나중에 바꿀 수 있어요.</Sentences>
            <div className="ob-preview" aria-label="미리 보기">
              <span className="ob-badge">접수</span>
              <strong>용봉동 보도 턱이 높아요</strong>
              <small>북구청에 전달했어요 · 오늘</small>
            </div>
            {seg<TextSize>('글자 크기', text, [{ id: 'normal', label: '보통' }, { id: 'large', label: '크게' }], (v) => { setText(v); setTextSize(v) })}
            {seg<ThemeMode>('화면', theme, [{ id: 'system', label: '시스템' }, { id: 'light', label: '라이트' }, { id: 'dark', label: '다크' }], (v) => { setThemeState(v); setTheme(v) })}
            {seg<'off' | 'on'>('움직임 줄이기', motion ? 'on' : 'off', [{ id: 'off', label: '끄기' }, { id: 'on', label: '켜기' }], (v) => { setMotion(v === 'on'); setMotionReduce(v === 'on') })}
          </div>
          {foot(next('다음', () => goTo('done')))}
        </>
      )
    }

    // done
    const who = user?.name ?? (preview.on ? '체험' : cleanName(name))
    return (
      <>
        <div className="ob-body ob-done">
          <div className="ob-ok" aria-hidden="true">
            <svg width="44" height="44" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" focusable="false">
              <path className="ob-ok-path" d="M5 12.5l4.5 4.5L19 7.5" />
            </svg>
          </div>
          <Title>{who ? `준비됐어요, ${who}님` : '준비됐어요'}</Title>
          <ul className="ob-feats">
            {[
              ['map', '지도에서 다니기 어려운 곳 보기', '경사로·턱·엘리베이터를 미리 알아봐요'],
              ['report', '문제 신고하기', '불편한 곳을 사진과 함께 알려요'],
              ['bell', '처리 결과 받아보기', '신고가 어디까지 처리됐는지 확인해요'],
            ].map(([ic, t1, t2], i) => (
              <li key={t1} className="ob-feat" style={{ animationDelay: `${160 + i * 90}ms` }}>
                <span className="ob-feat-ic"><Icon name={ic} size={22} /></span>
                <span>
                  <strong>{t1}</strong>
                  <small>{t2}</small>
                </span>
              </li>
            ))}
          </ul>
        </div>
        {foot(next('시작하기', finish))}
      </>
    )
  }

  const showOverlay = !skip && (Boolean(flow) || leaving)
  const canBack = Boolean(flow && flow.stack.length > 1) && top !== 'done'
  const dot = top ? dotIndex(top) : -1

  return (
    <>
      <div style={{ display: 'contents' }} inert={showOverlay && !leaving}>
        {children}
      </div>
      {showOverlay && (
        <div className={'ob-root' + (leaving ? ' is-leaving' : '')} role="dialog" aria-modal="true" aria-label="초기 설정">
          {flow && top && (
            <>
              <header className="ob-head">
                <button type="button" className="ob-back" onClick={back} aria-label="뒤로" style={{ visibility: canBack ? 'visible' : 'hidden' }} tabIndex={canBack ? 0 : -1}>
                  <Icon name="chevL" size={24} />
                </button>
                <div className="ob-prog" role="img" aria-label={dot >= 0 ? `${DOT_COUNT}단계 중 ${dot + 1}단계` : '완료'} style={{ opacity: dot >= 0 ? 1 : 0 }}>
                  {Array.from({ length: DOT_COUNT }, (_, i) => (
                    <m.span key={i} layout transition={SPRING.quick} style={{ borderRadius: 99 }} className={'ob-pd' + (i === dot ? ' is-cur' : i < dot ? ' is-done' : '')} />
                  ))}
                </div>
                <span className="ob-back-sp" />
              </header>
              <Stage screen={top} dir={flow.dir} render={render} />
            </>
          )}
        </div>
      )}
    </>
  )
}
