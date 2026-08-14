const DEBUG = import.meta.env.DEV

export function debugLog(key: string, value?: unknown): void {
  if (DEBUG) {
    // eslint-disable-next-line no-console
    console.log(`[photoup:${key}]`, value)
  }
}
