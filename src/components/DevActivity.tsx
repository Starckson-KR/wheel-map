import { useEffect, useState } from 'react'
import { loadActivity } from '../lib/account/admin'
import type { AdminActivity, AdminDevice, AdminError, AdminUser } from '../lib/account/admin'
import { isDevBuild } from '../lib/updateCheck'
import { toast } from '../lib/uiStore'
import '../styles/activity.css'

declare const __BUILD_HASH__: string

// 개발자 관리 > 계정 > 사용자 상세: 기기 / 접속 기록 / 최근 오류, 그리고 지금 접속 중인지. 읽기 전용이다.
const KIND: Record<string, string> = { open: '열기', resume: '다시 접속', login: '로그인', signup: '가입' }

const kstFmt = new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false })
const kstDay = new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit' })
/** 한국 시간 「11.17 15:02」 */
export function kst(ms: number): string {
  const p = Object.fromEntries(kstFmt.formatToParts(new Date(ms)).map((x) => [x.type, x.value]))
  return `${p.month}.${p.day} ${p.hour === '24' ? '00' : p.hour}:${p.minute}`
}
const kstDate = (ms: number) => kstDay.format(new Date(ms)).replace(/\.\s*/g, '.').replace(/\.$/, '')

const tail = (id: string) => id.slice(-4)
const isOld = (build: string) => !isDevBuild(__BUILD_HASH__) && build !== __BUILD_HASH__

function errorText(e: AdminError): string {
  const who = [e.device, e.os, e.browser].filter(Boolean).join(' · ')
  return [`[${kst(e.at)} 한국 시간] ${e.message}`, `화면: ${e.route || '-'}`, `빌드: ${e.build}${isOld(e.build) ? ' (옛 버전)' : ''}`, `기기: ${who || '-'} (#${tail(e.deviceId)})`, '', e.stack || '(스택 없음)'].join('\n')
}

async function copy(text: string) {
  try {
    await navigator.clipboard.writeText(text)
    toast('오류 내용을 복사했어요.')
  } catch {
    toast('복사하지 못했어요.')
  }
}

function DeviceRow({ d }: { d: AdminDevice }) {
  return (
    <li className="dv-act-row">
      <div className="dv-main">
        <strong>
          {d.device}
          {isOld(d.build) && <span className="dv-old">옛 버전</span>}
        </strong>
        <small>
          {d.os} · {d.browser}
        </small>
        <small>
          빌드 {d.build}
          {d.standalone ? ' · 홈 화면 앱' : ''} · {d.screen}
        </small>
        <small>
          처음 {kstDate(d.firstAt)} · 마지막 {kst(d.lastAt)} · {d.count}회 · #{tail(d.deviceId)}
        </small>
      </div>
    </li>
  )
}

export default function DevActivity({ user, onBack }: { user: AdminUser; onBack: () => void }) {
  const [data, setData] = useState<AdminActivity | null>(null)
  const [err, setErr] = useState('')
  const [stamp, setStamp] = useState(0)
  useEffect(() => {
    let alive = true
    void loadActivity(user.id).then((r) => {
      if (!alive) return
      if (r.ok) {
        setData(r.value)
        setErr('')
      } else setErr(r.message)
    })
    return () => {
      alive = false
    }
  }, [user.id, stamp])

  return (
    <>
      <div className="dv-act-head">
        <button type="button" className="dv-back" onClick={onBack}>
          목록
        </button>
        <h3>{user.name}</h3>
        <button type="button" className="dv-back" onClick={() => setStamp((n) => n + 1)}>
          새로고침
        </button>
      </div>
      {data && data.online !== null && <p className={data.online > 0 ? 'dv-live on' : 'dv-live'}>{data.online > 0 ? `지금 접속 중 · ${data.online}대` : '지금 접속 중 아님'}</p>}
      {err && (
        <p className="rf-notice" role="alert">
          {err}
        </p>
      )}
      {data && (
        <>
          <h4 className="dv-sec">기기 {data.devices.length}</h4>
          {data.devices.length === 0 ? <p className="dv-empty">기록이 없어요.</p> : <ul className="dv-list">{data.devices.map((d) => <DeviceRow key={d.deviceId} d={d} />)}</ul>}
          <h4 className="dv-sec">접속 기록</h4>
          {data.visits.length === 0 ? (
            <p className="dv-empty">기록이 없어요.</p>
          ) : (
            <ul className="dv-list">
              {data.visits.map((v, i) => (
                <li key={`${v.at}-${i}`} className="dv-act-row">
                  <div className="dv-main">
                    <strong>
                      {kst(v.at)} · {KIND[v.kind] ?? v.kind}
                    </strong>
                    <small>
                      {v.device} · {v.os} · {v.browser}
                    </small>
                    <small>
                      빌드 {v.build}
                      {isOld(v.build) ? ' (옛 버전)' : ''}
                      {v.standalone ? ' · 홈 화면 앱' : ''} · {v.screen} · #{tail(v.deviceId)}
                    </small>
                  </div>
                </li>
              ))}
            </ul>
          )}
          <h4 className="dv-sec">최근 오류</h4>
          {data.errors.length === 0 ? (
            <p className="dv-empty">오류가 없어요.</p>
          ) : (
            <ul className="dv-list">
              {data.errors.map((e, i) => (
                <li key={`${e.at}-${i}`} className="dv-act-row">
                  <button type="button" className="dv-open dv-err" onClick={() => void copy(errorText(e))} aria-label="오류 내용 복사">
                    <span className="dv-main">
                      <strong>{e.message}</strong>
                      <small>
                        {kst(e.at)} · {e.route || '-'} · 빌드 {e.build}
                        {isOld(e.build) ? ' (옛 버전)' : ''}
                      </small>
                      <small>
                        {[e.device, e.os, e.browser].filter(Boolean).join(' · ') || '기기 정보 없음'} · #{tail(e.deviceId)} · 눌러서 복사
                      </small>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </>
  )
}
