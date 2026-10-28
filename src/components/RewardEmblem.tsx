import type { EmblemDef } from '../lib/rewards'

// 엠블럼 그림 한 곳. 7.5단계에서 시안으로 바꿀 때 이 파일만 고치면 된다(지금은 이모지+CSS 도형, 외부 이미지 없음).
type Props = { def: EmblemDef; earned?: boolean; size?: 'sm' | 'md' | 'lg' }

export default function RewardEmblem({ def, earned = true, size = 'md' }: Props) {
  return (
    <span className={`emb emb-${size} emb-${def.tone}${earned ? '' : ' is-locked'}`} role="img" aria-label={`${def.name} 엠블럼${earned ? '' : ' (아직 받지 못했어요)'}`}>
      <span aria-hidden="true">{earned ? def.glyph : '🔒'}</span>
    </span>
  )
}
