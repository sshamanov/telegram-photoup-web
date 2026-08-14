<script lang="ts">
  import { authState, getCurrentAdapter } from './stores/telegram'
  import { photos, clearPhotos, reprocessAll } from './stores/photos'
  import { settings } from './stores/settings'
  import { pushToast } from './stores/ui'
  import AuthScreen from './components/auth/AuthScreen.svelte'
  import UploadZone from './components/upload/UploadZone.svelte'
  import GroupSelector from './components/gallery/GroupSelector.svelte'
  import PhotoThumb from './components/gallery/PhotoThumb.svelte'
  import EditorPanel from './components/editor/EditorPanel.svelte'
  import UsageIndicator from './components/ui/UsageIndicator.svelte'
  import Toast from './components/ui/Toast.svelte'
  import type { UploadPhoto } from './types/telegram'

  let editingId: string | null = null
  let sending = false
  let sendProgress = 0

  $: selectedPhotos = $photos.filter((p) => p.selected && p.status === 'ready' && p.outputBlob)
  $: editingPhoto = $photos.find((p) => p.id === editingId) ?? null

  function toExportName(name: string, format: 'jpeg' | 'png'): string {
    return name.replace(/\.[^.]+$/, '') + (format === 'png' ? '.png' : '.jpg')
  }

  async function send(): Promise<void> {
    const groupId = $settings.targetGroupId
    if (!groupId) {
      pushToast('error', 'Select a target group first')
      return
    }
    if (selectedPhotos.length === 0) {
      pushToast('error', 'No ready photos selected')
      return
    }

    const payload: UploadPhoto[] = selectedPhotos.flatMap((p) =>
      p.outputBlob ? [{ file: p.outputBlob, fileName: toExportName(p.name, $settings.format) }] : [],
    )

    sending = true
    sendProgress = 0
    try {
      await getCurrentAdapter().sendPhotos(groupId, payload, (progress) => {
        sendProgress = progress
      })
      pushToast('info', `Sent ${payload.length} photo(s)`)
      clearPhotos()
    } catch (error) {
      pushToast('error', error instanceof Error ? error.message : String(error))
    } finally {
      sending = false
    }
  }
</script>

<Toast />

{#if $authState === 'connected'}
  <main class="shell">
    <header>
      <h1>photoup</h1>
      <GroupSelector />
    </header>

    <UploadZone />
    <UsageIndicator />

    {#if $photos.length > 0}
      <div class="grid">
        {#each $photos as photo (photo.id)}
          <PhotoThumb {photo} onOpen={(id) => (editingId = id)} />
        {/each}
      </div>
    {/if}

    <footer>
      <label class="fmt">
        Upload as
        <select
          value={$settings.format}
          onchange={(e) => {
            settings.set({ ...$settings, format: e.currentTarget.value === 'png' ? 'png' : 'jpeg' })
            reprocessAll()
          }}
        >
          <option value="jpeg">JPEG 4:4:4 (Q100)</option>
          <option value="png">PNG (lossless)</option>
        </select>
      </label>
      <button onclick={send} disabled={sending || selectedPhotos.length === 0}>
        {#if sending}
          <span class="bar"><span class="fill" style="width:{Math.round(sendProgress * 100)}%"></span></span>
          <span>Sending {Math.round(sendProgress * 100)}%</span>
        {:else}
          Send {selectedPhotos.length} selected
        {/if}
      </button>
    </footer>
  </main>
{:else}
  <AuthScreen />
{/if}

{#if editingPhoto}
  <EditorPanel photo={editingPhoto} onClose={() => (editingId = null)} />
{/if}

<style>
  .shell {
    max-width: 1120px;
    margin: 0 auto;
    padding: 24px 24px 0;
    display: flex;
    flex-direction: column;
    gap: 18px;
  }
  header {
    display: flex;
    align-items: flex-end;
    justify-content: space-between;
    gap: 16px;
    padding: 6px 0 14px;
    border-bottom: 1px solid var(--border);
  }
  h1 {
    margin: 0;
    font-size: 34px;
    font-weight: 700;
    line-height: 1;
    color: var(--text);
  }
  h1::after {
    content: '';
    display: block;
    width: 42px;
    height: 3px;
    margin-top: 8px;
    background: linear-gradient(90deg, var(--accent), var(--accent-2));
    border-radius: 2px;
  }
  .grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
    gap: 14px;
  }
  footer {
    position: sticky;
    bottom: 0;
    margin: 0 -24px;
    padding: 14px 24px;
    background: rgba(13, 11, 9, 0.86);
    backdrop-filter: blur(10px);
    border-top: 1px solid var(--border);
    display: flex;
    gap: 14px;
    align-items: center;
  }
  footer button {
    flex: 1;
    padding: 14px;
    font-size: 13px;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 10px;
  }
  footer button:not(:disabled) {
    border-color: var(--accent);
    background: linear-gradient(180deg, rgba(255, 122, 69, 0.18), rgba(255, 122, 69, 0.06));
  }
  .bar {
    width: 140px;
    height: 7px;
    background: var(--border);
    border-radius: 4px;
    overflow: hidden;
  }
  .fill {
    display: block;
    height: 100%;
    background: linear-gradient(90deg, var(--accent), var(--accent-2));
    border-radius: 4px;
    transition: width 0.2s ease;
  }
  .fmt {
    display: flex;
    align-items: center;
    gap: 8px;
    color: var(--muted);
    font-size: 11px;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    white-space: nowrap;
  }
</style>
