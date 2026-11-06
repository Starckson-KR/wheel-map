import BusArrivals from '../components/BusArrivals'
import PhotoGallery from '../components/PhotoGallery'
import { PILOT_STOPS } from '../lib/bus/data.ts'
import type { BoardingWarn } from '../lib/bus/boarding.ts'
import SheetHandle from '../components/SheetHandle'
import { RATING_STYLE } from '../lib/rating'
import { IMPACT_INFO, impactLine, impactOf, shortName } from '../lib/display'
import { useState } from 'react'
import { LOCATION_KINDS } from '../lib/agencyGuide'
import { REPORT_TYPES } from '../lib/reportTypes'
import { STATUS_LABEL, userName } from '../lib/reportStore'
import type { Barrier, Rating, Report } from '../types'

const KIND_LABEL = { point: '점', line: '선', area: '영역', group: '여러 점' } as const
const SOURCE_LABEL = { team_survey: '팀 현장조사', interview: '인터뷰 진술' } as const

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

// 지점 종류 문구로 위치 성격의 처음 선택값만 추정한다(사용자가 바꿀 수 있음).
function guessKind(t: string): string {
  if (t.includes('정류장')) return '버스정류장'
  if (t.includes('횡단보도')) return '횡단보도·신호'
  if (t.includes('쪽문')) return '대학 캠퍼스 내부'
  if (t.includes('기관')) return '공공건물 출입'
  if (t.includes('보도')) return '구·시 도로의 보도'
  return ''
}

export default function BarrierDetail({ barrier: b, parent, subItems, onSelect, onClose, mergedReports = [], onOpenReport, flowReport, overrideRating, onStartFlow }: Props) {
  const [flowType, setFlowType] = useState(b.reportType ?? '')
  const [flowKind, setFlowKind] = useState(guessKind(b.type))
  const own = overrideRating !== undefined ? (overrideRating ?? undefined) : b.rating
  const inherited = !own && parent?.rating ? parent.rating : undefined
  const rating = own ?? inherited
  const style = RATING_STYLE[rating ?? 'none']
  const impact = impactOf(b, parent)
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
        {own && b.ratingSource && <span className="bm-meta">평가 출처: {b.ratingSource}</span>}
        {inherited && parent && (
          <span className="bm-meta">
            상위 항목 {shortName(parent.id, parent.name)}의 평가({parent.ratingSource})를 따라 보여 줘요.
          </span>
        )}
        {!rating && <span className="bm-meta">자료에 평가가 없어요.</span>}
      </p>

      <p className="bm-impact">
        <i className="hm-cat">{IMPACT_INFO[impact].glyph}</i>
        {impactLine(impact, rating ?? 'none')}
      </p>

      {stopEntry && (
        <section className="bus-sec" aria-label="저상버스 정보">
          <h3>저상버스 도착 정보</h3>
          {stopEntry.status !== 'ok' && <p className="bm-meta">실제 정류소와 짝짓기가 애매해요: {stopEntry.note}.{stopEntry.matches.length > 1 ? ' 아래 방면을 눌러 맞는 쪽을 골라 주세요.' : ''}</p>}
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
          {KIND_LABEL[b.kind]} · {b.type}
          {b.locationStatus ? ' · 위치 미확정' : ''}
        </dd>
        {b.issue && (
          <>
            <dt>문제 요약</dt>
            <dd>{b.issue}</dd>
          </>
        )}
        <dt>직접 잰 값</dt>
        <dd>
          {b.measurements.length > 0 ? (
            <>
              <ul>
                {b.measurements.map((m) => (
                  <li key={m.label}>
                    {m.label}: {m.value}
                  </li>
                ))}
              </ul>
              <span className="bm-meta">아이폰 AR로 잰 값이라 몇 cm 정도 오차가 있을 수 있어요.</span>
            </>
          ) : (
            '자료에 잰 값이 없어요.'
          )}
        </dd>
        <dt>조사 정보</dt>
        <dd>
          {SOURCE_LABEL[b.source]} · 조사자 {b.surveyor ?? '정보 없음'} · 조사일 {b.surveyedAt ?? '정보 없음'}
        </dd>
        {b.note && (
          <>
            <dt>비고</dt>
            <dd>{b.note}</dd>
          </>
        )}
        {b.needsCheck && b.needsCheck.length > 0 && (
          <>
            <dt>확인이 더 필요해요</dt>
            <dd>
              <ul>
                {b.needsCheck.map((t) => (
                  <li key={t}>{t}</li>
                ))}
              </ul>
            </dd>
          </>
        )}
        <dt>사진</dt>
        <dd>
          <PhotoGallery key={b.id} barrierId={b.id} />
        </dd>
      </dl>

      {onStartFlow && (
        <div className="rf-card">
          <strong>민원 진행 (시연)</strong>
          {flowReport ? (
            <>
              <p>
                이 지점은 민원이 진행 중이에요. 지금은 <b>{STATUS_LABEL[flowReport.status]}</b> 단계예요.
              </p>
              <button type="button" className="rf-primary" onClick={() => onOpenReport?.(flowReport.id)}>
                진행 상황 보기
              </button>
            </>
          ) : (
            <>
              <p className="bm-meta">팀이 조사한 지점을 검증이 끝난 것으로 보고, 접수 안내부터 시연해요.</p>
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
              {!b.reportType && <span className="bm-meta">자료만으로는 유형을 정하기 어려워서 직접 골라 주세요.</span>}
              <button type="button" className="rf-primary" disabled={!flowType || !flowKind || !b.geometry} onClick={() => onStartFlow(flowType, flowKind)}>
                이 지점 민원 시작하기
              </button>
              {!b.geometry && <span className="bm-meta">위치가 정해지지 않은 지점은 시작할 수 없어요.</span>}
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
