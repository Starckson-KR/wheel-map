import { createElement, Fragment, type HTMLAttributes } from 'react'
import { splitSentences, tidyBreaks } from '../lib/sentences'

type Props = Omit<HTMLAttributes<HTMLElement>, 'children'> & {
  children: string | null | undefined | false
  as?: 'p' | 'span' | 'div'
}

// 여러 문장으로 된 설명 글: 문장이 끝나면 다음 문장은 새 줄에서 시작한다.
// 문장 사이에 공백 글자를 남겨 스크린리더·복사에는 원문 그대로 읽힌다.
export function Sentences({ children, as = 'p', ...rest }: Props) {
  const text = children || ''
  const parts = splitSentences(text)
  if (parts.length <= 1) return createElement(as, rest, tidyBreaks(text))
  return createElement(
    as,
    rest,
    parts.map((s, i) => (
      <Fragment key={i}>
        {i > 0 ? ' ' : null}
        <span className="sent">{tidyBreaks(s)}</span>
      </Fragment>
    )),
  )
}
