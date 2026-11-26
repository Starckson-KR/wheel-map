import Celebration from './Celebration'
import { haptic } from '../lib/haptic'
import { m } from 'motion/react'
import { SPRING, TAP } from '../lib/motionTokens'
import { useEffect, useMemo, useRef, useState } from 'react'
import { PHOTO_MAX_COUNT, TEMP_VALID_HOURS, VOTES_REQUIRED } from '../lib/config'
import { coordText, useAddress } from '../lib/addressCache'
import { SAMPLE_SCENES, markSampleReport, sampleBlob, type SampleSceneId } from '../lib/samplePhotos'
import { go as navGo } from '../lib/nav'
import { findDuplicates } from '../lib/duplicates'
import { reportNo } from '../lib/externalStatus'
import { copyNo } from '../lib/copyNo'
import { OTHER_KIND, OTHER_KIND_MAX, REPORT_LOCATION_CHOICES, composeKind } from '../lib/agencyGuide'
import { resizeImage, savePhoto } from '../lib/photoStore'
import { REPORT_TYPES } from '../lib/reportTypes'
import { newReportId, nowMs, useReports } from '../lib/reportStore'
import type { Barrier } from '../types'
import { confirmSheet, toast } from '../lib/uiStore'
import { prefersCalm } from '../lib/viewPrefs'
import { Sentences } from './Sentences'
import ReportTypeIcon from './ReportTypeIcon'
import RulerSlider from './RulerSlider'
import { fmtDay } from '../lib/format'
import { CURB_RULER, WIDTH_RULER } from '../lib/ruler'
import '../styles/review.css'

export type Loc = { lat: number; lng: number }
type Photo = { id: string; blob: Blob; url: string; sample?: boolean }
type Step = 1 | 2 | 3 | 4

type Props = {
  location: Loc | null
  onLocation: (l: Loc) => void
  onPickStart: () => void
  hidden: boolean
  seeds: Barrier[]
  onClose: () => void
  onOpenReport: (id: string) => void
  /** 홈 AI 검색에서 고른 유형(앱 유형 목록에 있는 값만 쓴다). 미리 선택만 해 두고, 바꿀 수 있다 */
  initialType?: string | null
  /** 부채꼴 바로가기처럼 유형을 이미 골랐으면 2단계(위치)부터 연다. 뒤로 가면 1단계에 그 유형이 골라져 있다 */
  skipType?: boolean
}

const GPS_ERR: Record<number, string> = {
  1: '위치 권한이 꺼져 있으니 "지도에서 선택"을 써 주세요.',
  2: '현재 위치를 확인할 수 없으니 "지도에서 선택"을 써 주세요.',
  3: '위치 확인이 오래 걸리니 "지도에서 선택"을 써 주세요.',
}

const STEP_Q: Record<Step, string> = {
  1: '어떤 문제를 만났나요?',
  2: '어디에 있나요?',
  3: '현장을 알려 주세요',
  4: '이 내용으로 등록할까요?',
}

// 사진 임시 번호(화면 표시용). 렌더 밖에서 만들어 순수성 규칙을 지킨다.
let photoSeq = 0
const newPhotoId = () => `p${++photoSeq}-${crypto.randomUUID()}`


const num = (s: string) => (s.trim() === '' ? undefined : Number(s))

export default function ReportFlow({ location, onLocation, onPickStart, hidden, seeds, onClose, onOpenReport, initialType = null, skipType = false }: Props) {
  const reports = useReports((s) => s.reports)
  const addReport = useReports((s) => s.addReport)

  const [presetType] = useState<string | null>(() => (initialType && REPORT_TYPES.some((t) => t.type === initialType) ? initialType : null))
  const [step, setStep] = useState<Step>(skipType && presetType ? 2 : 1)
  const [type, setType] = useState<string | null>(presetType)
  const [photos, setPhotos] = useState<Photo[]>([])
  const [description, setDescription] = useState('')
  const [widthM, setWidthM] = useState('')
  const [curbCm, setCurbCm] = useState('')
  const [locationChoice, setLocationChoice] = useState('') // 고른 장소(핵심 6개 또는 「기타」)
  const [locationOther, setLocationOther] = useState('') // 「기타」일 때 직접 입력한 글
  const locationKind = locationChoice ? composeKind(locationChoice, locationOther) : '' // 저장·표시에 쓰는 값
  const [locSource, setLocSource] = useState<'gps' | 'map' | null>(null)
  const pickStart = useRef<{ source: 'gps' | 'map' | null; location: Loc | null } | null>(null) // 지도에서 고르기 시작할 때의 상태
  const [gpsBusy, setGpsBusy] = useState(false)
  const [gpsMsg, setGpsMsg] = useState('')
  const [photoMsg, setPhotoMsg] = useState('')
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)
  const [sampleBusy, setSampleBusy] = useState(false)
  const [measOpen, setMeasOpen] = useState(false) // 「직접 잰 값」 펼침(기본 접힘)
  const trial = reports.some((r) => r.demo || r.demoSet) // 체험 데이터를 채운 상태에서만 샘플 사진 버튼을 보인다
  const [done, setDone] = useState<{ id: string; merged: boolean; photoFailed: boolean } | null>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const photosRef = useRef(photos)
  const descRef = useRef(description) // 검사할 때 오래된 값을 보지 않도록 최신 설명을 따로 들고 있는다
  useEffect(() => {
    descRef.current = description
  }, [description])
  const pendingSample = useRef<Promise<void> | null>(null) // 만드는 중인 샘플 사진
  useEffect(() => {
    photosRef.current = photos
  }, [photos])

  // 지도에서 고르기를 취소하고 돌아왔는데 위치가 그대로면 눌림 표시도 이전으로 돌린다
  useEffect(() => {
    const st = pickStart.current
    if (hidden || !st) return
    pickStart.current = null
    if (location === st.location) setLocSource(st.source)
  }, [hidden, location])
  useEffect(() => () => photosRef.current.forEach((p) => URL.revokeObjectURL(p.url)), [])

  // 접수가 끝나는 순간: 색종이·도장(화면 반응)과 함께 진동
  useEffect(() => {
    if (done) haptic('success')
  }, [done])

  // 단계가 바뀌면 맨 위부터 보여 준다
  useEffect(() => {
    panelRef.current?.scrollTo({ top: 0 })
  }, [step, done])

  // 미리 고른 유형이 목록 아래쪽이어도 보이게 한다
  useEffect(() => {
    if (!presetType) return
    const t = setTimeout(() => panelRef.current?.querySelector('.rf-type.on')?.scrollIntoView({ block: 'nearest', behavior: prefersCalm() ? 'auto' : 'smooth' }), 120)
    return () => clearTimeout(t)
  }, [presetType])

  const addr = useAddress(location?.lat ?? 0, location?.lng ?? 0, !!location)
  const placeText = location ? (addr.full ? `${addr.full} 부근` : addr.status === 'loading' ? '주소를 찾고 있어요…' : coordText(location.lat, location.lng)) : ''

  const info = REPORT_TYPES.find((t) => t.type === type) ?? null

  const duplicates = useMemo(
    () => (step === 4 && location && type ? findDuplicates(location.lat, location.lng, type, reports, seeds, nowMs()) : []),
    [step, location, type, reports, seeds],
  )

  const onFiles = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? [])
    if (files.length > 0) {
      setErr('photos', '')
      toast('사진을 추가했어요')
    }
    e.target.value = ''
    const room = PHOTO_MAX_COUNT - photos.length
    setPhotoMsg(files.length > room ? `사진은 최대 ${PHOTO_MAX_COUNT}장까지 올릴 수 있어서 앞의 ${room}장만 썼어요.` : '')
    for (const f of files.slice(0, Math.max(room, 0))) {
      try {
        const blob = await resizeImage(f)
        const p: Photo = { id: newPhotoId(), blob, url: URL.createObjectURL(blob) }
        setPhotos((prev) => (prev.length >= PHOTO_MAX_COUNT ? prev : [...prev, p]))
      } catch (err) {
        setPhotoMsg(err instanceof Error ? err.message : '사진을 처리하지 못했어요.')
      }
    }
  }

  // 사진이 없는 사람을 위한 체험용 그림. 같은 경로(긴 변 줄이기가 필요 없는 JPEG)로 사진 목록에 넣는다.
  const addSample = (sceneId: SampleSceneId) => {
    const p = addSampleInner(sceneId)
    pendingSample.current = p
    void p.finally(() => {
      if (pendingSample.current === p) pendingSample.current = null
    })
    return p
  }
  const addSampleInner = async (sceneId: SampleSceneId) => {
    if (photos.length >= PHOTO_MAX_COUNT || sampleBusy) return
    setSampleBusy(true)
    try {
      const blob = await sampleBlob(sceneId)
      const p: Photo = { id: newPhotoId(), blob, url: URL.createObjectURL(blob), sample: true }
      setPhotos((prev) => (prev.length >= PHOTO_MAX_COUNT ? prev : [...prev, p]))
      setErr('photos', '')
      setPhotoMsg('')
      const scene = SAMPLE_SCENES.find((s) => s.id === sceneId)
      if (scene && !descRef.current.trim()) {
        descRef.current = scene.description
        setDescription(scene.description)
      }
      toast('샘플 사진을 추가했어요')
    } catch (err) {
      setPhotoMsg(err instanceof Error ? err.message : '샘플 사진을 만들지 못했어요.')
    } finally {
      setSampleBusy(false)
    }
  }

  const removePhoto = (id: string) =>
    setPhotos((prev) => {
      prev.filter((p) => p.id === id).forEach((p) => URL.revokeObjectURL(p.url))
      return prev.filter((p) => p.id !== id)
    })

  const locate = () => {
    setLocSource('gps')
    if (!('geolocation' in navigator)) {
      setGpsMsg('이 기기에서는 현재 위치를 쓸 수 없으니 "지도에서 선택"을 써 주세요.')
      return
    }
    setGpsBusy(true)
    setGpsMsg('')
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setGpsBusy(false)
        onLocation({ lat: pos.coords.latitude, lng: pos.coords.longitude })
        setGpsMsg(`오차 약 ${Math.round(pos.coords.accuracy)}m · 이동 경로는 저장하지 않아요.`)
      },
      (err) => {
        setGpsBusy(false)
        setGpsMsg(GPS_ERR[err.code] ?? GPS_ERR[2])
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 },
    )
  }

  // 오류는 해당 칸 바로 아래에 보여 주고, 제출 때는 첫 오류 칸으로 포커스를 옮긴다.
  const fieldErr = {
    widthM: (v: string) => {
      const w = num(v)
      return w !== undefined && !(w > 0 && w <= 10) ? '폭은 0보다 크고 10m 이하의 숫자로 적어 주세요.' : ''
    },
    curbCm: (v: string) => {
      const c = num(v)
      return c !== undefined && !(c >= 0 && c <= 100) ? '턱 높이는 0~100cm 사이의 숫자로 적어 주세요.' : ''
    },
  }
  const setErr = (key: string, msg: string) =>
    setErrors((e) => {
      if (!msg) {
        if (!(key in e)) return e
        const { [key]: _drop, ...rest } = e
        return rest
      }
      return { ...e, [key]: msg }
    })
  const failWith = (errs: Record<string, string>) => {
    setErrors(errs)
    const first = Object.keys(errs)[0]
    if (first) requestAnimationFrame(() => document.getElementById('rf-f-' + first)?.focus())
    return !first
  }

  const validateLocation = () => {
    const errs: Record<string, string> = {}
    if (!location) errs.location = '위치를 정해 주세요.'
    if (!locationChoice) errs.locationKind = '어떤 곳인지 골라 주세요.'
    else if (locationChoice === OTHER_KIND && !locationOther.trim()) errs.locationKind = '어떤 곳인지 직접 적어 주세요.'
    return failWith(errs)
  }

  const validateDetail = () => {
    const errs: Record<string, string> = {}
    if (photosRef.current.length < 1 && photos.length < 1) errs.photos = '사진을 1장 이상 올려 주세요.'
    const w = fieldErr.widthM(widthM)
    const c = fieldErr.curbCm(curbCm)
    if (w) errs.widthM = w
    if (c) errs.curbCm = c
    return failWith(errs)
  }

  const go = (n: Step) => {
    setErrors({})
    setStep(n)
  }

  const submit = async (mergeInto?: string) => {
    if (!location || !info) return
    setBusy(true)
    const id = newReportId()
    const keys: string[] = []
    let photoFailed = false
    for (let i = 0; i < photos.length; i++) {
      const key = `${id}:${i}`
      try {
        await savePhoto(key, photos[i].blob)
        keys.push(key)
      } catch {
        photoFailed = true
      }
    }
    const w = num(widthM)
    const c = num(curbCm)
    const r = addReport(
      {
        id,
        lat: location.lat,
        lng: location.lng,
        type: info.type,
        category: info.category,
        description: description.trim(),
        locationKind,
        photos: keys,
        ...(w !== undefined || c !== undefined ? { measurements: { ...(w !== undefined ? { widthM: w } : {}), ...(c !== undefined ? { curbCm: c } : {}) } } : {}),
        // 샘플 사진으로 올린 제보는 표시를 남긴다(서버 공유에도 함께 전달됨)
        ...(photos.some((p) => p.sample) ? { sample: true } : {}),
      },
      mergeInto,
    )
    if (photos.some((p) => p.sample)) markSampleReport(r.id)
    setBusy(false)
    setDone({ id: r.id, merged: !!mergeInto, photoFailed })
  }

  const cancel = async () => {
    if (!done && (type || photos.length || description) && !(await confirmSheet({ title: '제보를 그만 쓸까요?', body: '작성 중인 내용이 사라져요.', confirmLabel: '그만 쓰기', cancelLabel: '계속 쓰기', danger: true }))) return
    onClose()
  }

  const dist = (m: number) => `약 ${Math.max(1, Math.round(m))}m`
  const q = STEP_Q[step]

  return (
    <div ref={panelRef} className="rf" role="dialog" aria-modal="true" aria-label="제보하기" hidden={hidden}>
      <div className="rf-head">
        {!done && step > 1 && (
          <button type="button" className="bm-back" onClick={() => go((step - 1) as Step)} disabled={busy} aria-label="이전 단계">
            이전
          </button>
        )}
        <h2>제보하기{!done && <span className="rf-step" aria-hidden="true">{step}/4</span>}</h2>
        <button type="button" className="bm-close" onClick={cancel}>
          닫기
        </button>
      </div>
      {!done && (
        <div className="rf-progress" role="progressbar" aria-valuemin={1} aria-valuemax={4} aria-valuenow={step} aria-valuetext={`4단계 중 ${step}단계`} aria-label="제보 진행 단계">
          <i style={{ transform: `scaleX(${step / 4})` }} />
        </div>
      )}

      {done ? (
        <div className="rf-body">
          <div className="rf-done rv-done" role="status">
            <span className="rf-done-hero">
              <span className="rf-done-mark" aria-hidden="true" />
              <Celebration />
            </span>
            <h2 className="rf-q">{done.merged ? '기존 건에 합쳐서 등록했어요' : '제보를 등록했어요'}</h2>
            <div className="rv-no-row">
              <span className="rv-no">접수번호 {reportNo(done.id)}</span>
              <button type="button" className="rv-copy" onClick={() => void copyNo(reportNo(done.id))} aria-label="접수번호 복사">
                복사
              </button>
            </div>
            {done.merged ? (
              <Sentences as="p">기존 건의 제보 목록에 추가됐어요.</Sentences>
            ) : (
              <ol className="rv-steps" aria-label="다음에 일어나는 일">
                <li>
                  <span className="n" aria-hidden="true">1</span>
                  <span>
                    <strong>다른 시민 확인</strong>
                    <span className="t">다른 시민 {VOTES_REQUIRED}명이 현장이 맞다고 하면 확인 완료가 돼요.</span>
                  </span>
                </li>
                <li>
                  <span className="n" aria-hidden="true">2</span>
                  <span>
                    <strong>기관 접수</strong>
                    <span className="t">확인된 제보는 담당 기관에 접수하는 방법을 안내해요.</span>
                  </span>
                </li>
                <li>
                  <span className="n" aria-hidden="true">3</span>
                  <span>
                    <strong>처리 결과 알림</strong>
                    <span className="t">기관이 고치면 알려 드리고, 시민이 다시 확인해요.</span>
                  </span>
                </li>
              </ol>
            )}
            {done.photoFailed && <Sentences as="p" className="rf-warn">일부 사진은 이 브라우저에 저장하지 못했어요. 제보 기록은 저장됐어요.</Sentences>}
          </div>
          <div className="rf-actions">
            <button type="button" onClick={() => onOpenReport(done.id)}>
              내용 보기
            </button>
            <button
              type="button"
              className="rf-primary"
              onClick={() => {
                onClose()
                navGo('#/report?section=mine')
              }}
            >
              내 제보
            </button>
          </div>
        </div>
      ) : (
        <div className="rf-body">
          <div key={step}>
            <h2 className="rf-q">{q}</h2>
          </div>

          {step === 1 && (
            <>
              <div className="rf-types rf-types--2" role="group" aria-label="문제 유형">
                {REPORT_TYPES.map((t) => (
                  <m.button
                    key={t.type}
                    type="button"
                    className={'rf-type mt' + (type === t.type ? ' on' : '')}
                    aria-pressed={type === t.type}
                    whileTap="press"
                    variants={{ press: { scale: TAP } }}
                    transition={SPRING.press}
                    onClick={() => {
                      // 고르면 바로 위치 단계로 넘어간다
                      haptic('tick')
                      setType(t.type)
                      go(2)
                    }}
                  >
                    {/* 누르면 아이콘이 커졌다가 손을 뗄 때 튕겨 돌아온다(C2) */}
                    <m.span className="rf-icon" aria-hidden="true" variants={{ press: { scale: 1.25 } }} transition={SPRING.pop}>
                      <ReportTypeIcon type={t.type} size={22} />
                    </m.span>
                    <span className="rf-type-text">
                      <strong>{t.type}</strong>
                    </span>
                    {type === t.type && <span className="rf-check">선택했어요</span>}
                  </m.button>
                ))}
              </div>
              {/* 이미 고른 유형이 있을 때(미리 고름·이전으로 돌아옴)만 그대로 넘어가는 버튼을 둔다 */}
              {type && (
                <div className="rf-actions">
                  <button type="button" className="rf-primary" onClick={() => go(2)}>
                    다음
                  </button>
                </div>
              )}
            </>
          )}

          {step === 2 && info && (
            <>
              <section className="rf-sec">
                <div className="rf-locbtns" role="group" aria-label="위치 정하는 방법">
                  <button type="button" className={locSource === 'gps' ? 'on' : ''} onClick={locate} disabled={gpsBusy} aria-pressed={locSource === 'gps'}>
                    {gpsBusy ? '확인하고 있어요…' : '현재 위치'}
                  </button>
                  <button
                    type="button"
                    className={locSource === 'map' ? 'on' : ''}
                    aria-pressed={locSource === 'map'}
                    onClick={() => {
                      pickStart.current = { source: locSource, location }
                      setLocSource('map')
                      onPickStart()
                    }}
                  >
                    지도에서 선택
                  </button>
                </div>
                <div
                  id="rf-f-location"
                  tabIndex={-1}
                  className={'rf-pos' + (location ? ' ok' : '')}
                  role="status"
                  aria-invalid={!!errors.location && !location}
                  aria-describedby={errors.location && !location ? (gpsMsg && locSource === 'gps' ? 'rf-gps-msg' : 'rf-e-location') : undefined}
                >
                  {location ? `위치를 정했어요 · ${placeText}` : '아직 위치를 정하지 않았어요'}
                </div>
                {/* 위치를 못 잡은 까닭(권한 꺼짐 등)이 떠 있으면 그 한 줄만 보인다 */}
                {errors.location && !location && !(gpsMsg && locSource === 'gps') && (
                  <p id="rf-e-location" className="rf-err" role="alert">
                    <Sentences as="span">{errors.location}</Sentences>
                  </p>
                )}
                {gpsMsg && (
                  <Sentences as="p" id="rf-gps-msg" className={locSource === 'gps' && !location ? 'rf-warn' : 'bm-meta'} role="status">
                    {gpsMsg}
                  </Sentences>
                )}
              </section>

              <section className="rf-sec">
                <h3 id="rf-kind-h">어떤 곳인가요?</h3>
                <div
                  id="rf-f-locationKind"
                  tabIndex={-1}
                  className="rf-kinds"
                  role="group"
                  aria-labelledby="rf-kind-h"
                  aria-describedby={errors.locationKind ? 'rf-e-locationKind' : undefined}
                >
                  {[...REPORT_LOCATION_CHOICES, OTHER_KIND].map((k) => (
                    <button
                      key={k}
                      type="button"
                      className={locationChoice === k ? 'on' : ''}
                      aria-pressed={locationChoice === k}
                      onClick={() => {
                        setLocationChoice(k)
                        if (k !== OTHER_KIND || locationOther.trim()) setErr('locationKind', '')
                      }}
                    >
                      {k}
                    </button>
                  ))}
                </div>
                {locationChoice === OTHER_KIND && (
                  <input
                    id="rf-f-locationOther"
                    type="text"
                    value={locationOther}
                    maxLength={OTHER_KIND_MAX}
                    placeholder="어떤 곳인지 적어 주세요"
                    aria-label="어떤 곳인지 직접 입력"
                    autoComplete="off"
                    onChange={(e) => {
                      setLocationOther(e.target.value)
                      if (e.target.value.trim()) setErr('locationKind', '')
                    }}
                  />
                )}
                {errors.locationKind && (
                  <p id="rf-e-locationKind" className="rf-err" role="alert">
                    <Sentences as="span">{errors.locationKind}</Sentences>
                  </p>
                )}
              </section>

              <div className="rf-actions">
                <button
                  type="button"
                  className="rf-primary"
                  onClick={() => {
                    if (validateLocation()) go(3)
                  }}
                >
                  다음
                </button>
              </div>
            </>
          )}

          {step === 3 && info && (
            <>
              <section id="rf-f-photos" tabIndex={-1} className="rf-sec" aria-describedby={errors.photos ? 'rf-e-photos' : undefined}>
                <h3>
                  사진 <span className="rv-req">필수</span> <span className="bm-meta">1~{PHOTO_MAX_COUNT}장</span>
                </h3>
                <div className="rf-notice">
                  <span className="sent"><strong>얼굴과 차량 번호판이 나오지 않게</strong> 찍어 주세요</span>
                </div>
                {photos.length > 0 && (
                  <div className="rf-photos">
                    {photos.map((p, i) => (
                      <div key={p.id} className="rf-photo">
                        <img src={p.url} alt={`${p.sample ? '샘플 사진' : '첨부 사진'} ${i + 1}`} />
                        <button type="button" onClick={() => removePhoto(p.id)} aria-label={`사진 ${i + 1} 삭제`}>
                          삭제
                        </button>
                      </div>
                    ))}
                  </div>
                )}
                {photos.length < PHOTO_MAX_COUNT && (
                  <label className="rf-btn">
                    사진 추가 ({photos.length}/{PHOTO_MAX_COUNT})
                    <input className="rf-file" type="file" accept="image/*" capture="environment" multiple onChange={onFiles} aria-invalid={!!errors.photos} aria-describedby={errors.photos ? 'rf-e-photos' : undefined} />
                  </label>
                )}
                {trial && photos.length < PHOTO_MAX_COUNT && (
                  <div className="rv-sample">
                    <div className="rv-sample-btns">
                      {SAMPLE_SCENES.map((s) => (
                        <button key={s.id} type="button" disabled={sampleBusy} onClick={() => addSample(s.id)}>
                          {s.label}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
                {errors.photos && photos.length === 0 && (
                  <p id="rf-e-photos" className="rf-err" role="alert">
                    {errors.photos}
                  </p>
                )}
                {photoMsg && (
                  <p className="rf-warn" role="status">
                    {photoMsg}
                  </p>
                )}
              </section>

              <section className="rf-sec">
                <label className="rf-field">
                  <span className="rf-field-h">
                    설명 <span className="bm-meta">선택</span>
                  </span>
                  <textarea id="rf-f-description" rows={2} value={description} onChange={(e) => setDescription(e.target.value)} />
                </label>
              </section>

              <details className="rf-fold" open={measOpen || !!errors.widthM || !!errors.curbCm} onToggle={(e) => setMeasOpen(e.currentTarget.open)}>
                <summary>
                  직접 잰 값 <span className="bm-meta">선택</span>
                </summary>
                <RulerSlider spec={WIDTH_RULER} label="폭" value={widthM} onChange={setWidthM} />
                <RulerSlider spec={CURB_RULER} label="턱 높이" value={curbCm} onChange={setCurbCm} />
              </details>

              <div className="rf-actions">
                <button
                  type="button"
                  className="rf-primary"
                  onClick={async () => {
                    // 샘플 사진을 만드는 중이면 끝나고 화면에 반영된 뒤에 검사한다
                    if (pendingSample.current) {
                      await pendingSample.current.catch(() => undefined)
                      await new Promise((r) => setTimeout(r, 80))
                    }
                    if (validateDetail()) go(4)
                  }}
                >
                  다음
                </button>
              </div>
            </>
          )}

          {step === 4 && info && location && (
            <>
              {duplicates.length > 0 && (
                <section className="rf-card rf-dup" aria-label="중복 확인">
                  <strong>이미 제보된 곳일 수 있어요</strong>
                  <Sentences as="p">{`같은 유형(${info.type})이 반경 15m 안에 있어요. 같은 곳이라면 기존 건에 합쳐 주세요.`}</Sentences>
                  {duplicates.map((d) => (
                    <div key={d.id} className="rf-dup-item">
                      <span>
                        <strong>{d.label}</strong> · {d.type}
                        <br />
                        <span className="bm-meta">
                          {dist(d.distanceM)} 떨어져 있어요{d.at ? ` · ${fmtDay(d.at)} 제보` : ''}
                        </span>
                      </span>
                      <button type="button" className="rf-primary rf-nowrap" disabled={busy} onClick={() => submit(d.id)}>
                        합치기
                      </button>
                    </div>
                  ))}
                </section>
              )}

              <section className="rf-card">
                <dl className="rf-sum">
                  <dt>유형</dt>
                  <dd>
                    {info.type}
                  </dd>
                  <dt>위치</dt>
                  <dd>
                    {locationKind} · {placeText}
                  </dd>
                  <dt>사진</dt>
                  <dd>
                    {photos.length}장{photos.some((p) => p.sample) && ' (샘플 사진)'}
                  </dd>
                  {description.trim() && (
                    <>
                      <dt>설명</dt>
                      <dd>{description.trim()}</dd>
                    </>
                  )}
                  {(num(widthM) !== undefined || num(curbCm) !== undefined) && (
                    <>
                      <dt>직접 잰 값</dt>
                      <dd>
                        {num(widthM) !== undefined && `폭 ${num(widthM)}m `}
                        {num(curbCm) !== undefined && `턱 높이 ${num(curbCm)}cm`}
                      </dd>
                    </>
                  )}
                  {info.category === 'temporary' && (
                    <>
                      <dt>유효기간</dt>
                      <dd><Sentences as="span">{`등록하고 ${TEMP_VALID_HOURS}시간 동안이에요. 지나면 다시 확인해야 해요.`}</Sentences></dd>
                    </>
                  )}
                </dl>
              </section>
              <div className="rf-actions">
                <button type="button" className={'rf-primary' + (busy ? ' is-busy' : '')} disabled={busy} aria-busy={busy} onClick={() => submit()}>
                  {busy && <span className="rf-spin" aria-hidden="true" />}
                  {busy ? '등록하고 있어요…' : duplicates.length > 0 ? '새로 등록하기' : '등록하기'}
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  )
}
