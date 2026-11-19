// 날씨 화면 모델(순수 함수). 공급자(기상청, worker/src/weatherCore.ts)가 준 값에서 화면 문구와 주의를 정한다.
// 화면 문구는 모두 여기 고정돼 있다. 공식 용어(폭염·특보 등)는 기상특보 자료 없이 쓰지 않는다.

export type Condition = 'clear' | 'cloudy' | 'overcast' | 'rain' | 'sleet' | 'snow'
export type WeatherNow = { tempC: number; condition: Condition | null }

export const AREA_NAME = '용봉동'

export const CONDITION_LABEL: Record<Condition, string> = {
  clear: '맑음',
  cloudy: '구름 많음',
  overcast: '흐림',
  rain: '비',
  sleet: '비·눈',
  snow: '눈',
}

// 기온이 높다고 알릴 기준(현재 기온 33℃ 이상).
// 근거: 기상청 폭염주의보는 「일 최고 체감온도 33℃ 이상이 2일 이상 지속될 것으로 예상될 때」 발표한다(환경보건포털 https://www.ehtis.or.kr/cmn/sym/mnu/mpm/60001251/htmlMenuView.do).
// 우리는 특보 자료가 없고 지금 기온만 알기 때문에 「폭염」이라 부르지 않고, 같은 숫자를 참고 기준으로 삼아 「기온이 높아요」라고만 쓴다.
export const HIGH_TEMP_C = 33

export type AdvisoryKind = 'rain' | 'snow' | 'hot'
export type Advisory = { kind: AdvisoryKind; icon: string; text: string }

export function advisoryOf(w: WeatherNow): Advisory | null {
  if (w.condition === 'rain') return { kind: 'rain', icon: 'rain', text: '비가 와요. 경사로와 횡단보도가 미끄러울 수 있어요' }
  if (w.condition === 'snow' || w.condition === 'sleet') return { kind: 'snow', icon: 'snow', text: '눈이 와요. 경사로와 길이 미끄러울 수 있어요' }
  if (w.tempC >= HIGH_TEMP_C) return { kind: 'hot', icon: 'thermo', text: '기온이 높아요. 이동 중에는 그늘에서 쉬어 가세요' }
  return null
}

export const isWet = (w: WeatherNow) => w.condition === 'rain' || w.condition === 'snow' || w.condition === 'sleet'

export function iconOf(c: Condition | null): string {
  if (c === 'clear') return 'sun'
  if (c === 'rain' || c === 'sleet') return 'rain'
  if (c === 'snow') return 'snow'
  return 'cloud'
}

export const tempText = (w: WeatherNow) => `${w.tempC}°`

// 홈 머리줄: 「용봉동 18° 맑음」, 비·눈이면 뒤에 한 문장
export function headline(w: WeatherNow): { main: string; extra: string | null } {
  const main = `${AREA_NAME} ${tempText(w)}${w.condition ? ` ${CONDITION_LABEL[w.condition]}` : ''}`
  return { main, extra: isWet(w) ? '경사로가 미끄러울 수 있어요' : null }
}

// 시연 도구: 실제 / 비 / 눈 / 더움
export type DemoWeather = 'real' | 'rain' | 'snow' | 'hot'
export const DEMO_WEATHER_LABEL: Record<DemoWeather, string> = { real: '실제', rain: '비', snow: '눈', hot: '더움' }
export const DEMO_WEATHER_ORDER: DemoWeather[] = ['real', 'rain', 'snow', 'hot']
export const DEMO_VALUES: Record<Exclude<DemoWeather, 'real'>, WeatherNow> = {
  rain: { tempC: 14, condition: 'rain' },
  snow: { tempC: -1, condition: 'snow' },
  hot: { tempC: 35, condition: 'clear' },
}
export const isDemoWeather = (v: unknown): v is DemoWeather => typeof v === 'string' && (DEMO_WEATHER_ORDER as string[]).includes(v)

// 날씨 카드(AI 검색 답) 문구
export function cardLines(w: WeatherNow): { title: string; sub: string | null } {
  const h = headline(w)
  return { title: h.main, sub: advisoryOf(w)?.text ?? null }
}

// 중계 응답을 믿지 않고 다시 검증한다.
export function parseWeather(body: unknown): WeatherNow | null {
  if (!body || typeof body !== 'object') return null
  const b = body as Record<string, unknown>
  if (b.ok !== true || typeof b.tempC !== 'number' || !Number.isFinite(b.tempC) || b.tempC < -60 || b.tempC > 60) return null
  const c = typeof b.condition === 'string' && b.condition in CONDITION_LABEL ? (b.condition as Condition) : null
  return { tempC: Math.round(b.tempC), condition: c }
}
