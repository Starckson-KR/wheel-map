import { PUB_LAYERS, type PubDataset, type PubItem, type PubLayerId } from '../lib/publicLayers'
import Icon from './Icon'
import { Sentences } from './Sentences'
import type { VoucherFields } from '../lib/vouchers'
import { facilityTitle, usableName } from '../lib/facilityName'
import { facilityLabel, membersOf } from '../lib/facilityGroups'

/** 편의시설 항목을 한 줄로: 쉼표로 적힌 자료를 가운뎃점으로 잇고, 두 번 적힌 항목은 한 번만 */
const dots = (v: unknown) => (typeof v === 'string' ? [...new Set(v.split(',').map((x) => x.trim()).filter(Boolean))].join(' · ') : '')

type Props = { layer: PubLayerId; item: PubItem; dataset: PubDataset; onClose: () => void }

const yn = (v: unknown) => (v === 'Y' ? '있음' : v === 'N' ? '없음' : '정보 없음')

function rows(layer: PubLayerId, it: PubItem): [string, string][] {
  const f = it.fields
  if (layer === 'crosswalk') {
    return [
      ['보도턱 낮춤', f['보도턱낮춤여부'] === 'Y' ? '있음 (단차 cm는 자료에 없어요)' : f['보도턱낮춤여부'] === 'N' ? '없음 (턱이 있을 수 있어요)' : '정보 없음'],
      ['횡단보도 폭', f['횡단보도폭'] != null ? `${f['횡단보도폭']}m` : '정보 없음'],
      ['연장', f['횡단보도연장'] != null ? `${f['횡단보도연장']}m` : '정보 없음'],
      ['음향신호기', yn(f['음향신호기설치여부'])],
    ]
  }
  if (layer === 'toilet') {
    const total = Number(f['장애인용위생시설합계'] ?? 0)
    return [
      ['구분', String(f['구분명'] ?? '정보 없음')],
      ['장애인용 시설 수', `${total}개 (대변기 ${Number(f['남성용-장애인용대변기수'] ?? 0) + Number(f['여성용-장애인용대변기수'] ?? 0)}, 소변기 ${f['남성용-장애인용소변기수'] ?? 0})`],
      ['개방시간', `${f['개방시간'] ?? '정보 없음'}${f['개방시간상세'] ? ` (${f['개방시간상세']})` : ''}`],
      ['비상벨', yn(f['비상벨설치여부'])],
    ]
  }
  if (layer === 'facility') {
    return [['시설 유형', String(f['faclTyCd'] ?? '정보 없음')]]
  }
  if (layer === 'voucher') {
    const v = f as unknown as VoucherFields
    return [
      ['받는 상품권', v.vouchers.join(', ') || '정보 없음'],
      ['업종', v.category || '정보 없음'],
    ]
  }
  if (layer === 'overpass') {
    const has = f['장애인편의시설설치여부']
    const kind = typeof f['장애인편의시설종류'] === 'string' && f['장애인편의시설종류'] && f['장애인편의시설종류'] !== '없음' ? ` (${f['장애인편의시설종류']})` : ''
    return [
      ['장애인 편의시설', has === 'Y' ? `있음${kind}` : has === 'N' ? '없음 (계단으로만 오를 수 있을 수 있어요)' : '정보 없음'],
      ['육교 길이', f['육교연장'] != null ? `${f['육교연장']}m` : '정보 없음'],
      ['육교 폭', f['육교폭'] != null ? `${f['육교폭']}m` : '정보 없음'],
    ]
  }
  if (layer === 'welfare') {
    return [
      ['구분', String(f['구분'] || '정보 없음')],
      ['운영기관', String(f['운영기관명'] || '정보 없음')],
      ['전화', String(f['전화번호'] || '정보 없음')],
    ]
  }
  if (layer === 'yellow') {
    return [
      ['인근 학교', String(f['인근학교명칭'] || '정보 없음')],
      ['설치일', String(f['설치일'] || '정보 없음')],
    ]
  }
  if (layer === 'flood') {
    const kinds = (f['종류별'] ?? {}) as Record<string, number>
    return [
      ['피해 내용', Object.entries(kinds).map(([k, n]) => `${k} ${n}건`).join(', ') || '정보 없음'],
      ['발생 연도', Array.isArray(f['발생연도']) && f['발생연도'].length ? `${(f['발생연도'] as string[]).join(', ')}년` : '정보 없음'],
    ]
  }
  if (layer === 'shade') {
    return [
      ['종류', String(f['종류'] || '정보 없음')],
      ['설치일', String(f['설치일자'] || '정보 없음')],
    ]
  }
  if (layer === 'schoolZone') return [['구분', '어린이보호구역(스쿨존)']]
  if (layer === 'parkingZone') return [['구분', '주정차 단속구간']]
  if (layer === 'airSignal') {
    return [['측정 항목', '미세먼지, 초미세먼지, 오존, 이산화질소, 일산화탄소, 아황산가스']]
  }
  return [
    ['정류소 번호', f['nodeno'] != null ? String(f['nodeno']) : '정보 없음'],
    ['행정동', String(f['행정동'] ?? '정보 없음')],
  ]
}

/** 상품권 가맹점의 출입구 정보: 편의시설과 짝이 확실한 곳만 항목을 보여 주고, 아니면 확인 필요로 둔다 */
function VoucherAccess({ item }: { item: PubItem }) {
  const v = item.fields as unknown as VoucherFields
  const fac = v.facility
  const label = v.access === 'info' ? '출입구 정보 있음' : v.access === 'partial' ? '△ 일부 확인' : '? 확인 필요'
  return (
    <div className={'pc-acc pc-acc--' + v.access}>
      <strong>{label}</strong>
      {fac ? (
        <p>
          {fac.evalInfo ? `등록된 편의시설: ${fac.evalInfo}.` : '편의시설 항목을 아직 조회하지 못했어요.'}
          {v.access === 'partial' && fac.evalInfo ? ' 출입구 높이차이 정보는 확인이 필요해요.' : ''}
          <br />
          {fac.basis === 'address' ? '같은 주소' : '같은 이름·가까운 위치'}의 편의시설 {usableName(fac.name, fac.type) ? <>&lsquo;{usableName(fac.name, fac.type)}&rsquo; </> : ''}자료예요. 건물 기준이라 이 가게의 입구와 다를 수 있어요.
        </p>
      ) : (
        <p>휠체어 접근 정보가 없어요. 방문 전에 확인해 주세요.</p>
      )}
    </div>
  )
}

export default function PubCard({ layer, item, onClose }: Props) {
  const info = PUB_LAYERS.find((l) => l.id === layer)
  return (
    <aside className="pc" aria-label="공공데이터 정보">
      <div className="bm-detail-head">
        <h2>
          <i className="bm-pub-chip" style={{ background: info?.color }}>
            {info && <Icon name={info.icon} size={14} />}
          </i>{' '}
          {layer === 'facility' ? facilityLabel(item) : item.name}
        </h2>
        <button type="button" className="bm-close" onClick={onClose} aria-label="닫기">
          닫기
        </button>
      </div>
      <p className="pc-addr">{item.address || '주소 정보 없음'}</p>
      {item.fields['geocoded'] === true && <Sentences as="p" className="rf-notice">주소로 찾은 위치예요. 오차가 있을 수 있어요.</Sentences>}
      {layer === 'voucher' && <VoucherAccess item={item} />}
      {layer === 'facility' && membersOf(item).length > 1 ? (
        <ul className="pc-fac">
          {membersOf(item).map((m) => (
            <li key={m.key}>
              <strong>{facilityTitle({ name: m.name, address: m.address, fields: m.fields })}</strong>
              <span>{dots(m.evalInfo) || '정보 없음'}</span>
            </li>
          ))}
        </ul>
      ) : (
      <dl className="pc-dl">
        {rows(layer, item).map(([k, v]) => (
          <div key={k}>
            <dt>{k}</dt>
            <dd>{v}</dd>
          </div>
        ))}
      </dl>
      )}
      {layer === 'facility' && membersOf(item).length <= 1 && dots(item.fields['evalInfo']) && <p className="pc-items">{dots(item.fields['evalInfo'])}</p>}
      {layer === 'voucher' && <p className="bm-meta">방문 전에 가맹 여부를 확인해 주세요.</p>}
    </aside>
  )
}
