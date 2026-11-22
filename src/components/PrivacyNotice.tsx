import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { sheetHost } from '../lib/sheetHost'
import Icon from './Icon'
import SheetHandle from './SheetHandle'

// 개인정보 처리 안내. 내용은 worker 코드와 맞춘다(2026-11-22 확인):
//  - 계정: worker/migrations/0001(users: 이름, PIN 해시·salt), account.ts·auth.ts(로그인 유지 SESSION_DAYS=30)
//  - 접속·기기·오류 기록: worker/src/activity.ts(KEEP_MS 30일, DEVICE_KEEP_MS 90일, IP는 읽지도 저장하지도 않음)
//  - 접속 지역: 동의했을 때만(activity.ts place), 동의를 거두면 account.ts가 지움
//  - 제보·사진: reports·photos 테이블, 지우는 기간 규칙 없음(운영자 삭제 admin.ts)
export const PRIVACY_ITEMS: { title: string; what: string; why: string; keep: string }[] = [
  { title: '계정', what: '이름, 비밀번호 숫자 4자리(암호화해 저장)', why: '로그인하고 내 제보를 알아보려고요', keep: '계정이 있는 동안. 로그인은 30일 유지돼요' },
  { title: '접속 기록', what: '접속 시각, 앱 버전, 화면 크기, 기기·운영체제·브라우저 종류, 앱 오류', why: '앱이 잘 열리는지 확인하려고요', keep: '30일 (기기 요약은 마지막 접속 뒤 90일). IP 주소는 저장하지 않아요' },
  { title: '접속 지역', what: '동의한 경우에만 대략적인 도시', why: '접속을 확인하려고요', keep: '접속 기록과 같아요. 설정에서 끄면 바로 지워져요' },
  { title: '제보와 사진', what: '제보 내용, 위치, 사진', why: '이웃이 확인하고 길 안내에 쓰려고요', keep: '지우기 전까지. 다른 이용자에게도 보여요' },
]

// 설정 시트의 한 줄(눌러서 안내 시트를 연다)
export default function PrivacyNotice() {
  const [open, setOpen] = useState(false)
  useEffect(() => {
    if (!open) return
    const k = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    window.addEventListener('keydown', k)
    return () => window.removeEventListener('keydown', k)
  }, [open])
  return (
    <li>
      <span>개인정보 처리 안내<small>무엇을 모으고 얼마나 보관하는지 알려 드려요</small></span>
      <button type="button" className="hm-tool hm-tool-row" aria-label="개인정보 처리 안내 열기" aria-haspopup="dialog" onClick={() => setOpen(true)}>
        <Icon name="chev" size={18} />
      </button>
      {open &&
        createPortal(
          <>
            <div className="ms-dim" onClick={() => setOpen(false)} />
            <div className="ms pv-sheet" data-sheet role="dialog" aria-modal="true" aria-label="개인정보 처리 안내">
              <SheetHandle onDown={() => setOpen(false)} />
              <div className="ms-head">
                <div>
                  <h2>개인정보 처리 안내</h2>
                </div>
                <button type="button" className="bm-close" onClick={() => setOpen(false)}>
                  닫기
                </button>
              </div>
              <dl className="pv-list">
                {PRIVACY_ITEMS.map((it) => (
                  <div key={it.title} className="pv-item">
                    <dt>{it.title}</dt>
                    <dd>{it.what}</dd>
                    <dd className="pv-sub">목적: {it.why}</dd>
                    <dd className="pv-sub">보관: {it.keep}</dd>
                  </div>
                ))}
              </dl>
              <p className="bm-meta">동의는 설정의 「접속 지역 기록」 스위치로 언제든 거둘 수 있어요.</p>
            </div>
          </>,
          sheetHost(),
        )}
    </li>
  )
}
