import type { Dialog, UploadPhoto } from '../../types/telegram'

export interface TelegramAdapter {
  sendCode(phone: string): Promise<{ phoneCodeHash: string }>
  signIn(phone: string, code: string, hash: string): Promise<'ok' | '2fa_required'>
  signIn2FA(password: string): Promise<void>
  startQRLogin(onPasswordRequired: () => Promise<string>): AsyncIterable<{ token: string; expires: number }>
  reconnect(session: string): Promise<boolean>
  logout(): Promise<void>
  getSession(): string | null
  getDialogs(opts?: { limit?: number }): Promise<Dialog[]>
  sendPhotos(dialogId: string, photos: UploadPhoto[], onProgress?: (completed: number, total: number) => void): Promise<void>
}

let currentAdapter: TelegramAdapter | null = null
let storedApiId = localStorage.getItem('telegram.apiId') ?? import.meta.env.VITE_TELEGRAM_API_ID ?? ''
let storedApiHash = localStorage.getItem('telegram.apiHash') ?? import.meta.env.VITE_TELEGRAM_API_HASH ?? ''

export function setTelegramAdapter(adapter: TelegramAdapter): void {
  currentAdapter = adapter
}

export function getTelegramAdapter(): TelegramAdapter {
  if (!currentAdapter) {
    throw new Error('Telegram adapter has not been initialized')
  }
  return currentAdapter
}

export function setTelegramApiCredentials(apiId: string, apiHash: string): void {
  storedApiId = apiId.trim()
  storedApiHash = apiHash.trim()
  localStorage.setItem('telegram.apiId', storedApiId)
  localStorage.setItem('telegram.apiHash', storedApiHash)
}

export function getTelegramApiCredentials(): { apiId: string; apiHash: string } {
  return { apiId: storedApiId, apiHash: storedApiHash }
}
