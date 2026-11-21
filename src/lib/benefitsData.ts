import data from '../../data/benefits/benefits.json'
import type { Benefit } from './benefits'

export const BENEFITS = (data as unknown as { items: Benefit[] }).items
