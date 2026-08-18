<script lang="ts">
  import { onMount } from 'svelte'
  import { getCurrentAdapter } from '../../stores/telegram'
  import { settings } from '../../stores/settings'
  import type { Dialog } from '../../types/telegram'

  let dialogs: Dialog[] = []

  onMount(async () => {
    try {
      // Fetch a large list so every group the account can reach is cached (a raw
      // group id only resolves if the peer is in the client's cache, else PEER_ID_INVALID).
      dialogs = await getCurrentAdapter().getDialogs({ limit: 1000 })
      // If the persisted target is no longer reachable, drop it rather than send
      // to an invalid peer.
      const target = $settings.targetGroupId
      if (target && !dialogs.some((d) => d.id === target)) {
        settings.set({ ...$settings, targetGroupId: null })
      }
    } catch {
      /* ignore — dialogs stay empty */
    }
  })

  function setGroup(value: string): void {
    settings.set({ ...$settings, targetGroupId: value || null })
  }
</script>

<div class="group">
  <label for="group-select">Send to</label>
  <select id="group-select" value={$settings.targetGroupId ?? ''} onchange={(e) => setGroup(e.currentTarget.value)}>
    <option value="">Select group…</option>
    {#each dialogs as dialog (dialog.id)}
      <option value={dialog.id}>{dialog.title}</option>
    {/each}
  </select>
</div>

<style>
  .group {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .group label {
    color: var(--muted);
    font-size: 13px;
  }
</style>
