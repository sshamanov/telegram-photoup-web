import { persisted } from './persisted'

export interface Settings {
  targetGroupId: string | null
  exportEdge: number
}

export const settings = persisted<Settings>('photoup.settings', {
  targetGroupId: null,
  exportEdge: 2560,
})
