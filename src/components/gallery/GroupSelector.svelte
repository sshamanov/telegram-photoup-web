<script lang="ts">
  import { onMount } from 'svelte'
  import { getCurrentAdapter } from '../../stores/telegram'
  import { settings } from '../../stores/settings'
  import type { Dialog } from '../../types/telegram'

  let dialogs: Dialog[] = []

  onMount(async () => {
    try {
      dialogs = await getCurrentAdapter().getDialogs()
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
