import { writable, type Writable } from 'svelte/store'

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function persisted<T>(key: string, initialValue: T): Writable<T> {
  const stored = typeof localStorage === 'undefined' ? null : localStorage.getItem(key)

  let startValue = initialValue

  if (stored) {
    try {
      const parsed = JSON.parse(stored) as T
      startValue = isPlainObject(initialValue) && isPlainObject(parsed)
        ? ({ ...initialValue, ...parsed } as T)
        : parsed
    } catch {
      startValue = initialValue
    }
  }

  const store = writable<T>(startValue)

  store.subscribe((value) => {
    localStorage.setItem(key, JSON.stringify(value))
  })

  return store
}
