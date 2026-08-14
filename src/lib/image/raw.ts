import LibRaw from 'libraw-wasm/dist/index.js'

export interface DecodedRaw {
  width: number
  height: number
  rgba: Uint8ClampedArray<ArrayBuffer>
}

function toRgba(data: Uint8Array | Uint16Array, width: number, height: number, bits: number): Uint8ClampedArray<ArrayBuffer> {
  const out = new Uint8ClampedArray(width * height * 4)
  if (bits === 8) {
    const src = data as Uint8Array
    for (let i = 0, j = 0; i < width * height * 3; i += 3, j += 4) {
      out[j] = src[i]!
      out[j + 1] = src[i + 1]!
      out[j + 2] = src[i + 2]!
      out[j + 3] = 255
    }
  } else {
    const src = data as Uint16Array
    for (let i = 0, j = 0; i < width * height * 3; i += 3, j += 4) {
      out[j] = src[i]! >> 8
      out[j + 1] = src[i + 1]! >> 8
      out[j + 2] = src[i + 2]! >> 8
      out[j + 3] = 255
    }
  }
  return out
}

/**
 * Decode a camera RAW (NEF/CR2/ARW/DNG) to 8-bit sRGB RGBA.
 * Uses the camera's recorded white balance and disables LibRaw's auto-brightness —
 * exposure is computed by our own pipeline.
 */
export async function decodeRaw(buffer: ArrayBuffer): Promise<DecodedRaw> {
  const raw = new LibRaw()
  try {
    await raw.open(new Uint8Array(buffer), {
      useCameraWb: true,
      outputColor: 1, // sRGB
      outputBps: 16,
      noAutoBright: true,
      halfSize: true, // still ≥2560px for D810/4000D; keeps memory bounded
      userQual: 3,
    })
    const image = await raw.imageData()
    if (!image) throw new Error('RAW produced no image data')
    return {
      width: image.width,
      height: image.height,
      rgba: toRgba(image.data, image.width, image.height, image.bits),
    }
  } finally {
    raw.dispose()
  }
}
