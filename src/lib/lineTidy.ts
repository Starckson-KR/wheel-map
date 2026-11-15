import { tidyBreaks } from './sentences'

// 앱 전체 글자에 줄바꿈 다듬기(sentences.ts의 tidyBreaks)를 적용한다.
// "할 수", "11만 원"처럼 붙어야 할 말이 줄 사이에서 갈리지 않게 보이지 않는 글자만 더한다. 글자 내용·저장값은 바뀌지 않는다.
const SKIP = new Set(['SCRIPT', 'STYLE', 'TEXTAREA', 'INPUT', 'NOSCRIPT', 'CODE', 'PRE'])

function fix(node: Node) {
  if (node.nodeType === Node.TEXT_NODE) {
    const p = node.parentElement
    if (!p || SKIP.has(p.tagName) || p.isContentEditable) return
    const v = node.nodeValue ?? ''
    const t = tidyBreaks(v)
    if (t !== v) node.nodeValue = t
    return
  }
  if (node.nodeType !== Node.ELEMENT_NODE) return
  if (SKIP.has((node as Element).tagName)) return
  const w = document.createTreeWalker(node, NodeFilter.SHOW_TEXT)
  let n: Node | null
  while ((n = w.nextNode())) fix(n)
}

export function installLineTidy(root: HTMLElement | null) {
  if (!root || typeof MutationObserver === 'undefined') return
  const queue = new Set<Node>()
  let scheduled = false
  const flush = () => {
    scheduled = false
    for (const n of queue) if (n.isConnected) fix(n)
    queue.clear()
  }
  const mo = new MutationObserver((list) => {
    for (const m of list) {
      if (m.type === 'characterData') queue.add(m.target)
      else m.addedNodes.forEach((n) => queue.add(n))
    }
    if (!scheduled && queue.size) {
      scheduled = true
      requestAnimationFrame(flush)
    }
  })
  mo.observe(root, { childList: true, subtree: true, characterData: true })
  queue.add(root)
  requestAnimationFrame(flush)
}
