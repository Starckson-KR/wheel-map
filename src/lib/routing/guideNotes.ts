// 길 안내 카드의 주의 안내를 한 줄로 줄인다. 한 구간에 제보가 많으면 줄이 지도를 다 덮기 때문이다.
// 이름 끝의 「(시민 제보)」 같은 괄호 설명은 떼고, 같은 유형끼리 세어 많은 순으로 두 가지만 보여 준다.
export function summarizeNear(names: string[]): string | null {
  if (names.length === 0) return null
  const counts = new Map<string, number>()
  for (const raw of names) {
    const name = raw.replace(/\s*\([^)]*\)\s*$/, '').trim() || raw
    counts.set(name, (counts.get(name) ?? 0) + 1)
  }
  const kinds = [...counts.entries()].sort((a, b) => b[1] - a[1])
  if (names.length === 1) return `이 근처에 ${kinds[0][0]}`
  const top = kinds.slice(0, 2).map(([name, n]) => `${name} ${n}`)
  return `주의 ${names.length}곳 · ${top.join(' · ')}${kinds.length > 2 ? ' 외' : ''}`
}

export function summarizeAvoid(names: string[]): string | null {
  if (names.length === 0) return null
  if (names.length === 1) return `${names[0].replace(/\s*\([^)]*\)\s*$/, '').trim() || names[0]} 때문에 돌아가요`
  return `${names.length}곳을 피해 돌아가요`
}

/** 이름 끝의 괄호 설명(「(시민 제보)」 등)을 뗀다 */
export function bareName(raw: string): string {
  const cut = raw.lastIndexOf('(')
  if (cut <= 0 || !raw.trimEnd().endsWith(')')) return raw
  return raw.slice(0, cut).trim() || raw
}

// 받침이 있으면 「을」, 없으면 「를」. 한글로 끝나지 않으면 둘 다 적는다.
function eul(word: string): string {
  const c = word.charCodeAt(word.length - 1)
  if (c < 0xac00 || c > 0xd7a3) return '을(를)'
  return (c - 0xac00) % 28 === 0 ? '를' : '을'
}

/**
 * 결과 시트의 「돌아가는 까닭」 한 줄. 같은 종류면 종류와 개수, 섞여 있으면 개수만 쓴다.
 * extra: 가장 짧은 길보다 더 걷는 거리(이미 글자로 바꾼 값). 없으면 거리를 빼고 쓴다.
 */
export function detourLine(names: string[], extra: string | null): string | null {
  if (names.length === 0) return null
  const kinds = [...new Set(names.map(bareName))]
  const what = names.length === 1 ? `${kinds[0]}${eul(kinds[0])}` : kinds.length === 1 ? `${kinds[0]} ${names.length}곳을` : `${names.length}곳을`
  return `${what} 피해 ${extra ? `${extra} ` : ''}돌아가요`
}
