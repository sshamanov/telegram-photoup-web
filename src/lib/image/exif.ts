/** Display-oriented EXIF subset. Values are raw; the editor formats them. */
export interface ExifInfo {
  make?: string
  model?: string
  lens?: string
  /** Focal length in mm. */
  focalLength?: number
  /** Exposure time in seconds (e.g. 1/125 → 0.008). */
  shutter?: number
  /** Aperture f-number (e.g. 2.8). */
  aperture?: number
  iso?: number
  /** "YYYY:MM:DD HH:MM:SS" as stored in the file. */
  dateTaken?: string
}

const TYPE_SIZE: Record<number, number> = {
  1: 1, // BYTE
  2: 1, // ASCII
  3: 2, // SHORT
  4: 4, // LONG
  5: 8, // RATIONAL
  7: 1, // UNDEFINED
  10: 8, // SRATIONAL
}

function readAscii(bytes: Uint8Array, o: number, count: number): string {
  let s = ''
  for (let i = 0; i < count; i++) {
    const c = bytes[o + i]!
    if (c === 0) break
    s += String.fromCharCode(c)
  }
  return s.trim()
}

function readRational(dv: DataView, o: number, le: boolean): number {
  const num = dv.getUint32(o, le)
  const den = dv.getUint32(o + 4, le)
  return den === 0 ? 0 : num / den
}

/** Parse a JPEG APP1 "Exif" segment into the fields we display. */
export function extractJpegExif(buffer: ArrayBuffer): ExifInfo | null {
  const bytes = new Uint8Array(buffer)
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return null

  let o = 2
  while (o + 4 <= bytes.length) {
    if (bytes[o] !== 0xff) break
    const marker = bytes[o + 1]!
    if (marker === 0xda || marker === 0xd9) break // SOS / EOI
    const len = (bytes[o + 2]! << 8) | bytes[o + 3]!
    if (marker === 0xe1 && len >= 8) {
      const s = o + 4
      if (
        bytes[s] === 0x45 && bytes[s + 1] === 0x78 && bytes[s + 2] === 0x69 && bytes[s + 3] === 0x66 &&
        bytes[s + 4] === 0x00 && bytes[s + 5] === 0x00
      ) {
        return parseTiff(bytes, s + 6)
      }
    }
    o += 2 + len
  }
  return null
}

function parseTiff(bytes: Uint8Array, tiffStart: number): ExifInfo | null {
  if (tiffStart + 8 > bytes.length) return null
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const le = bytes[tiffStart] === 0x49 && bytes[tiffStart + 1] === 0x49
  if (dv.getUint16(tiffStart + 2, le) !== 0x002a) return null

  const exif: ExifInfo = {}
  const ifd0 = dv.getUint32(tiffStart + 4, le)
  const exifIfd = readIfd0(dv, bytes, tiffStart, ifd0, le, exif)
  if (exifIfd) readExifIfd(dv, bytes, tiffStart, exifIfd, le, exif)
  return Object.keys(exif).length > 0 ? exif : null
}

function readIfd0(
  dv: DataView,
  bytes: Uint8Array,
  base: number,
  offset: number,
  le: boolean,
  exif: ExifInfo,
): number | null {
  if (base + offset + 2 > bytes.length) return null
  const count = dv.getUint16(base + offset, le)
  let exifIfd: number | null = null
  for (let i = 0; i < count; i++) {
    const entry = base + offset + 2 + i * 12
    if (entry + 12 > bytes.length) break
    const tag = dv.getUint16(entry, le)
    const type = dv.getUint16(entry + 2, le)
    const cnt = dv.getUint32(entry + 4, le)
    const size = TYPE_SIZE[type] ?? 1

    if (tag === 0x010f) exif.make = readAscii(bytes, valueAt(dv, entry + 8, type, cnt, size, base, le), Math.min(cnt, 64))
    else if (tag === 0x0110) exif.model = readAscii(bytes, valueAt(dv, entry + 8, type, cnt, size, base, le), Math.min(cnt, 64))
    else if (tag === 0x8769) exifIfd = dv.getUint32(entry + 8, le)
  }
  return exifIfd
}

function readExifIfd(
  dv: DataView,
  bytes: Uint8Array,
  base: number,
  offset: number,
  le: boolean,
  exif: ExifInfo,
): void {
  if (base + offset + 2 > bytes.length) return
  const count = dv.getUint16(base + offset, le)
  for (let i = 0; i < count; i++) {
    const entry = base + offset + 2 + i * 12
    if (entry + 12 > bytes.length) break
    const tag = dv.getUint16(entry, le)
    const type = dv.getUint16(entry + 2, le)
    const cnt = dv.getUint32(entry + 4, le)
    const size = TYPE_SIZE[type] ?? 1

    if (tag === 0x829a) exif.shutter = readRational(dv, valueAt(dv, entry + 8, type, cnt, size, base, le), le)
    else if (tag === 0x829d) exif.aperture = readRational(dv, valueAt(dv, entry + 8, type, cnt, size, base, le), le)
    else if (tag === 0x8827) exif.iso = dv.getUint16(valueAt(dv, entry + 8, type, cnt, size, base, le), le)
    else if (tag === 0x9003) exif.dateTaken = readAscii(bytes, valueAt(dv, entry + 8, type, cnt, size, base, le), Math.min(cnt, 32))
    else if (tag === 0x920a) exif.focalLength = readRational(dv, valueAt(dv, entry + 8, type, cnt, size, base, le), le)
    else if (tag === 0xa434) exif.lens = readAscii(bytes, valueAt(dv, entry + 8, type, cnt, size, base, le), Math.min(cnt, 64))
  }
}

/** Value location: inline in the 4-byte field, or an offset from the TIFF base. */
function valueAt(dv: DataView, field: number, type: number, cnt: number, size: number, base: number, le: boolean): number {
  return size * cnt > 4 ? base + dv.getUint32(field, le) : field
}
