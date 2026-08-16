import { describe, expect, it } from 'vitest'
import { cleanModel } from '../src/lib/image/exif'

describe('cleanModel', () => {
  it('strips the leading maker token from Nikon models', () => {
    expect(cleanModel('NIKON D810', 'NIKON CORPORATION')).toBe('D810')
  })

  it('strips the leading maker token from Canon models', () => {
    expect(cleanModel('Canon EOS 4000D', 'Canon')).toBe('EOS 4000D')
  })

  it('leaves models without a maker prefix unchanged', () => {
    expect(cleanModel('X-T4', 'FUJIFILM')).toBe('X-T4')
  })

  it('returns the model as-is when no maker is present', () => {
    expect(cleanModel('Some Camera')).toBe('Some Camera')
  })

  it('is case-insensitive for the prefix match', () => {
    expect(cleanModel('nikon d810', 'NIKON CORPORATION')).toBe('d810')
  })
})
