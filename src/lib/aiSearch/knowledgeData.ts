import { BENEFITS } from '../benefitsData'
import { listAgencies } from '../agencyGuide'
import type { PubDataset } from '../publicLayers'
import { askKnowledge, candidateTopics, dataNeeds, wantsNearby } from './knowledge'
import type { AskAnswer, KnowledgeData, Topic } from './knowledge'

// 지식형 질문에 쓰는 자료. 큰 JSON(화장실·편의시설·상품권·정류장)은 필요한 주제일 때만 불러온다(첫 화면 번들에 넣지 않는다).
const LOADERS = {
  toilets: () => import('../../../data/public/toilets.json'),
  facilities: () => import('../../../data/public/facilities.json'),
  vouchers: () => import('../../../data/public/vouchers.json'),
  busStops: () => import('../../../data/public/bus-stops.json'),
} as const

const loaded = new Map<string, Promise<PubDataset>>()
function load(name: keyof typeof LOADERS): Promise<PubDataset> {
  let p = loaded.get(name)
  if (!p) {
    p = (LOADERS[name]() as Promise<{ default: unknown }>).then((m) => m.default as PubDataset)
    p.catch(() => loaded.delete(name)) // 실패하면 다음에 다시 시도
    loaded.set(name, p)
  }
  return p
}

export async function loadKnowledge(topics: Topic[]): Promise<KnowledgeData> {
  const data: KnowledgeData = { benefits: BENEFITS, agencies: listAgencies() }
  await Promise.all(
    dataNeeds(topics).map(async (n) => {
      try {
        data[n] = await load(n)
      } catch {
        /* 못 불러온 자료는 건너뛴다(그 주제는 「찾지 못했어요」로 끝난다) */
      }
    }),
  )
  return data
}

// 지금 위치(「근처」를 물었을 때만 부른다). 허락하지 않았거나 늦으면 undefined.
export function getOrigin(timeoutMs = 4000): Promise<{ lat: number; lng: number } | undefined> {
  return new Promise((resolve) => {
    if (typeof navigator === 'undefined' || !('geolocation' in navigator)) return resolve(undefined)
    const timer = setTimeout(() => resolve(undefined), timeoutMs + 500)
    navigator.geolocation.getCurrentPosition(
      (p) => {
        clearTimeout(timer)
        resolve({ lat: p.coords.latitude, lng: p.coords.longitude })
      },
      () => {
        clearTimeout(timer)
        resolve(undefined)
      },
      { enableHighAccuracy: false, timeout: timeoutMs, maximumAge: 120_000 },
    )
  })
}

// 질문에 앱 자료로 답한다(자료 불러오기 + 검색). 주제를 짐작할 수 없고 모델도 ask를 고르지 않았다면 호출하지 않는다.
export async function answerAsk(question: string, slots: { topic?: string; query?: string }, force: boolean): Promise<AskAnswer | null> {
  const topics = candidateTopics(question, slots.topic)
  if (!topics.length && !force) return null
  const data = await loadKnowledge(topics)
  const origin = topics.some((t) => t !== 'benefit' && t !== 'howto' && t !== 'agency') && wantsNearby(question) ? await getOrigin() : undefined
  return askKnowledge(question, { topic: slots.topic, query: slots.query, data, origin })
}
