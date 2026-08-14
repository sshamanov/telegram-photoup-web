<script lang="ts">
  import { onMount } from 'svelte'
  import QRCode from 'qrcode'
  import { authState, phoneCodeHash, getCurrentAdapter } from '../../stores/telegram'
  import { pushToast } from '../../stores/ui'

  let mode: 'phone' | 'qr' = 'phone'
  let phone = ''
  let code = ''
  let password = ''
  let need2fa = false
  let qrDataUrl: string | null = null
  let busy = false
  let needQrPassword = false
  let qrPassword = ''
  let qrPasswordResolver: ((p: string) => void) | null = null

  function messageOf(error: unknown): string {
    return error instanceof Error ? error.message : String(error)
  }

  onMount(async () => {
    const snap = localStorage.getItem('session')
    if (!snap) return
    try {
      if (await getCurrentAdapter().reconnect(snap)) {
        authState.set('connected')
      }
    } catch {
      /* stay on auth */
    }
  })

  async function sendCode(): Promise<void> {
    busy = true
    try {
      const { phoneCodeHash: hash } = await getCurrentAdapter().sendCode(phone)
      phoneCodeHash.set(hash)
      pushToast('info', 'Code sent')
    } catch (error) {
      pushToast('error', messageOf(error))
    } finally {
      busy = false
    }
  }

  async function signIn(): Promise<void> {
    busy = true
    try {
      const result = await getCurrentAdapter().signIn(phone, code, $phoneCodeHash ?? '')
      if (result === '2fa_required') {
        need2fa = true
      } else {
        authState.set('connected')
      }
    } catch (error) {
      pushToast('error', messageOf(error))
    } finally {
      busy = false
    }
  }

  async function signIn2FA(): Promise<void> {
    busy = true
    try {
      await getCurrentAdapter().signIn2FA(password)
      authState.set('connected')
    } catch (error) {
      pushToast('error', messageOf(error))
    } finally {
      busy = false
    }
  }

  function promptQrPassword(): Promise<string> {
    needQrPassword = true
    qrPassword = ''
    return new Promise((resolve) => {
      qrPasswordResolver = resolve
    })
  }

  function submitQrPassword(): void {
    needQrPassword = false
    const resolve = qrPasswordResolver
    qrPasswordResolver = null
    resolve?.(qrPassword)
  }

  async function startQr(): Promise<void> {
    mode = 'qr'
    qrDataUrl = null
    needQrPassword = false
    busy = true
    try {
      for await (const { token } of getCurrentAdapter().startQRLogin(() => promptQrPassword())) {
        qrDataUrl = await QRCode.toDataURL(token, { width: 256 })
      }
      authState.set('connected')
    } catch (error) {
      pushToast('error', messageOf(error))
    } finally {
      busy = false
    }
  }
</script>

<div class="auth">
  <h1>photoup</h1>
  <div class="tabs">
    <button class:active={mode === 'phone'} on:click={() => (mode = 'phone')}>Phone</button>
    <button class:active={mode === 'qr'} on:click={() => startQr()}>QR</button>
  </div>

  {#if mode === 'phone'}
    {#if !need2fa}
      <input type="tel" placeholder="+1234567890" bind:value={phone} />
      <button on:click={sendCode} disabled={busy || !phone}>Send code</button>
      <input type="text" placeholder="Code" bind:value={code} />
      <button on:click={signIn} disabled={busy || !code}>Sign in</button>
    {:else}
      <input type="password" placeholder="2FA password" bind:value={password} />
      <button on:click={signIn2FA} disabled={busy || !password}>Confirm</button>
    {/if}
  {:else if qrDataUrl}
    <img src={qrDataUrl} alt="Telegram QR login" />
    <p class="muted">Scan with Telegram on your phone</p>
    {#if needQrPassword}
      <input type="password" placeholder="2FA password" bind:value={qrPassword} />
      <button on:click={submitQrPassword} disabled={!qrPassword}>Confirm 2FA</button>
    {/if}
  {/if}
</div>

<style>
  .auth {
    max-width: 360px;
    margin: 10vh auto;
    display: flex;
    flex-direction: column;
    gap: 12px;
    padding: 24px;
  }
  h1 {
    text-align: center;
  }
  .tabs {
    display: flex;
    gap: 8px;
  }
  .tabs button {
    flex: 1;
  }
  .tabs .active {
    border-color: var(--accent);
  }
  .muted {
    color: var(--muted);
    text-align: center;
    font-size: 13px;
  }
</style>
