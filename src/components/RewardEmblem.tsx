import type { EmblemDef } from '../lib/rewards'
import Icon from './Icon'

// 엠블럼 그림 한 곳. 그림은 Icon.tsx의 선 아이콘(직접 그린 것)이고, 색은 rewards.css의 톤을 따른다.
type Props = { def: EmblemDef; earned?: boolean; size?: 'sm' | 'md' | 'lg' }

export const EMBLEM_ICON_SIZE = { sm: 18, md: 26, lg: 36 } as const

export default function RewardEmblem({ def, earned = true, size = 'md' }: Props) {
  return (
    <span className={`emb emb-${size} emb-${def.tone}${earned ? '' : ' is-locked'}`} role="img" aria-label={`${def.name} 엠블럼${earned ? '' : ' (아직 받지 못했어요)'}`}>
      <Icon name={earned ? def.icon : 'lock'} size={EMBLEM_ICON_SIZE[size]} />
    </span>
  )
}
