export type SourceType = 'raw' | 'jpeg'

export interface Rect {
  x: number
  y: number
  width: number
  height: number
}

export interface Size {
  width: number
  height: number
}

/** Crop in normalized source coordinates (0..1), orientation-independent. */
export interface NormalizedCrop {
  x: number
  y: number
  width: number
  height: number
}

export interface WbGains {
  r: number
  g: number
  b: number
}

export type ExposureMode = 'auto' | 'manual'

export interface Adjustments {
  exposureMode: ExposureMode
  exposureEV: number
  /** RAW-only: relative temperature (-1..1, warm = +). */
  temperature: number
  /** RAW-only: neutral-picker channel gains (1 = neutral). */
  neutralGains: WbGains | null
  crop: NormalizedCrop | null
}

/** "Reset" baseline: 0 EV (manual), camera WB, no crop. */
export const neutralAdjustments: Adjustments = {
  exposureMode: 'manual',
  exposureEV: 0,
  temperature: 0,
  neutralGains: null,
  crop: null,
}

export type ProcessStatus = 'queued' | 'processing' | 'ready' | 'error'
