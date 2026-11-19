import Icon from './Icon'
import { PUB_LAYERS, type LayerState, type PubLayerId } from '../lib/publicLayers'
import SheetHandle from './SheetHandle'
import { DEFAULT_FILTER, STATUS_CHIPS, type KindKey, type MapFilter } from '../lib/mapFilter'
import { IMPACT_INFO } from '../lib/display'
import type { ReactNode } from 'react'
import { LAYER_GROUPS, TILE_LABEL, applyChip, chipOf, type LayerKey } from '../lib/layerPresets'

type Props = {
  layers: LayerState
  loading: Partial<Record<PubLayerId, 'loading' | 'error'>>
  onChange: (patch: Partial<LayerState>) => void
  onClose: () => void
  /** 시민 제보 핀 표시 규칙(표시만 바꾼다) */
  filter: MapFilter
  onFilter: (f: MapFilter) => void
  /** 화면 설정·시연 도구처럼 지도 위에 두지 않는 버튼들 */
  extra?: ReactNode
}

const KINDS: KindKey[] = ['passage', 'boarding', 'entry', 'zone']
const TEAM_TILE = { label: '장애요소', color: 'var(--grey-800)', icon: 'map' }

function tileOf(k: LayerKey) {
  if (k === 'team') return TEAM_TILE
  const l = PUB_LAYERS.find((x) => x.id === k)
  return l ? { label: TILE_LABEL[k] ?? l.label, color: l.color, icon: l.icon } : null
}

/** 직접 고르기: 레이어를 다섯 묶음, 두 줄 타일로 켜고 끈다. 켜진 타일은 파란 테두리와 체크로 보인다. */
export default function LayerPanel({ layers, loading, onChange, onClose, filter, onFilter, extra }: Props) {
  const failed = PUB_LAYERS.filter((l) => layers[l.id] && loading[l.id] === 'error')
  return (
    <>
      <div className="ms-dim" onClick={onClose} />
      <div className="ms lp" data-sheet role="dialog" aria-modal="true" aria-label="지도에 보여 줄 것 직접 고르기">
        <SheetHandle onDown={onClose} />
        <div className="ms-head">
          <div>
            <h2>직접 고르기</h2>
          </div>
          <button type="button" className="bm-close" onClick={onClose}>
            닫기
          </button>
        </div>

        {LAYER_GROUPS.map((g) => (
          <section key={g.id} className="lp-group" aria-label={g.label}>
            <h3>{g.label}</h3>
            <div className="lp-grid">
              {g.keys.map((k) => {
                const t = tileOf(k)
                if (!t) return null
                const on = layers[k]
                return (
                  <button key={k} type="button" className={'lp-tile' + (on ? ' on' : '')} aria-pressed={on} onClick={() => onChange({ [k]: !on } as Partial<LayerState>)}>
                    <span className="lp-tile-ic" aria-hidden="true" style={{ background: t.color }}>
                      <Icon name={t.icon} size={16} />
                    </span>
                    <span className="lp-tile-name">{t.label}</span>
                    <span className="lp-tile-ck" aria-hidden="true">
                      <Icon name="check" size={18} />
                    </span>
                  </button>
                )
              })}
            </div>
          </section>
        ))}

        {failed.map((l) => (
          <p key={l.id} className="hm-note" role="status">
            {l.label} 정보를 불러오지 못했어요.
          </p>
        ))}

        {layers.toilet && (
          <label className="lp-check">
            <input type="checkbox" checked={layers.toiletAccessibleOnly} onChange={(e) => onChange({ toiletAccessibleOnly: e.target.checked })} />
            장애인용 시설이 있는 화장실만 보기
          </label>
        )}
        {layers.voucher && (
          <label className="lp-check">
            <input type="checkbox" checked={layers.voucherAccessibleOnly} onChange={(e) => onChange({ voucherAccessibleOnly: e.target.checked })} />
            출입구 정보가 있는 가맹점만 보기
          </label>
        )}

        <button type="button" className="lp-reset lp-reset--center" disabled={chipOf(layers) === 'walk'} onClick={() => onChange(applyChip('walk', layers))}>
          「길 가기」로 되돌리기
        </button>

        {layers.team && (
          <div className="lp-filter">
            <h3>시민 제보 핀 보기</h3>
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
        {extra && <div className="lp-extra">{extra}</div>}
      </div>
    </>
  )
}
