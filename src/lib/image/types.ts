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

export type ExposureMode = 'auto' | 'aggressive' | 'manual'

export interface Adjustments {
  exposureMode: ExposureMode
  exposureEV: number
  /** Relative warmth offset (-1..+1, 0 = camera as-shot for RAW / no change for JPEG). */
  wbOffset: number
  /** Hue (green↔magenta) tint, -1..+1, 0 = neutral. */
  hue: number
  crop: NormalizedCrop | null
}

/** "Reset" baseline: 0 EV (manual, no auto), camera WB / no change, no crop. */
export const neutralAdjustments: Adjustments = {
  exposureMode: 'manual',
  exposureEV: 0,
  wbOffset: 0,
  hue: 0,
  crop: null,
}

export type ProcessStatus = 'queued' | 'processing' | 'ready' | 'error'
