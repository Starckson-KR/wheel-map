import agenciesData from '../../data/seed/agencies.json'

const NAMES = new Map((agenciesData as { id: string; name: string }[]).map((a) => [a.id, a.name]))
export const findAgencyName = (id: string) => NAMES.get(id) ?? id
