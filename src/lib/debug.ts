export function debugLog(key: string, value?: unknown): void {
  // eslint-disable-next-line no-console
  console.log(`[photoup:${key}]`, value)
}
