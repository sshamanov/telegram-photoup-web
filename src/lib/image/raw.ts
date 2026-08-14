import LibRaw from 'libraw-wasm/dist/index.js'

/** Camera-WB, sRGB-primaries, LINEAR (gamma-decoded) planar RGB at the decoded resolution. */
export interface DecodedRaw {
  width: number
  height: number
  r: Float32Array
  g: Float32Array
  b: Float32Array
}

// 16-bit sRGB -> linear. 8-bit values are scaled up by 257 to reuse the same LUT.
const SRGB16_TO_LINEAR = (() => {
  const lut = new Float32Array(65536)
  for (let i = 0; i < 65536; i++) {
    const c = i / 65535
    lut[i] = c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)
  }
  return lut
})()

function toLinearPlanar(data: Uint8Array | Uint16Array, width: number, height: number, bits: number): DecodedRaw {
  const n = width * height
  const r = new Float32Array(n)
  const g = new Float32Array(n)
  const b = new Float32Array(n)
  if (bits === 16) {
    const src = data as Uint16Array
    for (let i = 0, j = 0; i < n; i++, j += 3) {
      r[i] = SRGB16_TO_LINEAR[src[j]!]!
      g[i] = SRGB16_TO_LINEAR[src[j + 1]!]!
      b[i] = SRGB16_TO_LINEAR[src[j + 2]!]!
    }
  } else {
    const src = data as Uint8Array
    for (let i = 0, j = 0; i < n; i++, j += 3) {
      r[i] = SRGB16_TO_LINEAR[src[j]! * 257]!
      g[i] = SRGB16_TO_LINEAR[src[j + 1]! * 257]!
      b[i] = SRGB16_TO_LINEAR[src[j + 2]! * 257]!
    }
  }
  return { width, height, r, g, b }
}

/**
 * Decode a camera RAW (NEF/CR2/ARW/DNG) to LINEAR float RGB (camera WB, sRGB
 * primaries). 16-bit output preserves highlight headroom; the sRGB gamma is
 * decoded here so the downstream pipeline works in linear light.
 */
export async function decodeRaw(buffer: ArrayBuffer): Promise<DecodedRaw> {
  const raw = new LibRaw()
  try {
    await raw.open(new Uint8Array(buffer), {
      useCameraWb: true,
      outputColor: 1, // sRGB primaries + gamma
      outputBps: 16,
      noAutoBright: true,
      halfSize: true, // still ≥2560px for D810/4000D; keeps memory bounded
      userQual: 3,
    })
    const image = await raw.imageData()
    if (!image) throw new Error('RAW produced no image data')
    return toLinearPlanar(image.data, image.width, image.height, image.bits)
  } finally {
    raw.dispose()
  }
}
