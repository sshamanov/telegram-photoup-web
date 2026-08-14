export type AuthState = 'idle' | 'connected'

export interface Dialog {
  id: string
  title: string
  kind: 'chat' | 'group' | 'channel'
  subtitle: string
  username: string | null
}

export interface UploadPhoto {
  file: Blob
  fileName: string
  caption?: string
}

export interface SessionSnapshot {
  phone?: string
  session: string | null
}
