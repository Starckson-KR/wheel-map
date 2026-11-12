import data from '../../data/benefits/benefits.json'
import type { Benefit } from './benefits'

export const BENEFITS = (data as unknown as { items: Benefit[] }).items
export const BENEFITS_CHECKED_AT = (data as { checkedAt: string }).checkedAt
