import type { Dialog, UploadPhoto } from '../../types/telegram'
import type { TelegramAdapter } from './adapter'

export interface UploadedAlbum {
  dialogId: string
  fileName: string[]
}

export const mockDialogs: Dialog[] = [
  { id: '100', title: 'Family', kind: 'group', subtitle: 'Supergroup', username: null },
  { id: '101', title: 'Travel', kind: 'group', subtitle: 'Group', username: null },
  { id: '102', title: 'Announcements', kind: 'channel', subtitle: 'Channel', username: 'announce' },
  { id: 'me', title: 'Saved Messages', kind: 'chat', subtitle: 'Direct chat', username: null },
]

export class MockTelegramAdapter implements TelegramAdapter {
  uploads: UploadedAlbum[] = []

  async sendCode(): Promise<{ phoneCodeHash: string }> {
    return { phoneCodeHash: 'mockhash' }
  }

  async signIn(): Promise<'ok' | '2fa_required'> {
    return 'ok'
  }

  async signIn2FA(): Promise<void> {}

  async *startQRLogin(): AsyncIterable<{ token: string; expires: number }> {
    yield { token: 'tg://login?token=mock', expires: Date.now() + 60_000 }
  }

  async reconnect(): Promise<boolean> {
    return true
  }

  async logout(): Promise<void> {}

  getSession(): string | null {
    return 'mock-session'
  }

  async getDialogs(): Promise<Dialog[]> {
    return mockDialogs
  }

  async sendPhotos(dialogId: string, photos: UploadPhoto[], onProgress?: (progress: number) => void): Promise<void> {
    this.uploads.push({ dialogId, fileName: photos.map((p) => p.fileName) })
    onProgress?.(1)
  }
}

export const mockAdapter = new MockTelegramAdapter()
