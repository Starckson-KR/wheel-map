import { useEffect, useState } from 'react'

// 목록이 처음 보일 때만 순차로 올라오게 한다. 같은 그룹은 한 번 보여 준 뒤로는(탭을 오가거나 스크롤로 다시 들어와도) 반복하지 않는다.
const seen = new Set<string>()
export function useRiseOnce(group: string): boolean {
  const [first] = useState(() => !seen.has(group))
  useEffect(() => {
    seen.add(group)
  }, [group])
  return first
}
