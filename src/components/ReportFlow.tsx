import { useEffect, useMemo, useRef, useState } from 'react'
import { PHOTO_MAX_COUNT, TEMP_VALID_HOURS } from '../lib/config'
import { findDuplicates } from '../lib/duplicates'
import { LOCATION_KINDS } from '../lib/agencyGuide'
import { resizeImage, savePhoto } from '../lib/photoStore'
import { CATEGORY_LABEL, REPORT_TYPES } from '../lib/reportTypes'
import { newReportId, nowMs, useReports, userName } from '../lib/reportStore'
import type { Barrier } from '../types'
import { confirmSheet, toast } from '../lib/uiStore'
import { prefersCalm } from '../lib/viewPrefs'

export type Loc = { lat: number; lng: number }
type Photo = { id: string; blob: Blob; url: string }
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
}

const GPS_ERR: Record<number, string> = {
  1: '위치 권한이 꺼져 있어요. 브라우저에서 위치를 허용하거나 "지도에서 선택"을 써 주세요.',
  2: '현재 위치를 확인할 수 없어요. "지도에서 선택"을 써 주세요.',
  3: '위치를 확인하는 데 시간이 너무 오래 걸렸어요. 다시 시도하거나 "지도에서 선택"을 써 주세요.',
}

const STEP_Q: Record<Step, { q: string; sub?: string }> = {
  1: { q: '어떤 문제를 만났나요?', sub: '가장 가까운 유형을 하나 골라 주세요.' },
  2: { q: '어디에 있나요?', sub: '위치를 정확히 알려 주실수록 확인이 빨라요.' },
  3: { q: '현장을 알려 주세요', sub: '사진과 설명이 있으면 다른 분들이 확인하기 쉬워요.' },
  4: { q: '이 내용으로 등록할까요?' },
}

// 사진 임시 번호(화면 표시용). 렌더 밖에서 만들어 순수성 규칙을 지킨다.
let photoSeq = 0
const newPhotoId = () => `p${++photoSeq}-${crypto.randomUUID()}`

const num = (s: string) => (s.trim() === '' ? undefined : Number(s))

export default function ReportFlow({ location, onLocation, onPickStart, hidden, seeds, onClose, onOpenReport, initialType = null }: Props) {
  const reports = useReports((s) => s.reports)
  const addReport = useReports((s) => s.addReport)
  const userId = useReports((s) => s.userId)

  const [step, setStep] = useState<Step>(1)
  const [presetType] = useState<string | null>(() => (initialType && REPORT_TYPES.some((t) => t.type === initialType) ? initialType : null))
  const [type, setType] = useState<string | null>(presetType)
  const [photos, setPhotos] = useState<Photo[]>([])
  const [description, setDescription] = useState('')
  const [widthM, setWidthM] = useState('')
  const [curbCm, setCurbCm] = useState('')
  const [locationKind, setLocationKind] = useState('')
  const [locSource, setLocSource] = useState<'gps' | 'map' | null>(null)
  const [gpsBusy, setGpsBusy] = useState(false)
  const [gpsMsg, setGpsMsg] = useState('')
  const [photoMsg, setPhotoMsg] = useState('')
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState<{ id: string; merged: boolean; photoFailed: boolean } | null>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const photosRef = useRef(photos)
  useEffect(() => {
    photosRef.current = photos
  }, [photos])

  useEffect(() => () => photosRef.current.forEach((p) => URL.revokeObjectURL(p.url)), [])

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

  const removePhoto = (id: string) =>
    setPhotos((prev) => {
      prev.filter((p) => p.id === id).forEach((p) => URL.revokeObjectURL(p.url))
      return prev.filter((p) => p.id !== id)
    })

  const locate = () => {
    setLocSource('gps')
    if (!('geolocation' in navigator)) {
      setGpsMsg('이 기기에서는 현재 위치를 쓸 수 없어요. "지도에서 선택"을 써 주세요.')
      return
    }
    setGpsBusy(true)
    setGpsMsg('')
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setGpsBusy(false)
        onLocation({ lat: pos.coords.latitude, lng: pos.coords.longitude })
        setGpsMsg(`현재 위치를 가져왔어요(오차 약 ${Math.round(pos.coords.accuracy)}m). 다르면 "지도에서 선택"으로 옮길 수 있어요. 이동 경로는 저장하지 않아요.`)
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
    if (!location) errs.location = '위치를 정해 주세요. "현재 위치"나 "지도에서 선택"을 눌러 주세요.'
    if (!locationKind) errs.locationKind = '어떤 곳인지 골라 주세요. 소관 기관을 안내하는 데 써요.'
    return failWith(errs)
  }

  const validateDetail = () => {
    const errs: Record<string, string> = {}
    if (photos.length < 1) errs.photos = '사진을 1장 이상 올려 주세요.'
    if (!description.trim()) errs.description = '설명을 적어 주세요.'
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
      },
      mergeInto,
    )
    setBusy(false)
    setDone({ id: r.id, merged: !!mergeInto, photoFailed })
  }

  const cancel = async () => {
    if (!done && (type || photos.length || description) && !(await confirmSheet({ title: '제보를 그만 쓸까요?', body: '작성 중인 내용이 사라져요.', confirmLabel: '닫기', cancelLabel: '계속 쓰기', danger: true }))) return
    onClose()
  }

  const dist = (m: number) => `약 ${Math.max(1, Math.round(m))}m`
  const q = STEP_Q[step]

  return (
    <div ref={panelRef} className="rf" role="dialog" aria-modal="true" aria-label="장애요소 제보하기" hidden={hidden}>
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
          <div className="rf-done" role="status">
            <span className="rf-done-mark" aria-hidden="true" />
            <h2 className="rf-q">{done.merged ? '기존 건에 합쳐서 등록했어요' : '제보를 등록했어요'}</h2>
            <p>
              {done.merged
                ? '기존 건의 제보 목록에 추가됐어요.'
                : '지금은 "검증 대기" 상태예요. 다른 시민이나 검증자가 확인하면 지도에 나타나요.'}
            </p>
            {done.photoFailed && <p className="rf-warn">일부 사진은 이 브라우저에 저장하지 못했어요. 제보 기록은 저장됐어요.</p>}
          </div>
          <div className="rf-actions">
            <button type="button" onClick={onClose}>
              닫기
            </button>
            <button type="button" className="rf-primary" onClick={() => onOpenReport(done.id)}>
              제보 내용 보기
            </button>
          </div>
        </div>
      ) : (
        <div className="rf-body">
          <div>
            <h2 className="rf-q">{q.q}</h2>
            {q.sub && <p className="rf-q-sub">{q.sub}</p>}
          </div>

          {step === 1 && (
            <>
              {presetType && type === presetType && (
                <p className="bm-meta rf-preset" role="status">
                  검색에서 고른 유형이에요. 다르면 바꿔 주세요.
                </p>
              )}
              {(['fixed', 'temporary'] as const).map((cat) => (
                <fieldset key={cat} className="rf-group">
                  <legend>
                    {CATEGORY_LABEL[cat]}
                    {cat === 'temporary' && <span className="bm-meta"> · 등록 후 {TEMP_VALID_HOURS}시간 동안 유효해요</span>}
                  </legend>
                  <div className="rf-types">
                    {REPORT_TYPES.filter((t) => t.category === cat).map((t) => (
                      <button
                        key={t.type}
                        type="button"
                        className={'rf-type' + (type === t.type ? ' on' : '')}
                        aria-pressed={type === t.type}
                        onClick={() => setType(t.type)}
                      >
                        <span className="rf-icon" aria-hidden="true">
                          {t.icon}
                        </span>
                        <span className="rf-type-text">
                          <strong>{t.type}</strong>
                          <span>{t.desc}</span>
                        </span>
                        {type === t.type && <span className="rf-check">선택했어요</span>}
                      </button>
                    ))}
                  </div>
                </fieldset>
              ))}
              <div className="rf-actions">
                {!type && (
                  <p id="rf-why-1" className="bm-meta rf-why">
                    유형을 하나 고르면 다음으로 갈 수 있어요.
                  </p>
                )}
                <button type="button" className="rf-primary" disabled={!type} aria-describedby={!type ? 'rf-why-1' : undefined} onClick={() => go(2)}>
                  다음
                </button>
              </div>
            </>
          )}

          {step === 2 && info && (
            <>
              <section className="rf-sec">
                <div className="rf-seg" role="group" aria-label="위치 정하는 방법">
                  <button type="button" className={locSource === 'gps' ? 'on' : ''} onClick={locate} disabled={gpsBusy} aria-pressed={locSource === 'gps'}>
                    {gpsBusy ? '확인하고 있어요…' : '현재 위치'}
                  </button>
                  <button
                    type="button"
                    className={locSource === 'map' ? 'on' : ''}
                    aria-pressed={locSource === 'map'}
                    onClick={() => {
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
                  aria-invalid={!!errors.location}
                  aria-describedby={errors.location ? 'rf-e-location' : undefined}
                >
                  {location ? `위치를 정했어요 · 위도 ${location.lat.toFixed(5)}, 경도 ${location.lng.toFixed(5)}` : '아직 위치를 정하지 않았어요.'}
                </div>
                {errors.location && !location && (
                  <p id="rf-e-location" className="rf-err" role="alert">
                    {errors.location}
                  </p>
                )}
                {gpsMsg && (
                  <p className={locSource === 'gps' && !location ? 'rf-warn' : 'bm-meta'} role="status">
                    {gpsMsg}
                  </p>
                )}
              </section>

              <section className="rf-sec">
                <label className="rf-field">
                  어떤 곳인가요?
                  <select
                    id="rf-f-locationKind"
                    value={locationKind}
                    aria-invalid={!!errors.locationKind}
                    aria-describedby={errors.locationKind ? 'rf-e-locationKind' : undefined}
                    onChange={(e) => {
                      setLocationKind(e.target.value)
                      if (e.target.value) setErr('locationKind', '')
                    }}
                  >
                    <option value="">골라 주세요</option>
                    {LOCATION_KINDS.map((k) => (
                      <option key={k} value={k}>
                        {k}
                      </option>
                    ))}
                  </select>
                </label>
                {errors.locationKind ? (
                  <p id="rf-e-locationKind" className="rf-err" role="alert">
                    {errors.locationKind}
                  </p>
                ) : (
                  <span className="bm-meta">어느 기관이 맡는 곳인지 안내하는 데 써요.</span>
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
                  사진 <span className="bm-meta">1~{PHOTO_MAX_COUNT}장</span>
                </h3>
                <div className="rf-notice">
                  사진에 <strong>얼굴과 차량 번호판이 나오지 않게</strong> 가리거나 피해서 찍어 주세요. 자동으로 가려 주지는 않아요. 사진은 이 기기에서 긴 변 1280px로 줄여 저장하고, 촬영 위치 같은 부가 정보는 지워요.
                </div>
                {photos.length > 0 && (
                  <div className="rf-photos">
                    {photos.map((p, i) => (
                      <div key={p.id} className="rf-photo">
                        <img src={p.url} alt={`첨부 사진 ${i + 1}`} />
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
                  설명
                  <textarea
                    id="rf-f-description"
                    rows={3}
                    value={description}
                    aria-invalid={!!errors.description}
                    aria-describedby={errors.description ? 'rf-e-description' : undefined}
                    onChange={(e) => {
                      setDescription(e.target.value)
                      if (e.target.value.trim()) setErr('description', '')
                    }}
                    placeholder="예: 보도 가운데 전봇대가 있어 휠체어가 지나갈 수 없어요"
                  />
                </label>
                {errors.description && (
                  <p id="rf-e-description" className="rf-err" role="alert">
                    {errors.description}
                  </p>
                )}
              </section>

              <section className="rf-sec">
                <h3>
                  직접 잰 값 <span className="bm-meta">선택</span>
                </h3>
                <div className="rf-two">
                  <label className="rf-field">
                    폭 (m)
                    <input
                      id="rf-f-widthM"
                      type="number"
                      inputMode="decimal"
                      step="0.01"
                      min="0"
                      value={widthM}
                      aria-invalid={!!errors.widthM}
                      aria-describedby={errors.widthM ? 'rf-e-widthM' : undefined}
                      onChange={(e) => {
                        setWidthM(e.target.value)
                        if (!fieldErr.widthM(e.target.value)) setErr('widthM', '')
                      }}
                      onBlur={() => setErr('widthM', fieldErr.widthM(widthM))}
                    />
                    {errors.widthM && (
                      <span id="rf-e-widthM" className="rf-err" role="alert">
                        {errors.widthM}
                      </span>
                    )}
                  </label>
                  <label className="rf-field">
                    턱 높이 (cm)
                    <input
                      id="rf-f-curbCm"
                      type="number"
                      inputMode="decimal"
                      step="0.1"
                      min="0"
                      value={curbCm}
                      aria-invalid={!!errors.curbCm}
                      aria-describedby={errors.curbCm ? 'rf-e-curbCm' : undefined}
                      onChange={(e) => {
                        setCurbCm(e.target.value)
                        if (!fieldErr.curbCm(e.target.value)) setErr('curbCm', '')
                      }}
                      onBlur={() => setErr('curbCm', fieldErr.curbCm(curbCm))}
                    />
                    {errors.curbCm && (
                      <span id="rf-e-curbCm" className="rf-err" role="alert">
                        {errors.curbCm}
                      </span>
                    )}
                  </label>
                </div>
              </section>

              <div className="rf-actions">
                <button
                  type="button"
                  className="rf-primary"
                  onClick={() => {
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
                  <p>같은 유형({info.type})이 반경 15m 안에 있어요. 같은 곳이라면 기존 건에 합쳐 주세요.</p>
                  {duplicates.map((d) => (
                    <div key={d.id} className="rf-dup-item">
                      <span>
                        <strong>{d.label}</strong> · {d.type}
                        <br />
                        <span className="bm-meta">
                          {dist(d.distanceM)} 떨어져 있어요{d.at ? ` · ${new Date(d.at).toLocaleDateString('ko-KR')} 제보` : ''}
                        </span>
                      </span>
                      <button type="button" className="rf-primary" disabled={busy} onClick={() => submit(d.id)}>
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
                    {info.type} ({CATEGORY_LABEL[info.category]})
                  </dd>
                  <dt>위치</dt>
                  <dd>
                    {locationKind} · 위도 {location.lat.toFixed(5)}, 경도 {location.lng.toFixed(5)}
                  </dd>
                  <dt>사진</dt>
                  <dd>{photos.length}장</dd>
                  <dt>설명</dt>
                  <dd>{description.trim()}</dd>
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
                      <dd>등록하고 {TEMP_VALID_HOURS}시간 동안이에요. 지나면 다시 확인해야 해요.</dd>
                    </>
                  )}
                  <dt>작성자</dt>
                  <dd>{userName(userId)} (시연용 사용자)</dd>
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
