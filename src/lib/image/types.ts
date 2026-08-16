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
  /** RAW-only: color temperature in Kelvin (2500..10000, neutral 5500). */
  temperature: number
  /** JPEG-only: relative warmth (-1..+1, 0 = no change). No Kelvin reference on JPEG. */
  wbOffset: number
  /** Neutral-picker channel gains (1 = neutral); null = camera WB (RAW) / none (JPEG). */
  neutralGains: WbGains | null
  crop: NormalizedCrop | null
}

/** "Reset" baseline: 0 EV (manual), camera WB, no crop. */
export const neutralAdjustments: Adjustments = {
  exposureMode: 'manual',
  exposureEV: 0,
  temperature: 5500,
  wbOffset: 0,
  neutralGains: null,
  crop: null,
}

export type ProcessStatus = 'queued' | 'processing' | 'ready' | 'error'
