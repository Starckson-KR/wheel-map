// 시간 제한이 있는 fetch. 제한을 넘으면 AbortController로 끊고 네트워크 실패와 같은 예외(AbortError)를 던진다.
// 호출하는 쪽의 기존 try/catch가 그대로 실패 경로로 처리한다. 제한은 응답 헤더가 올 때까지 적용하고, 오면 해제한다.
export async function fetchWithTimeout(input: RequestInfo | URL, init: RequestInit = {}, ms: number): Promise<Response> {
  const ctl = new AbortController()
  const outer = init.signal
  if (outer) {
    if (outer.aborted) ctl.abort()
    else outer.addEventListener('abort', () => ctl.abort(), { once: true })
  }
  const timer = setTimeout(() => ctl.abort(), ms)
  try {
    return await fetch(input, { ...init, signal: ctl.signal })
  } finally {
    clearTimeout(timer)
  }
}

export const ACCOUNT_TIMEOUT_MS = 10_000
// 사진 올리기는 응답 헤더가 업로드가 끝난 뒤에 오므로 느린 망을 생각해 길게 둔다.
export const UPLOAD_TIMEOUT_MS = 30_000
export const RELAY_TIMEOUT_MS = 8_000
