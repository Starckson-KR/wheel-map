// 크리스마스 모드의 홈 선물 상자: 오른쪽 아래에서 살짝 흔들리다가, 누르면 뚜껑이 열리며 빛·색종이·불꽃이 터지고 「메리 크리스마스!」가 뜬다.
// 이 터치가 소리의 첫 터치다(캐럴 한 번 + 화음, 안드로이드는 진동). 열린 뒤 몇 초 지나거나 한 번 더 누르면 사라진다. 한 번만 뜬다.
// 상자만 눌리고 나머지 화면은 그대로 쓸 수 있다(효과 층은 pointer-events 없음). 움직임 줄이기에서는 열린 상자 그림과 문구만 보인다.
import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { prefersCalm } from '../lib/viewPrefs'
import { haptic } from '../lib/haptic'
import { autoSong, fanfare } from '../lib/xmasAudio'
import { createFx, type Fx } from './xmasFx'
import { XMAS_MSG } from '../lib/xmasFont'
import '../styles/xmas.css'

const MSG = XMAS_MSG
const WAIT_MS = 45_000 // 안 누르면 이 뒤에 조용히 사라진다
const SHOW_MS = 6_500 // 열린 뒤 보여 주는 시간

export default function XmasGift({ onDone }: { onDone: () => void }) {
  const [calm] = useState(prefersCalm)
  const [open, setOpen] = useState(calm)
  const [leaving, setLeaving] = useState(false)
  const boxRef = useRef<HTMLButtonElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const fxRef = useRef<Fx | null>(null)
  const done = useRef(onDone)
  useEffect(() => {
    done.current = onDone
  })

  useEffect(() => {
    const c = canvasRef.current
    if (!c || calm) return
    const fx = createFx(c)
    fxRef.current = fx
    return () => fx?.destroy()
  }, [calm])

  const leave = () => {
    if (leaving) return
    setLeaving(true)
    window.setTimeout(() => done.current(), calm ? 0 : 400)
  }
  // 안 누르면 한참 뒤에, 열렸으면 몇 초 뒤에 사라진다
  useEffect(() => {
    const t = window.setTimeout(leave, open ? (calm ? 9_000 : SHOW_MS) : WAIT_MS)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  const onTap = () => {
    if (open) return leave()
    setOpen(true)
    autoSong()
    fanfare()
    haptic('success')
    const fx = fxRef.current
    const r = boxRef.current?.getBoundingClientRect()
    if (!fx || !r) return
    const x = r.left + r.width / 2
    const y = r.top + r.height * 0.3
    const W = window.innerWidth
    const H = window.innerHeight
    fx.ring(x, y, '#fff3c4', 200)
    fx.confetti(x, y, 150)
    fx.sparkle(x, y, 30)
    fx.snow(true)
    const shots: [number, number, number, boolean][] = [
      [180, 0.5, 0.2, true],
      [420, 0.2, 0.3, false],
      [640, 0.8, 0.26, false],
      [980, 0.35, 0.14, true],
      [1400, 0.68, 0.4, false],
      [2100, 0.5, 0.24, true],
    ]
    for (const [ms, px, py, big] of shots) window.setTimeout(() => fx.firework(W * px, H * py, big), ms)
    window.setTimeout(() => fx.confetti(W * 0.5, H * 0.45, 60), 520)
    window.setTimeout(() => fx.snow(false), SHOW_MS - 1500)
  }

  return (
    <>
      <div className={'xg' + (open ? ' open' : '') + (leaving ? ' leaving' : '')}>
        {!open && (
          <span className="xg-tip" aria-hidden="true">
            눌러 보세요
          </span>
        )}
        <button type="button" className="xg-box" ref={boxRef} aria-label={open ? '선물 상자 닫기' : '선물 상자 열기'} onClick={onTap}>
          <svg viewBox="0 0 84 84" aria-hidden="true" focusable="false">
            <path className="xg-shine" d="M22 36L4 -30h76L62 36Z" fill="#ffe9a8" opacity={0.55} />
            <g className="xg-body">
              <rect x={10} y={34} width={64} height={46} rx={5} fill="#d0342c" />
              <rect x={10} y={34} width={64} height={9} fill="#a9241c" opacity={0.55} />
              <rect x={36} y={34} width={12} height={46} fill="#f2b632" />
            </g>
            <g className="xg-lid">
              <rect x={5} y={20} width={74} height={17} rx={5} fill="#e0463c" />
              <rect x={35} y={20} width={14} height={17} fill="#f2b632" />
              <path d="M42 20C34 6 18 6 20 14c1 6 14 7 22 6Zm0 0C50 6 66 6 64 14c-1 6-14 7-22 6Z" fill="#f2b632" />
              <circle cx={42} cy={19} r={4.5} fill="#d99a14" />
            </g>
          </svg>
        </button>
      </div>
      {createPortal(
        <>
          {!calm && <canvas className="xg-fx" ref={canvasRef} aria-hidden="true" />}
          <div className={'xg-msg' + (leaving ? ' leaving' : '')} role="status" aria-live="polite">
            {open && (
              <p aria-label={MSG}>
                {[...MSG].map((ch, i) => (
                  <span key={i} aria-hidden="true" style={{ animationDelay: `${i * 90}ms` }}>
                    {ch === ' ' ? ' ' : ch}
                  </span>
                ))}
              </p>
            )}
          </div>
        </>,
        document.body,
      )}
    </>
  )
}
