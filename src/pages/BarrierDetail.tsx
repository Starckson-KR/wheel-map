import BusArrivals from '../components/BusArrivals'
import PhotoGallery from '../components/PhotoGallery'
import { PILOT_STOPS } from '../lib/bus/data.ts'
import type { BoardingWarn } from '../lib/bus/boarding.ts'
import SheetHandle from '../components/SheetHandle'
import { RATING_STYLE } from '../lib/rating'
import { IMPACT_INFO, impactLine, impactOf, shortName } from '../lib/display'
import { useState } from 'react'
import { LOCATION_KINDS, guessLocationKind } from '../lib/agencyGuide'
import { REPORT_TYPES } from '../lib/reportTypes'
import { usePlan } from '../lib/planStore'
import { PHOTOS_VISIBLE, photosFor } from '../lib/photos'
import { publicIssue, publicRatingSource } from '../lib/displayText'
import { STATUS_LABEL, userName } from '../lib/reportStore'
import type { Barrier, Rating, Report } from '../types'

type Props = {
  barrier: Barrier
  parent: Barrier | null
  subItems: Barrier[]
  onSelect: (id: string) => void
  onClose: () => void
  mergedReports?: Report[]
  onOpenReport?: (id: string) => void
  flowReport?: Report
  overrideRating?: Rating | null
  onStartFlow?: (type: string, kind: string) => void
}

export default function BarrierDetail({ barrier: b, parent, subItems, onSelect, onClose, mergedReports = [], onOpenReport, flowReport, overrideRating, onStartFlow }: Props) {
  const [flowType, setFlowType] = useState(b.reportType ?? '')
  const [flowKind, setFlowKind] = useState(guessLocationKind(b.type))
  const plan = usePlan((s) => s.entries[b.id])
  const own = overrideRating !== undefined ? (overrideRating ?? undefined) : b.rating
  const inherited = !own && parent?.rating ? parent.rating : undefined
  const rating = own ?? inherited
  const style = RATING_STYLE[rating ?? 'none']
  const impact = impactOf(b, parent)
  // 리뷰어에게 보이는 문구: 팀 내부 메모(팀원 이름·조사 문서 장 번호 등)는 표시 단계에서 걸러 낸다.
  const parentSource = publicRatingSource(parent?.ratingSource)
  const showPhotos = PHOTOS_VISIBLE && photosFor(b.id).length > 0
  // 7단계: 시범 정류장은 실제 BIS 정류소와 짝지어 둔 것이 있으면 저상버스 도착 정보를 보여 준다(없으면 이 구역은 나오지 않음)
  const stopEntry = PILOT_STOPS.items[b.id]
  const stopWarns: BoardingWarn[] =
    impact === 'boarding' && (rating === 'X' || rating === 'TRIANGLE')
      ? [{ id: b.id, name: b.issue ?? shortName(b.id, b.name), rating, distM: 0, origin: 'seed', parentKey: b.id }]
      : []

  return (
    <aside className="bm-detail" data-sheet aria-label="지점 상세">
      <SheetHandle onDown={onClose} />
      <div className="bm-detail-head">
        <h2>{shortName(b.id, b.name)}</h2>
        <button type="button" className="bm-close" onClick={onClose} aria-label="닫기">
          닫기
        </button>
      </div>

      <p>
        <span className="bm-badge" style={{ background: style.color, color: style.ink }}>
          {style.label}
        </span>
        {inherited && parent && (
          <span className="bm-meta">
            상위 항목 {shortName(parent.id, parent.name)}의 평가{parentSource ? `(${parentSource})` : ''}를 따라 보여 줘요.
          </span>
        )}
      </p>

      <p className="bm-impact">
        <i className="hm-cat">{IMPACT_INFO[impact].glyph}</i>
        {impactLine(impact, rating ?? 'none')}
      </p>

      {plan && plan.stage !== '미반영' && (
        <p className="bm-plan" role="note">
          개선계획: {plan.stage}
          {plan.year ? ` · ${plan.year}년` : ''}
        </p>
      )}

      {stopEntry && (
        <section className="bus-sec" aria-label="저상버스 정보">
          <h3>저상버스 도착 정보</h3>
          {stopEntry.status !== 'ok' && stopEntry.matches.length > 1 && <p className="bm-meta">아래에서 방면을 골라 주세요.</p>}
          <BusArrivals
            key={b.id}
            choices={stopEntry.matches.map((m) => ({ stationId: m.stationId, name: m.name, next: m.next }))}
            warns={stopWarns}
          />
        </section>
      )}

      <dl>
        <dt>종류</dt>
        <dd>
          {b.type}
        </dd>
        {publicIssue(b.issue) && (
          <>
            <dt>문제 요약</dt>
            <dd>{publicIssue(b.issue)}</dd>
          </>
        )}
        {b.measurements.length > 0 && (
          <>
            <dt>직접 잰 값</dt>
            <dd>
              <ul>
                {b.measurements.map((m) => (
                  <li key={m.label}>
                    {m.label}: {m.value}
                  </li>
                ))}
              </ul>
            </dd>
          </>
        )}
        {showPhotos && (
          <>
            <dt>사진</dt>
            <dd>
              <PhotoGallery key={b.id} barrierId={b.id} />
            </dd>
          </>
        )}
      </dl>

      {onStartFlow && (flowReport || b.geometry) && (
        <div className="rf-card">
          <strong>민원 접수 안내</strong>
          {flowReport ? (
            <>
              <p>
                <span className="sent">이 지점은 민원이 진행 중이에요.</span> <span className="sent">지금은 <b>{STATUS_LABEL[flowReport.status]}</b> 단계예요.</span>
              </p>
              <button type="button" className="rf-primary" onClick={() => onOpenReport?.(flowReport.id)}>
                진행 상황 보기
              </button>
            </>
          ) : (
            <>
              <label className="rf-field">
                어떤 문제인가요?
                <select value={flowType} onChange={(e) => setFlowType(e.target.value)}>
                  <option value="">골라 주세요</option>
                  {REPORT_TYPES.map((t) => (
                    <option key={t.type}>{t.type}</option>
                  ))}
                </select>
              </label>
              <label className="rf-field">
                어떤 곳인가요?
                <select value={flowKind} onChange={(e) => setFlowKind(e.target.value)}>
                  <option value="">골라 주세요</option>
                  {LOCATION_KINDS.map((k) => (
                    <option key={k}>{k}</option>
                  ))}
                </select>
              </label>
              <button type="button" className="rf-primary" disabled={!flowType || !flowKind} onClick={() => onStartFlow(flowType, flowKind)}>
                이 지점 민원 시작하기
              </button>
            </>
          )}
        </div>
      )}

      {mergedReports.length > 0 && (
        <div>
          <strong>합쳐진 시민 제보 {mergedReports.length}건</strong>
          <ul className="lr-list bm-children">
            {mergedReports.map((m) => (
              <li key={m.id}>
                <button type="button" className="lr" onClick={() => onOpenReport?.(m.id)}>
                  <span className="lr-main">
                    <span className="lr-title">
                      {userName(m.userId)} · {m.type}
                    </span>
                    <span className="lr-sub">{m.description}</span>
                  </span>
                  <span className="lr-chev" aria-hidden="true" />
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {parent && (
        <div>
          <strong>상위 항목</strong>
          <ul className="lr-list bm-children">
            <li>
              <button type="button" className="lr" onClick={() => onSelect(parent.id)}>
                <span className="lr-main">
                  <span className="lr-title">
                    {shortName(parent.id, parent.name)}
                  </span>
                </span>
                <span className="lr-chev" aria-hidden="true" />
              </button>
            </li>
          </ul>
        </div>
      )}
      {subItems.length > 0 && (
        <div>
          <strong>하위 항목</strong>
          <ul className="lr-list bm-children">
            {subItems.map((c) => (
              <li key={c.id}>
                <button type="button" className="lr" onClick={() => onSelect(c.id)}>
                  <span className="lr-main">
                    <span className="lr-title">
                      {shortName(c.id, c.name)}
                    </span>
                  </span>
                  <span className="lr-chev" aria-hidden="true" />
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </aside>
  )
}
