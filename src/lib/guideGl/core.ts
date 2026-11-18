// 길 안내 새 지도(MapLibre) 시험판의 순수 계산. 브라우저·지도 라이브러리를 부르지 않아 Node 테스트로 확인한다.
import type { Pt } from '../routing/engine.ts'

/** OpenFreeMap 기본 스타일(키·가입 없음). 라벨은 아래 koreanizeStyle로 한글 우선으로 바꿔 쓴다. */
export const GL_STYLE_URL = 'https://tiles.openfreemap.org/styles/liberty'

/**
 * 시험판을 켤지: 개발 서버이거나 주소에 navmap=gl이 있을 때만(navmap=off면 개발 서버에서도 끈다).
 * 주소는 해시 라우터라 ?navmap=gl이 해시 안에 있을 수도 있어 둘 다 본다.
 */
export function glNavEnabled(dev: boolean, search: string, hash: string): boolean {
  const q = new URLSearchParams(search)
  const hq = hash.includes('?') ? new URLSearchParams(hash.slice(hash.indexOf('?') + 1)) : new URLSearchParams()
  const v = q.get('navmap') ?? hq.get('navmap')
  if (v === 'off') return false
  return dev || v === 'gl'
}

type Layer = { id?: string; type?: string; layout?: Record<string, unknown> }
type StyleLike = { layers?: Layer[] }

const KO_LABEL = ['coalesce', ['get', 'name:ko'], ['get', 'name']]

/**
 * 스타일의 지명 글자(text-field)가 `name:ko`를 먼저, 없으면 `name`을 쓰게 바꾼다.
 * OpenFreeMap 기본 스타일은 name_en(영문) 우선이라 한글 지명이 밀린다. 식 `coalesce`는 첫 번째 null이 아닌 값을 쓴다(MapLibre style spec).
 * 도로 번호(ref)처럼 이름이 아닌 라벨은 건드리지 않는다. 받은 스타일은 바꾸지 않고 복사본을 돌려준다.
 */
export function koreanizeStyle<T extends StyleLike>(style: T): T {
  const copy = structuredClone(style)
  for (const l of copy.layers ?? []) {
    const tf = l.layout?.['text-field']
    if (tf !== undefined && JSON.stringify(tf).includes('"name')) l.layout!['text-field'] = structuredClone(KO_LABEL)
  }
  return copy
}

/** 첫 번째 글자(symbol) 레이어의 id: 경로선을 그 아래(길 위, 글자 아래)에 깔 때 쓴다. 없으면 undefined */
export function firstSymbolId(style: StyleLike): string | undefined {
  return style.layers?.find((l) => l.type === 'symbol')?.id
}

/** 카카오·경로 좌표 [lat,lng] → MapLibre 좌표 [lng,lat] (두 라이브러리의 순서가 반대다) */
export const toLngLat = (p: Pt): [number, number] => [p[1], p[0]]

const M_LAT = 111320
const norm360 = (d: number) => ((d % 360) + 360) % 360

/** a에서 b를 본 방위(북=0, 시계 방향 0~360) */
export function bearingOf(a: Pt, b: Pt): number {
  const dy = (b[0] - a[0]) * M_LAT
  const dx = (b[1] - a[1]) * M_LAT * Math.cos((a[0] * Math.PI) / 180)
  return norm360((Math.atan2(dx, dy) * 180) / Math.PI)
}

/**
 * 경로 path 위에서 from에 가장 가까운 점을 찾고, 거기서 경로를 따라 lookM(m) 앞으로 간 점을 향한 방위를 돌려준다.
 * 지도를 "가는 방향이 위"로 돌릴 때 나침반이 없으면 이 값을 쓴다. 경로가 한 점뿐이거나 끝에 닿았으면 마지막 구간의 방향, 점이 없으면 null.
 */
export function bearingAhead(path: Pt[], from: Pt, lookM = 25): number | null {
  if (path.length < 2) return null
  const cos = Math.cos((from[0] * Math.PI) / 180)
  const xy = path.map((p) => [(p[1] - from[1]) * M_LAT * cos, (p[0] - from[0]) * M_LAT] as const)
  // 가장 가까운 구간과 그 위의 점
  let best = { i: 0, t: 0, d: Infinity }
  for (let i = 0; i < xy.length - 1; i++) {
    const [ax, ay] = xy[i]
    const [bx, by] = xy[i + 1]
    const dx = bx - ax
    const dy = by - ay
    const len2 = dx * dx + dy * dy
    const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, -(ax * dx + ay * dy) / len2))
    const d = Math.hypot(ax + t * dx, ay + t * dy)
    if (d < best.d) best = { i, t, d }
  }
  const sx = xy[best.i][0] + best.t * (xy[best.i + 1][0] - xy[best.i][0])
  const sy = xy[best.i][1] + best.t * (xy[best.i + 1][1] - xy[best.i][1])
  // 그 점에서 lookM 앞
  let left = lookM
  let cx = sx
  let cy = sy
  for (let i = best.i + 1; i < xy.length && left > 0; i++) {
    const seg = Math.hypot(xy[i][0] - cx, xy[i][1] - cy)
    if (seg >= left) {
      const k = left / seg
      cx += (xy[i][0] - cx) * k
      cy += (xy[i][1] - cy) * k
      left = 0
    } else {
      cx = xy[i][0]
      cy = xy[i][1]
      left -= seg
    }
  }
  if (Math.hypot(cx - sx, cy - sy) < 0.5) {
    // 끝에 닿았다: 마지막 구간 방향
    const [ax, ay] = xy[xy.length - 2]
    const [bx, by] = xy[xy.length - 1]
    return norm360((Math.atan2(bx - ax, by - ay) * 180) / Math.PI)
  }
  return norm360((Math.atan2(cx - sx, cy - sy) * 180) / Math.PI)
}

/**
 * 내 위치를 보이는 영역의 어디에 둘지(진행 방향 위 모드는 앞이 더 보이게 아래쪽 70%).
 * MapLibre의 padding(지도 중심을 가린 부분 안쪽으로 옮기는 값)으로 바꾼다. 보이는 영역 = 전체에서 위·아래·왼쪽 가림을 뺀 곳.
 */
export function followPadding(h: number, ins: { top: number; bottom: number; left: number }, headUp: boolean) {
  const vis = Math.max(0, h - ins.top - ins.bottom)
  return { top: Math.round(ins.top + (headUp ? vis * 0.4 : 0)), bottom: Math.round(ins.bottom), left: Math.round(ins.left), right: 0 }
}
