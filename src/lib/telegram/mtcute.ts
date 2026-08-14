import { TelegramClient, type Chat, type User } from '@mtcute/web'
import type { Dialog, UploadPhoto } from '../../types/telegram'
import type { TelegramAdapter } from './adapter'
import { getTelegramApiCredentials } from './adapter'
import { debugLog } from '../debug'

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function isPasswordRequired(error: unknown): boolean {
  return errorMessage(error).includes('SESSION_PASSWORD_NEEDED')
}

function mapPeer(peer: Chat | User): Dialog {
  if (peer.type === 'user') {
    return {
      id: String(peer.id),
      title: peer.displayName,
      kind: 'chat',
      subtitle: peer.username ? `@${peer.username}` : 'Direct chat',
      username: peer.username ?? null,
    }
  }

  const subtitle =
    peer.chatType === 'channel' ? 'Channel' : peer.chatType === 'supergroup' ? 'Supergroup' : 'Group'

  return {
    id: String(peer.id),
    title: peer.displayName,
    kind: peer.chatType === 'channel' ? 'channel' : 'group',
    subtitle,
    username: peer.username ?? null,
  }
}

class MtcuteTelegramAdapter implements TelegramAdapter {
  private session: string | null = localStorage.getItem('session')
  private client: TelegramClient | null = null
  private qrAbortController: AbortController | null = null

  private createClient(): TelegramClient {
    const { apiId, apiHash } = getTelegramApiCredentials()
    if (!apiId || !apiHash) {
      throw new Error('API ID and API Hash are required')
    }
    this.client = new TelegramClient({
      apiId: Number(apiId),
      apiHash,
      storage: 'photoup-session',
    })
    return this.client
  }

  private getClient(): TelegramClient {
    return this.client ?? this.createClient()
  }

  private async exportSession(): Promise<string | null> {
    const client = this.getClient()
    this.session = await client.exportSession()
    localStorage.setItem('session', this.session ?? '')
    return this.session
  }

  async sendCode(phone: string): Promise<{ phoneCodeHash: string }> {
    const client = this.getClient()
    localStorage.setItem('phone', phone)
    const result = await client.sendCode({ phone })
    if (!('phoneCodeHash' in result)) {
      await this.exportSession()
      return { phoneCodeHash: '' }
    }
    return { phoneCodeHash: result.phoneCodeHash }
  }

  async signIn(phone: string, code: string, hash: string): Promise<'ok' | '2fa_required'> {
    const client = this.getClient()
    try {
      await client.signIn({ phone, phoneCode: code, phoneCodeHash: hash })
      await this.exportSession()
      return 'ok'
    } catch (error) {
      if (isPasswordRequired(error)) {
        return '2fa_required'
      }
      throw error
    }
  }

  async signIn2FA(password: string): Promise<void> {
    const client = this.getClient()
    await client.checkPassword(password)
    await this.exportSession()
  }

  async *startQRLogin(onPasswordRequired: () => Promise<string>): AsyncIterable<{ token: string; expires: number }> {
    const client = this.getClient()
    const events: Array<{ token: string; expires: number }> = []
    let notify: (() => void) | null = null
    let finished = false
    let thrown: unknown = null

    this.qrAbortController?.abort()
    this.qrAbortController = new AbortController()

    void client
      .signInQr({
        abortSignal: this.qrAbortController.signal,
        onUrlUpdated: (url, expires) => {
          events.push({ token: url, expires: expires.getTime() })
          debugLog('qr:token', { expires: expires.getTime() })
          notify?.()
        },
        password: onPasswordRequired,
      })
      .then(async () => {
        debugLog('qr:resolved')
        await this.exportSession()
        finished = true
        notify?.()
      })
      .catch((error: unknown) => {
        debugLog('qr:rejected', error)
        if (this.qrAbortController?.signal.aborted) {
          finished = true
        } else {
          thrown = error
        }
        notify?.()
      })

    while (!finished || events.length > 0) {
      if (events.length === 0) {
        await new Promise<void>((resolve) => {
          notify = resolve
        })
        notify = null
      }
      while (events.length > 0) {
        const next = events.shift()
        if (next) yield next
      }
      if (thrown) throw thrown
    }
  }

  async reconnect(session: string): Promise<boolean> {
    try {
      const client = this.createClient()
      await client.importSession(session, true)
      await client.getMe()
      this.session = session
      return true
    } catch (error) {
      debugLog('reconnect:failed', error)
      this.session = null
      return false
    }
  }

  async logout(): Promise<void> {
    const client = this.getClient()
    await client.logOut()
    this.session = null
    localStorage.removeItem('session')
  }

  getSession(): string | null {
    return this.session
  }

  async getDialogs(opts?: { limit?: number }): Promise<Dialog[]> {
    const client = this.getClient()
    const dialogs: Dialog[] = []
    const seen = new Set<string>()

    for await (const dialog of client.iterDialogs({ limit: opts?.limit ?? 100 })) {
      const mapped = mapPeer(dialog.peer)
      if (seen.has(mapped.id)) continue
      seen.add(mapped.id)
      dialogs.push(mapped)
    }

    return dialogs
  }

  async sendPhotos(
    dialogId: string,
    photos: UploadPhoto[],
    onProgress?: (progress: number) => void,
  ): Promise<void> {
    const client = this.getClient()
    const chatId = dialogId === 'me' ? 'me' : Number(dialogId)

    const media = photos.map((photo) => ({
      type: 'photo' as const,
      file: new File([photo.file], photo.fileName, { type: 'image/jpeg' }),
      fileName: photo.fileName,
      fileMime: 'image/jpeg',
      fileSize: photo.file.size,
    }))

    if (media.length === 0) return

    if (media.length === 1) {
      await client.sendMedia(chatId, media[0]!, {
        progressCallback: (uploaded, total) => {
          onProgress?.(total > 0 ? Math.min(uploaded / total, 1) : 1)
        },
      })
      onProgress?.(1)
      return
    }

    const done = new Set<number>()
    await client.sendMediaGroup(chatId, media, {
      progressCallback: (index, uploaded, total) => {
        if (total > 0 && uploaded >= total) done.add(index)
        onProgress?.(done.size / media.length)
      },
    })
    onProgress?.(1)
  }
}

export const mtcuteAdapter = new MtcuteTelegramAdapter()
