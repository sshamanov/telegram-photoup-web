import { describe, expect, it } from 'vitest'
import { extractRawCamera, formatCamera } from '../src/lib/image/exif'

describe('formatCamera', () => {
  it('keeps a JPEG model that already carries the maker', () => {
    expect(formatCamera('NIKON CORPORATION', 'NIKON D810')).toBe('NIKON D810')
    expect(formatCamera('Canon', 'Canon EOS 4000D')).toBe('Canon EOS 4000D')
  })

  it('prepends the maker brand when the RAW model was stripped', () => {
    expect(formatCamera('NIKON CORPORATION', 'D810')).toBe('NIKON D810')
    expect(formatCamera('Canon', 'EOS 3000D')).toBe('Canon EOS 3000D')
  })

  it('uses only the first maker token, not the full corporation name', () => {
    expect(formatCamera('NIKON CORPORATION', 'D810')).toBe('NIKON D810')
    expect(formatCamera('Canon Inc.', 'EOS R5')).toBe('Canon EOS R5')
  })

  it('returns the model as-is when no maker is present', () => {
    expect(formatCamera(undefined, 'Some Camera')).toBe('Some Camera')
  })

  it('returns null when there is no model', () => {
    expect(formatCamera('Canon', undefined)).toBeNull()
  })

  it('is case-insensitive for the prefix match', () => {
    expect(formatCamera('NIKON CORPORATION', 'nikon d810')).toBe('nikon d810')
  })
})

describe('extractRawCamera', () => {
  it('reads Make/Model from a little-endian TIFF header', () => {
    const buf = new Uint8Array(64)
    const dv = new DataView(buf.buffer)
    // TIFF header: "II" + 42 + IFD0 offset 8
    buf[0] = 0x49
    buf[1] = 0x49
    dv.setUint16(2, 0x002a, true)
    dv.setUint32(4, 8, true)
    // IFD0: 2 entries
    dv.setUint16(8, 2, true)
    const entry = (base: number, tag: number, count: number, vofs: number) => {
      dv.setUint16(base, tag, true)
      dv.setUint16(base + 2, 2, true) // ASCII
      dv.setUint32(base + 4, count, true)
      dv.setUint32(base + 8, vofs, true)
    }
    entry(10, 0x010f, 17, 34) // Make (16 chars + null)
    entry(22, 0x0110, 11, 51) // Model (10 chars + null)
    new TextEncoder().encodeInto('NIKON CORPORATION\0', buf.subarray(34, 51))
    new TextEncoder().encodeInto('NIKON D810\0', buf.subarray(51, 62))

    expect(extractRawCamera(buf.buffer)).toEqual({ make: 'NIKON CORPORATION', model: 'NIKON D810' })
  })

  it('returns empty for non-TIFF input', () => {
    expect(extractRawCamera(new Uint8Array([1, 2, 3, 4, 5]).buffer)).toEqual({})
  })
})
