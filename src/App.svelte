<script lang="ts">
  import { authState, getCurrentAdapter } from './stores/telegram'
  import { photos, clearPhotos } from './stores/photos'
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
  let sentCount = 0
  let sendTotal = 0

  $: selectedPhotos = $photos.filter((p) => p.selected && p.status === 'ready' && p.outputBlob)
  $: editingPhoto = $photos.find((p) => p.id === editingId) ?? null

  function toJpgName(name: string): string {
    return name.replace(/\.[^.]+$/, '') + '.jpg'
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
      p.outputBlob ? [{ file: p.outputBlob, fileName: toJpgName(p.name) }] : [],
    )

    sending = true
    sentCount = 0
    sendTotal = payload.length
    try {
      await getCurrentAdapter().sendPhotos(groupId, payload, (done) => {
        sentCount = done
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
      <button onclick={send} disabled={sending || selectedPhotos.length === 0}>
        {sending ? `Sending ${sentCount}/${sendTotal}…` : `Send ${selectedPhotos.length} selected`}
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
    max-width: 1080px;
    margin: 0 auto;
    padding: 20px;
    display: flex;
    flex-direction: column;
    gap: 16px;
  }
  header {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }
  h1 {
    margin: 0;
    font-size: 20px;
  }
  .grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(160px, 1fr));
    gap: 12px;
  }
  footer {
    position: sticky;
    bottom: 0;
    padding: 12px 0;
    background: var(--bg);
  }
  footer button {
    width: 100%;
    padding: 14px;
    font-size: 15px;
  }
</style>
