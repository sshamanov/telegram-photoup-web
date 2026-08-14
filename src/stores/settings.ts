import { persisted } from './persisted'
import type { ExportFormat } from '../lib/image/types'

export interface Settings {
  targetGroupId: string | null
  exportEdge: number
  format: ExportFormat
}

export const settings = persisted<Settings>('photoup.settings', {
  targetGroupId: null,
  exportEdge: 2560,
  format: 'jpeg',
})
