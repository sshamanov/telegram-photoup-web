// Dev-only: the body is dropped from production builds (import.meta.env.DEV is
// statically false there).
export function debugLog(key: string, value?: unknown): void {
  if (!import.meta.env.DEV) return
  // eslint-disable-next-line no-console
  console.log(`[photoup:${key}]`, value)
}
