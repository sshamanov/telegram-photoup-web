import { writable } from 'svelte/store'

export interface Toast {
  id: number
  kind: 'info' | 'error'
  text: string
}

export const toasts = writable<Toast[]>([])

let nextId = 1

export function pushToast(kind: Toast['kind'], text: string): void {
  const id = nextId++
  toasts.update((list) => [...list, { id, kind, text }])
  setTimeout(() => {
    toasts.update((list) => list.filter((t) => t.id !== id))
  }, 5000)
}
