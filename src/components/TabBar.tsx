import { m } from 'motion/react'
import Icon from './Icon'
import { SPRING } from '../lib/motionTokens'
import { go, type PageId } from '../lib/nav'
import { TAB_ITEMS } from '../lib/tabs'

// 모바일은 아래 고정, PC는 위쪽 내비게이션(CSS가 정한다). 가운데 [제보]는 탭 바 위로 솟은 원형 버튼(PC에서는 강조 버튼).
export default function TabBar({ page }: { page: PageId }) {
  return (
    <nav className="tabbar" aria-label="주요 메뉴">
      {TAB_ITEMS.map((t) =>
        t.fab ? (
          <button key={t.page} type="button" className="tabbar-btn tabbar-fab" aria-current={page === t.page ? 'page' : undefined} aria-label="제보하기" onClick={() => go(t.to)}>
            <span className="tabbar-fab-c" aria-hidden="true">
              <Icon name={t.icon} size={22} />
              <span>{t.label}</span>
            </span>
          </button>
        ) : (
          <button key={t.page} type="button" className="tabbar-btn" aria-current={page === t.page ? 'page' : undefined} aria-label={t.label} onClick={() => go(t.to)}>
            {page === t.page && <m.span layoutId="tabbar-ind" className="tabbar-ind" transition={SPRING.quick} aria-hidden="true" />}
            <Icon name={t.icon} size={22} />
            <span>{t.label}</span>
          </button>
        ),
      )}
    </nav>
  )
}
