export type SourceType = 'raw' | 'jpeg'

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

export const neutralAdjustments: Adjustments = {
  exposureMode: 'auto',
  exposureEV: 0,
  temperature: 0,
  neutralGains: null,
  crop: null,
}

export type ProcessStatus = 'queued' | 'processing' | 'ready' | 'error'

export interface ProcessRequest {
  id: string
  fileName: string
  sourceType: SourceType
  /** The source file bytes (JPEG only for now; RAW decode is spiked separately). */
  buffer: ArrayBuffer
  adjustments: Adjustments
}

export interface ProcessResult {
  id: string
  thumbnailBlob: Blob
  outputBlob: Blob
  width: number
  height: number
  autoEV: number
  status: 'ready'
  error?: undefined
}

export interface ProcessError {
  id: string
  status: 'error'
  error: string
}
