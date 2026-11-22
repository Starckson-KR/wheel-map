import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties, KeyboardEvent as ReactKeyboardEvent } from 'react'
import { animate, m, useMotionValue, useTransform } from 'motion/react'
import { useDragCommit } from './useDragCommit'
import { canVote } from '../lib/config'
import { coordText, useAddress } from '../lib/addressCache'
import { haptic } from '../lib/haptic'
import { SPRING } from '../lib/motionTokens'
import { DEMO_USERS, useReports } from '../lib/reportStore'
import { snack, toast } from '../lib/uiStore'
import { usePhotoUrls } from '../lib/usePhotoUrls'
import { prefersCalm } from '../lib/viewPrefs'
import { REQUIRE_VIEW_BEFORE_VOTE, TILT_MAX_DEG, cardTilt, deckEnabled, deckReports, stampLevel, stampSide } from '../lib/verifyDeck'
import type { Report } from '../types'
import '../styles/interact-verify.css'

function CardBody({ r, shown }: { r: Report; shown: boolean }) {
  const { urls } = usePhotoUrls(shown ? r.photos.slice(0, 1) : [])
  const a = useAddress(r.lat, r.lng, shown)
  const place = !shown ? '' : a.full ? `${a.full} 부근` : a.status === 'loading' ? '주소를 찾고 있어요…' : coordText(r.lat, r.lng)
  return (
    <>
      <div className="vd-photo">
        {urls[0] ? (
          <img src={urls[0]} alt={`제보 사진 (${r.type})`} draggable={false} />
        ) : (
          <span className="vd-nophoto" aria-hidden={!shown}>
            {shown ? (r.photos.length > 0 ? '사진을 불러오고 있어요' : '사진이 없는 제보예요') : '사진·위치 보기를 눌러 주세요'}
          </span>
        )}
        {r.photos.length > 1 && shown && <span className="vd-count">사진 {r.photos.length}장</span>}
      </div>
      <div className="vd-info">
        <strong>{r.type}</strong>
        <span className="vd-place">{place || '위치는 사진·위치 보기 뒤에 보여요'}</span>
        <span className="vd-desc">{r.description}</span>
        <span className="bm-meta">이웃 제보</span>
      </div>
    </>
  )
}

/** 이웃의 제보를 카드로 넘겨 확인한다. 오른쪽 = 현장이 맞아요, 왼쪽 = 넘기기. 같은 일을 하는 버튼이 아래에 항상 있다. */
export default function VerifyDeck() {
  const reports = useReports((s) => s.reports)
  const userId = useReports((s) => s.userId)
  const vote = useReports((s) => s.vote)
  const me = DEMO_USERS.find((u) => u.id === userId) ?? DEMO_USERS[0]
  const [skipped, setSkipped] = useState<ReadonlySet<string>>(new Set())
  const [viewed, setViewed] = useState<ReadonlySet<string>>(new Set())
  const [live, setLive] = useState('')
  const list = useMemo(() => deckReports(reports, me, skipped), [reports, me, skipped])
  const top = list[0]
  const next = list[1]
  const enabled = !!top && deckEnabled(viewed.has(top.id))
  const shown = !!top && (!REQUIRE_VIEW_BEFORE_VOTE || viewed.has(top.id))

  const cardRef = useRef<HTMLDivElement>(null)
  const x = useMotionValue(0)
  const rotate = useTransform(x, (v) => cardTilt(v, cardRef.current?.offsetWidth ?? 300))
  const [dx, setDx] = useState(0)
  const [busy, setBusy] = useState(false)
  const width = () => cardRef.current?.offsetWidth ?? 300

  const back = useCallback(() => {
    setDx(0)
    if (prefersCalm()) x.set(0)
    else animate(x, 0, SPRING.screen)
  }, [x])

  const fly = useCallback(
    (dir: -1 | 1, done: () => void) => {
      setBusy(true)
      const finish = () => {
        done() // 자리 되돌리기는 카드가 바뀐 뒤 아래 effect가 한다(날아간 카드가 한 프레임 되돌아오지 않게)
        setBusy(false)
      }
      if (prefersCalm()) finish()
      else animate(x, dir * (width() + 160), SPRING.screen).then(finish)
    },
    [x],
  )

  const doVote = useCallback(
    (dir: -1 | 1 = 1) => {
      if (!top || busy) return
      if (!deckEnabled(viewed.has(top.id))) {
        haptic('warn')
        toast('사진과 위치를 먼저 확인해 주세요.')
        back()
        return
      }
      const before = top
      const res = vote(top.id)
      if (!res.ok) {
        haptic('warn')
        toast(res.message ?? '확인하지 못했어요.')
        back()
        return
      }
      haptic('success')
      setLive(`${before.type} 제보를 확인했어요.`)
      fly(dir, () => {
        snack('확인했어요', () => useReports.setState((s) => ({ reports: s.reports.map((q) => (q.id === before.id ? before : q)) })))
      })
    },
    [top, busy, viewed, vote, back, fly],
  )

  const doSkip = useCallback(
    (dir: -1 | 1 = -1) => {
      if (!top || busy) return
      if (!deckEnabled(viewed.has(top.id))) {
        haptic('warn')
        toast('사진과 위치를 먼저 확인해 주세요.')
        back()
        return
      }
      const id = top.id
      haptic('tick')
      setLive('다음 제보로 넘겼어요.')
      fly(dir, () => {
        setSkipped((s) => new Set(s).add(id))
        snack('넘겼어요', () =>
          setSkipped((s) => {
            const n = new Set(s)
            n.delete(id)
            return n
          }),
        )
      })
    },
    [top, busy, viewed, back, fly],
  )

  // 끌기: 가로로 판정되면 카드가 따라오고, 기준을 넘기면 확정한다.
  const dragApi = useDragCommit({
    onDrag: (d) => {
      if (busy) return
      x.set(d)
      setDx(d)
    },
    onCommit: (dir) => (dir === 1 ? doVote(1) : doSkip(-1)),
    onCancel: back,
    getWidth: width,
  })

  // 카드가 바뀌면 처음 자리에서
  useEffect(() => {
    x.set(0)
    setDx(0)
  }, [top?.id, x])

  const onKey = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'ArrowRight') {
      e.preventDefault()
      doVote(1)
    } else if (e.key === 'ArrowLeft') {
      e.preventDefault()
      doSkip(-1)
    }
  }

  if (!canVote() || me.role !== 'citizen') return null

  const level = stampLevel(dx, width())
  const side = stampSide(dx)
  const hadSkipped = skipped.size > 0

  return (
    <section className="pg-card vd" id="pg-verify" aria-label="이웃 제보 확인하기">
      <h2>이웃 제보 확인하기</h2>
      {top ? (
        <>
          <p className="bm-meta">
            확인할 제보 {list.length}건 · 오른쪽으로 넘기면 맞아요, 왼쪽은 넘기기
          </p>
          <div className="vd-stack">
            {next && (
              <div className="vd-card vd-under" aria-hidden="true">
                <span className="vd-under-t">{next.type}</span>
              </div>
            )}
            <m.div
              key={top.id}
              ref={cardRef}
              className="vd-card vd-top"
              style={{ x, rotate: prefersCalm() ? 0 : rotate, '--tilt': `${TILT_MAX_DEG}deg` } as unknown as CSSProperties}
              initial={prefersCalm() ? { opacity: 0 } : { opacity: 0, scale: 0.96, y: 10 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              transition={SPRING.screen}
              tabIndex={0}
              role="group"
              aria-roledescription="넘기는 카드"
              aria-label={`${top.type} 제보 확인. 오른쪽 화살표는 맞아요, 왼쪽 화살표는 넘기기`}
              onKeyDown={onKey}
              {...dragApi}
            >
              <CardBody r={top} shown={shown} />
              {REQUIRE_VIEW_BEFORE_VOTE && !viewed.has(top.id) && (
                <button type="button" className="vd-view" onClick={() => setViewed((s) => new Set(s).add(top.id))}>
                  사진·위치 보기
                </button>
              )}
              <span className={'vd-stamp vd-stamp-yes' + (side === 'yes' ? ' on' : '')} style={{ opacity: side === 'yes' ? level : 0 }} aria-hidden="true">
                맞아요
              </span>
              <span className={'vd-stamp vd-stamp-skip' + (side === 'skip' ? ' on' : '')} style={{ opacity: side === 'skip' ? level : 0 }} aria-hidden="true">
                넘기기
              </span>
            </m.div>
          </div>
          <div className="vd-btns">
            <button type="button" className="vd-skip" disabled={!enabled || busy} onClick={() => doSkip(-1)}>
              넘기기
            </button>
            <button type="button" className="vd-yes" disabled={!enabled || busy} onClick={() => doVote(1)}>
              현장이 맞아요
            </button>
          </div>
        </>
      ) : (
        <div className="vd-empty">
          <p>{hadSkipped ? '넘긴 제보만 남았어요' : '지금 확인할 제보가 없어요'}</p>
          {hadSkipped && (
            <button type="button" onClick={() => setSkipped(new Set())}>
              넘긴 제보 다시 보기
            </button>
          )}
        </div>
      )}
      <span className="vd-live" role="status" aria-live="polite">
        {live}
      </span>
    </section>
  )
}
