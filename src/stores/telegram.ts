import { writable } from 'svelte/store'
import type { AuthState, SessionSnapshot } from '../types/telegram'
import type { TelegramAdapter } from '../lib/telegram/adapter'
import {
  getTelegramAdapter,
  setTelegramAdapter,
  setTelegramApiCredentials,
} from '../lib/telegram/adapter'
import { mtcuteAdapter } from '../lib/telegram/mtcute'
import { mockAdapter } from '../lib/telegram/mock'
import { pushToast } from './ui'

const hasApiCredentials = Boolean(
  localStorage.getItem('telegram.apiId') || import.meta.env.VITE_TELEGRAM_API_ID,
)

function envUseMock(): boolean {
  const value = import.meta.env.VITE_USE_MOCK_ADAPTER
  return value === 'true' || value === '1' || value === 'True' || value === 'TRUE'
}

const envUseMockSet = import.meta.env.VITE_USE_MOCK_ADAPTER !== undefined
const useMock = envUseMockSet ? envUseMock() : !hasApiCredentials

setTelegramAdapter(useMock ? mockAdapter : mtcuteAdapter)
setTelegramApiCredentials(
  localStorage.getItem('telegram.apiId') ?? import.meta.env.VITE_TELEGRAM_API_ID ?? '',
  localStorage.getItem('telegram.apiHash') ?? import.meta.env.VITE_TELEGRAM_API_HASH ?? '',
)

export const authState = writable<AuthState>('idle')
export const phoneCodeHash = writable<string | null>(null)
export const session = writable<SessionSnapshot>({
  phone: localStorage.getItem('phone') ?? undefined,
  session: localStorage.getItem('session'),
})

export function getCurrentAdapter(): TelegramAdapter {
  return getTelegramAdapter()
}

export const useMockAdapter = writable(useMock)

export function handleSessionExpired(): void {
  localStorage.removeItem('session')
  authState.set('idle')
  session.set({ session: null })
  pushToast('error', 'Session expired — please log in again')
}

/** Sign out of the current account and return to the auth screen. */
export async function logout(): Promise<void> {
  try {
    await getCurrentAdapter().logout()
  } catch {
    // best-effort — clear local state even if the network logout fails
  } finally {
    localStorage.removeItem('session')
    localStorage.removeItem('phone')
    authState.set('idle')
    session.set({ phone: undefined, session: null })
  }
}
