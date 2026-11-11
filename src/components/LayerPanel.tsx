import { PUB_LAYERS, type LayerState, type PubDataset, type PubLayerId } from '../lib/publicLayers'
import SheetHandle from './SheetHandle'
import { DEFAULT_FILTER, STATUS_CHIPS, type KindKey, type MapFilter } from '../lib/mapFilter'
import { IMPACT_INFO } from '../lib/display'
import type { ReactNode } from 'react'

type Props = {
  layers: LayerState
  data: Partial<Record<PubLayerId, PubDataset>>
  loading: Partial<Record<PubLayerId, 'loading' | 'error'>>
  onChange: (patch: Partial<LayerState>) => void
  onClose: () => void
  /** 시민 제보 핀 표시 규칙(표시만 바꾼다) */
  filter: MapFilter
  onFilter: (f: MapFilter) => void
  citizen: { shown: number; total: number }
  /** 화면 설정·시연 도구처럼 지도 위에 두지 않는 버튼들 */
  extra?: ReactNode
}

const KINDS: KindKey[] = ['passage', 'boarding', 'entry', 'zone']

export default function LayerPanel({ layers, data, loading, onChange, onClose, filter, onFilter, citizen, extra }: Props) {
  const set = (patch: Partial<LayerState>) => onChange(patch)
  return (
    <>
      <div className="ms-dim" onClick={onClose} />
      <div className="ms lp" data-sheet role="dialog" aria-modal="true" aria-label="지도 레이어">
        <SheetHandle onDown={onClose} />
        <div className="ms-head">
          <div>
            <h2>지도에 보여 줄 것</h2>
            <p className="ms-sub">켜고 끄면 지도에 바로 반영돼요.</p>
          </div>
          <button type="button" className="bm-close" onClick={onClose}>
            닫기
          </button>
        </div>

        <button type="button" className={'lp-card' + (layers.team ? ' on' : '')} aria-pressed={layers.team} onClick={() => set({ team: !layers.team })}>
          <span className="lp-icon" aria-hidden="true">
            🗺️
          </span>
          <span className="lp-text">
            <strong>팀 조사·시민 제보</strong>
            <span>○△X 판정이 있는 장애요소예요</span>
          </span>
          <span className="lp-state">{layers.team ? '켜짐' : '꺼짐'}</span>
        </button>

        {layers.team && (
          <div className="lp-filter">
            <h3>시민 제보 핀 보기</h3>
            <p className="bm-meta">
              팀 조사 지점은 항상 보여요. 시민 제보 {citizen.total}건 중 {citizen.shown}건을 핀으로 보여 드려요.
            </p>
            <div className="lp-chips" role="group" aria-label="시민 제보 상태">
              {STATUS_CHIPS.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  className="lp-chip"
                  aria-pressed={filter.status[c.id]}
                  onClick={() => onFilter({ ...filter, status: { ...filter.status, [c.id]: !filter.status[c.id] } })}
                >
                  {c.label}
                </button>
              ))}
            </div>
            <div className="lp-chips" role="group" aria-label="시민 제보 유형">
              {KINDS.map((k) => (
                <button key={k} type="button" className="lp-chip" aria-pressed={filter.kind[k]} onClick={() => onFilter({ ...filter, kind: { ...filter.kind, [k]: !filter.kind[k] } })}>
                  {IMPACT_INFO[k].glyph} {IMPACT_INFO[k].label}
                </button>
              ))}
            </div>
            <button type="button" className="lp-reset" onClick={() => onFilter(DEFAULT_FILTER)}>
              기본으로 되돌리기
            </button>
          </div>
        )}

        <p className="bm-meta">공공데이터는 참고용이에요. 지나갈 수 있는지를 판정한 건 아니에요.</p>
        {PUB_LAYERS.map((l) => {
          const on = layers[l.id]
          const st = loading[l.id]
          return (
            <div key={l.id}>
              <button type="button" className={'lp-card' + (on ? ' on' : '')} aria-pressed={on} onClick={() => set({ [l.id]: !on } as Partial<LayerState>)}>
                <span className="lp-icon" aria-hidden="true">
                  {l.icon}
                </span>
                <span className="lp-text">
                  <strong>
                    <i className="bm-pub-chip" style={{ background: l.color }}>
                      {l.glyph}
                    </i>{' '}
                    {l.label}
                  </strong>
                  <span>
                    {l.desc}
                    {on && st === 'loading' && ' · 불러오고 있어요'}
                    {on && st === 'error' && ' · 불러오지 못했어요'}
                    {on && !st && data[l.id] && ` · 전체 ${data[l.id]?.count}건`}
                  </span>
                </span>
                <span className="lp-state">{on ? '켜짐' : '꺼짐'}</span>
              </button>
              {l.id === 'toilet' && on && (
                <label className="lp-check">
                  <input type="checkbox" checked={layers.toiletAccessibleOnly} onChange={(e) => set({ toiletAccessibleOnly: e.target.checked })} />
                  장애인용 시설이 있는 곳만 보기
                </label>
              )}
            </div>
          )
        })}
        <p className="bm-meta">지도를 확대해야 보여요. 넓게 보면 안내만 나와요. 핀은 한 지점, 굵은 선은 구간, 반투명 면은 영역이에요.</p>
        {extra && <div className="lp-extra">{extra}</div>}
      </div>
    </>
  )
}
