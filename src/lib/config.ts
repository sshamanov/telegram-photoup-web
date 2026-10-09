// Runtime config injected by /config.js (generated from the container env by
// scripts/serve-dist.mjs), so the published image carries no credentials.
// Falls back to build-time VITE_* values for local development.
const runtime = typeof window !== 'undefined' ? window.__APP_CONFIG__ : undefined

export const TELEGRAM_API_ID: string =
  runtime?.telegramApiId || import.meta.env.VITE_TELEGRAM_API_ID || ''
export const TELEGRAM_API_HASH: string =
  runtime?.telegramApiHash || import.meta.env.VITE_TELEGRAM_API_HASH || ''
// '' = auto (real Telegram when credentials are set, mock otherwise).
export const USE_MOCK_ADAPTER: string =
  runtime?.useMockAdapter || import.meta.env.VITE_USE_MOCK_ADAPTER || ''
