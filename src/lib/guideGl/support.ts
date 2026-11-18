// WebGL을 쓸 수 있는지(MapLibre는 WebGL이 필요하다). 못 쓰면 시험판을 켜지 않고 카카오 지도를 그대로 쓴다.
export function webglOk(): boolean {
  try {
    const c = document.createElement('canvas')
    return !!(c.getContext('webgl2') || c.getContext('webgl'))
  } catch {
    return false
  }
}
