// 길찾기에 필요한 공공데이터만 불러온다(지도 레이어 켜짐과 상관없음). 침수는 비·눈일 때만 받는다.
import { loadBisStops } from '../bus/data.ts'
import { loadPubDataset, type PubLayerId } from '../publicLayers'
import { floodSpots, overpassSpots, type LayerPool, type LPt } from './layerRoute.ts'

const pts = (items: { id: string; name: string; lat?: number | null; lng?: number | null }[]): LPt[] =>
  items.filter((i): i is typeof i & { lat: number; lng: number } => typeof i.lat === 'number' && typeof i.lng === 'number').map((i) => ({ id: i.id, name: i.name, lat: i.lat, lng: i.lng }))

type Dry = Omit<LayerPool, 'flood'>
let dry: Promise<Dry> | null = null
let flood: Promise<LayerPool['flood']> | null = null
const ds = (id: PubLayerId) => loadPubDataset(id)

export async function loadLayerPool(wet: boolean): Promise<LayerPool> {
  dry ??= Promise.all([ds('overpass'), ds('toilet'), ds('shade'), ds('schoolZone'), loadBisStops()])
    .then(([ov, toilet, shade, school, bus]) => ({
      overpass: overpassSpots(ov.items),
      toilets: pts(toilet.items.filter((t) => Number(t.fields['장애인용위생시설합계'] ?? 0) > 0)),
      shades: pts(shade.items),
      schools: pts(school.items),
      stops: pts(bus),
    }))
    .catch((e) => {
      dry = null
      throw e
    })
  const d = await dry
  if (!wet) return { ...d, flood: [] }
  flood ??= ds('flood')
    .then((f) => floodSpots(f.items))
    .catch((e) => {
      flood = null
      throw e
    })
  return { ...d, flood: await flood }
}
