// 처음 들어온 사람에게 뜨는 게이트: 환영 → 이름(가입 기본, 링크로 로그인 전환) → 비밀번호(가입은 한 번 더) → 바로 앱.
// 로그인돼 있으면 뜨지 않는다. 이동 방식·관심·보기(내 정보 「초기 설정 다시 하기」)와 홈 화면 추가 안내(홈의 띠·내 정보)는 앱 안에서 이벤트로 연다.
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
import { guessDevice, type Device } from './installEnv'
import Stage from './Stage'
import { accountConnected, logIn, signUp, useGateAccount } from './accountAdapter'
import {
  DOT_COUNT, INSTALL_EVENT, MOBILITY_OPTIONS, afterWelcome, installStart, ONBOARDED_KEY, ONBOARDING_EVENT, PROFILE_KEY, afterAuth, authMessage, cleanName, dotIndex, isSkipHash, nameOk, nameHint, NAME_MAX,
  parsePreview, parseProfile, startScreen, toBenefitPrefs, type AuthCode, type Mobility, type Profile, type Screen,
} from './flow'
import { CATEGORIES, savePrefs, type BenefitCategory } from '../../lib/benefits'
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
  const [profile, setProfile] = useState<Profile>(() => parseProfile(read(PROFILE_KEY)))
  const [device, setDevice] = useState<Device | null>(() => guessDevice(navigator.userAgent))
  const [picked, setPicked] = useState<Mobility | null>(() => (read(PROFILE_KEY) ? parseProfile(read(PROFILE_KEY)).mobility : null))
  const [text, setText] = useState<TextSize>(getTextSize)
  const [theme, setThemeState] = useState<ThemeMode>(getTheme)
  const [motion, setMotion] = useState(getMotionReduce)
  const mounted = useRef(true)
  const leaveTimer = useRef(0)
  // 앱 안에서 연 화면(설정 다시 하기·홈 화면 추가 안내): 첫 화면의 뒤로가 닫기가 된다
  const [aux, setAux] = useState(false)
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

  const preview = import.meta.env.DEV ? parsePreview(hash) : { on: false, step: 'name' as Screen }
  const skip = !preview.on && isSkipHash(hash, skipPages)
  const wanted: Screen | null = skip ? null : preview.on ? preview.step : startScreen({ loggedIn: Boolean(user), onboarded: isOnboarded() })
  // 사용자가 화면을 넘기기 전의 시작 화면(상태로 옮기지 않고 그때그때 계산한다)
  const synthetic = useMemo<Flow | null>(() => (wanted && !leaving ? { stack: [wanted], dir: 1 } : null), [wanted, leaving])
  const flow = flowState ?? synthetic

  // 내 정보 탭: "초기 설정 다시 하기"(이동 방식 → 관심 → 보기), 홈의 띠·내 정보: "홈 화면에 추가"
  useEffect(() => {
    const onEvt = () => {
      if (!userRef.current) return
      setProfile(parseProfile(read(PROFILE_KEY)))
      setPicked(read(PROFILE_KEY) ? parseProfile(read(PROFILE_KEY)).mobility : null)
      setAux(true)
      setFlow({ stack: ['mobility'], dir: 1 })
    }
    const onInstall = () => {
      const d = guessDevice(navigator.userAgent)
      setDevice(d)
      setAux(true)
      setFlow({ stack: [installStart(d)], dir: 1 })
    }
    window.addEventListener(ONBOARDING_EVENT, onEvt)
    window.addEventListener(INSTALL_EVENT, onInstall)
    return () => {
      window.removeEventListener(ONBOARDING_EVENT, onEvt)
      window.removeEventListener(INSTALL_EVENT, onInstall)
    }
  }, [])

  // 예전 흐름에서 가입만 하고 설정 화면 중간에 나간 기기: 이제 설정 화면이 없으니 마친 것으로 적는다
  useEffect(() => {
    if (!user || preview.on || isOnboarded()) return
    writeKey(ONBOARDED_KEY, '1')
    window.dispatchEvent(new Event(ONBOARDED_EVENT))
  }, [user, preview.on])

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

  // 덮개를 내린다(저장 없음)
  const close = useCallback(() => {
    if (preview.on) location.hash = '#/'
    setLeaving(true)
    window.clearTimeout(leaveTimer.current)
    leaveTimer.current = window.setTimeout(
      () => {
        if (!mounted.current) return
        setFlow(null)
        setAux(false)
        setLeaving(false)
      },
      prefersCalm() ? 160 : 460,
    )
  }, [preview.on])

  const finish = useCallback(() => {
    if (!preview.on) {
      writeKey(ONBOARDED_KEY, '1')
      // 가입·로그인을 마친 직후: 사용법 슬라이드가 이 신호를 받아 한 번 뜬다
      window.dispatchEvent(new Event(ONBOARDED_EVENT))
    }
    close()
  }, [preview.on, close])

  const fail = (text: string, code?: AuthCode) => {
    setNotice({ text, code })
    setShake((n) => n + 1)
  }

  const onAuthOk = () => {
    setBusy(false)
    setNotice(null)
    setPin('')
    setPin2('')
    const next = afterAuth()
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
      resetTo(['welcome', 'name'], -1)
      return
    }
    if (r.code === 'bad_input' && m === 'signup') {
      setPin('')
      setPin2('')
      fail(authMessage('bad_input', m), 'bad_input')
      resetTo(['welcome', 'name'], -1)
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

  // ───── 화면 ─────
  const render = (s: Screen) => {
    const live = s === top
    const foot = (node: ReactNode) => <div className="ob-foot">{node}</div>
    const next = (label: string, onClick: () => void, disabled = false) => (
      <PressButton type="button" className="ob-btn ob-btn-primary" onClick={onClick} disabled={disabled}>
        {label}
      </PressButton>
    )

    if (s === 'welcome') return <WelcomeScreen onStart={() => goTo(afterWelcome())} />

    if (s === 'device') {
      return (
        <>
          <div className="ob-body">
            <Title>어떤 폰을 쓰세요?</Title>
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
          </div>
          {foot(next('다음', () => goTo('install'), !device))}
        </>
      )
    }

    if (s === 'install') {
      return (
        <>
          <div className="ob-body">
            <InstallGuide device={device ?? 'ios'} />
          </div>
          {foot(next('닫기', close))}
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
            <Sentences as="p" className="ob-sub">{mode === 'login' ? '' : '한글·영문·숫자 10자까지 쓸 수 있어요.'}</Sentences>
            <label className="ob-field">
              <span className="ob-vh">이름</span>
              <input
                className="ob-input"
                type="text"
                value={name}
                maxLength={NAME_MAX}
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
            {!notice && live && nameHint(name) && (
              <p className="ob-err" role="alert">
                {nameHint(name)}
              </p>
            )}
            <button type="button" className="ob-link" disabled={!live} onClick={() => { setMode(mode === 'login' ? 'signup' : 'login'); setNotice(null) }}>
              {mode === 'login' ? '처음이에요' : '이미 계정이 있어요'}
            </button>
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
          <Sentences as="p" className="ob-sub">{mode === 'signup' && !second ? '다른 곳에 쓰는 비밀번호는 넣지 마세요.' : (cleanName(name) ? `${cleanName(name)}님` : '')}</Sentences>
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
            <Sentences as="p" className="ob-sub">나에게 맞는 혜택을 먼저 보여 드려요.</Sentences>
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
            <Sentences as="p" className="ob-sub">여러 개 골라도 돼요.</Sentences>
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
            <div className="ob-preview" aria-label="미리 보기">
              <span className="ob-badge">접수</span>
              <strong>용봉동 보도 턱이 높아요</strong>
              <small>북구청에 전달했어요 · 오늘</small>
            </div>
            {seg<TextSize>('글자 크기', text, [{ id: 'normal', label: '보통' }, { id: 'large', label: '크게' }], (v) => { setText(v); setTextSize(v) })}
            {seg<ThemeMode>('화면', theme, [{ id: 'system', label: '시스템' }, { id: 'light', label: '라이트' }, { id: 'dark', label: '다크' }], (v) => { setThemeState(v); setTheme(v) })}
            {seg<'off' | 'on'>('움직임 줄이기', motion ? 'on' : 'off', [{ id: 'off', label: '끄기' }, { id: 'on', label: '켜기' }], (v) => { setMotion(v === 'on'); setMotionReduce(v === 'on') })}
          </div>
          {foot(next('완료', finish))}
        </>
      )
    }

    return null
  }

  const showOverlay = !skip && (Boolean(flow) || leaving)
  const deep = Boolean(flow && flow.stack.length > 1)
  const canBack = deep || aux
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
                <button type="button" className="ob-back" onClick={deep ? back : close} aria-label={deep ? '뒤로' : '닫기'} style={{ visibility: canBack ? 'visible' : 'hidden' }} tabIndex={canBack ? 0 : -1}>
                  <Icon name="chevL" size={24} />
                </button>
                <div className="ob-prog" role="img" aria-label={dot >= 0 ? `${DOT_COUNT}단계 중 ${dot + 1}단계` : undefined} aria-hidden={dot < 0 || undefined} style={{ opacity: dot >= 0 ? 1 : 0 }}>
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
