import { PUB_LAYERS, type PubDataset, type PubItem, type PubLayerId } from '../lib/publicLayers'
import { Sentences } from './Sentences'
import type { VoucherFields } from '../lib/vouchers'

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
    return [
      ['시설 유형', String(f['faclTyCd'] ?? '정보 없음')],
      ['영업 상태', String(f['salStaNm'] ?? '정보 없음')],
      ['편의시설 항목', typeof f['evalInfo'] === 'string' && f['evalInfo'] ? f['evalInfo'] : '자료에 아직 없음(상세 미조회)'],
    ]
  }
  if (layer === 'voucher') {
    const v = f as unknown as VoucherFields
    return [
      ['받는 상품권', v.vouchers.join(', ') || '정보 없음'],
      ['업종', v.category || '정보 없음'],
    ]
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
  const label = v.access === 'info' ? '♿ 출입구 정보 있음' : v.access === 'partial' ? '△ 일부 확인' : '? 확인 필요'
  return (
    <div className={'pc-acc pc-acc--' + v.access}>
      <strong>{label}</strong>
      {fac ? (
        <p>
          {fac.evalInfo ? `등록된 편의시설: ${fac.evalInfo}.` : '편의시설 항목을 아직 조회하지 못했어요.'}
          {v.access === 'partial' && fac.evalInfo ? ' 출입구 높이차이 정보는 확인이 필요해요.' : ''}
          <br />
          {fac.basis === 'address' ? '같은 주소' : '같은 이름·가까운 위치'}의 장애인편의시설 &lsquo;{fac.name}&rsquo; 자료예요. 건물 기준이라 이 가게의 입구와 다를 수 있어요.
        </p>
      ) : (
        <p>휠체어 접근 정보가 없어요. 방문 전에 확인해 주세요.</p>
      )}
    </div>
  )
}

export default function PubCard({ layer, item, dataset, onClose }: Props) {
  const info = PUB_LAYERS.find((l) => l.id === layer)
  return (
    <aside className="pc" aria-label="공공데이터 정보">
      <div className="bm-detail-head">
        <h2>
          <i className="bm-pub-chip" style={{ background: info?.color }}>
            {info?.glyph}
          </i>{' '}
          {item.name}
        </h2>
        <button type="button" className="bm-close" onClick={onClose} aria-label="닫기">
          닫기
        </button>
      </div>
      <p className="pc-addr">{item.address || '주소 정보 없음'}</p>
      {item.fields['geocoded'] === true && <Sentences as="p" className="rf-notice">주소로 찾은 위치예요. 오차가 있을 수 있어요.</Sentences>}
      {layer === 'voucher' && <VoucherAccess item={item} />}
      <dl className="pc-dl">
        {rows(layer, item).map(([k, v]) => (
          <div key={k}>
            <dt>{k}</dt>
            <dd>{v}</dd>
          </div>
        ))}
      </dl>
      <p className="bm-meta">
        출처: {dataset.source} ({dataset.provider}), 수집일 {dataset.fetchedAt.slice(0, 10)}
      </p>
      <p className="bm-meta">공공데이터라서 실제로 지나갈 수 있는지를 판정한 건 아니에요.</p>
      {layer === 'voucher' && <p className="bm-meta">방문 전에 가맹 여부를 확인해 주세요.</p>}
    </aside>
  )
}
