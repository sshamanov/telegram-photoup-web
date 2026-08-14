import { TelegramClient } from '@mtcute/web'
import { processImage } from './lib/image/process'
import { neutralAdjustments } from './lib/image/types'

export interface DownloadedPhoto {
  caption: string
  base64: string
  width: number
  height: number
  date: number
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = ''
  const chunk = 0x8000
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk))
  }
  return btoa(binary)
}

function captionFor(name: string): string {
  if (name === 'png') return 'PNG (lossless)'
  const m = /^jpeg(444|420)-q(\d+)$/.exec(name)
  if (m) return `JPEG ${m[1] === '444' ? '4:4:4' : '4:2:0'} Q${m[2]}`
  return name
}

function client(): TelegramClient {
  const session = localStorage.getItem('session') ?? ''
  const apiId = Number(localStorage.getItem('telegram.apiId') ?? '0')
  const apiHash = localStorage.getItem('telegram.apiHash') ?? ''
  return new TelegramClient({ apiId, apiHash, storage: 'photoup-debug' })
}

export async function downloadPhotos(chatId: string, limit: number): Promise<DownloadedPhoto[]> {
  const c = client()
  await c.importSession(localStorage.getItem('session') ?? '', true)
  const history = await c.getHistory(chatId === 'me' ? 'me' : Number(chatId), { limit })
  const out: DownloadedPhoto[] = []
  for (const msg of history) {
    if (msg.media?.type !== 'photo') continue
    const buf = await c.downloadAsBuffer(msg.media)
    const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf)
    out.push({
      caption: msg.text ?? '',
      base64: bytesToBase64(bytes),
      width: msg.media.width,
      height: msg.media.height,
      date: Math.floor(msg.date.getTime() / 1000),
    })
  }
  return out
}

export async function runExperiment(samplePath: string, chatId: string): Promise<DownloadedPhoto[]> {
  const c = client()
  await c.importSession(localStorage.getItem('session') ?? '', true)

  const adjustments = { ...neutralAdjustments, exposureMode: 'auto' as const }
  const buf = await (await fetch(samplePath)).arrayBuffer()
  const out = await processImage(buf, 'jpeg', adjustments)

  for (const v of out.outputs) {
    const isPng = v.name === 'png'
    await c.sendMedia(
      chatId === 'me' ? 'me' : Number(chatId),
      {
        type: 'photo',
        file: new File([v.blob], `exp_${v.name}`, { type: isPng ? 'image/png' : 'image/jpeg' }),
        fileName: `exp_${v.name}`,
        fileMime: isPng ? 'image/png' : 'image/jpeg',
        fileSize: v.blob.size,
      },
      { caption: captionFor(v.name) },
    )
  }

  await new Promise((r) => setTimeout(r, 2500))

  const history = await c.getHistory(chatId === 'me' ? 'me' : Number(chatId), { limit: 12 })
  const result: DownloadedPhoto[] = []
  for (const msg of history) {
    if (msg.media?.type !== 'photo') continue
    const b = await c.downloadAsBuffer(msg.media)
    const bytes = b instanceof Uint8Array ? b : new Uint8Array(b)
    result.push({
      caption: msg.text ?? '',
      base64: bytesToBase64(bytes),
      width: msg.media.width,
      height: msg.media.height,
      date: Math.floor(msg.date.getTime() / 1000),
    })
  }
  return result
}
