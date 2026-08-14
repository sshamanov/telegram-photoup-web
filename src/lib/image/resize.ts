import type { Rect } from './types'

/** Area-average (box) resize of a single row/column. Downscale only (dstLen <= srcLen). */
function resizeBox1D(src: Float32Array, srcLen: number, dstLen: number): Float32Array {
  const out = new Float32Array(dstLen)
  const scale = srcLen / dstLen
  for (let j = 0; j < dstLen; j++) {
    const a = j * scale
    const b = Math.min((j + 1) * scale, srcLen)
    const i0 = Math.floor(a)
    const i1 = Math.min(Math.floor(b), srcLen - 1)
    let sum = 0
    if (i0 === i1) {
      sum = (b - a) * src[i0]!
    } else {
      sum += (i0 + 1 - a) * src[i0]!
      for (let i = i0 + 1; i < i1; i++) sum += src[i]!
      sum += (b - i1) * src[i1]!
    }
    out[j] = sum / (b - a)
  }
  return out
}

/**
 * Downscale a row-major plane (single channel) from srcW×srcH to dstW×dstH using a
 * separable area-average filter in linear space. Returns the same array when the
 * size is unchanged.
 */
export function downscalePlane(
  plane: Float32Array,
  srcW: number,
  srcH: number,
  dstW: number,
  dstH: number,
): Float32Array {
  if (dstW === srcW && dstH === srcH) return plane

  // Horizontal pass.
  const tmp = new Float32Array(dstW * srcH)
  for (let y = 0; y < srcH; y++) {
    const srcRow = plane.subarray(y * srcW, y * srcW + srcW)
    const outRow = resizeBox1D(srcRow, srcW, dstW)
    tmp.set(outRow, y * dstW)
  }

  // Vertical pass.
  const out = new Float32Array(dstW * dstH)
  const col = new Float32Array(srcH)
  for (let x = 0; x < dstW; x++) {
    for (let y = 0; y < srcH; y++) col[y] = tmp[y * dstW + x]!
    const outCol = resizeBox1D(col, srcH, dstH)
    for (let y = 0; y < dstH; y++) out[y * dstW + x] = outCol[y]!
  }
  return out
}

function extractRect(plane: Float32Array, srcW: number, srcH: number, rect: Rect): Float32Array {
  if (rect.x === 0 && rect.y === 0 && rect.width === srcW && rect.height === srcH) return plane
  const out = new Float32Array(rect.width * rect.height)
  for (let y = 0; y < rect.height; y++) {
    const srcOff = (rect.y + y) * srcW + rect.x
    out.set(plane.subarray(srcOff, srcOff + rect.width), y * rect.width)
  }
  return out
}

/** Downscale a rectangular crop of a plane to dstW×dstH. */
export function downscaleCrop(
  plane: Float32Array,
  srcW: number,
  srcH: number,
  rect: Rect,
  dstW: number,
  dstH: number,
): Float32Array {
  const cropped = extractRect(plane, srcW, srcH, rect)
  return downscalePlane(cropped, rect.width, rect.height, dstW, dstH)
}
