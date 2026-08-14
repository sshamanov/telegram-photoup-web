<script lang="ts">
  import { photos } from '../../stores/photos'

  $: pending = $photos.filter((p) => p.status === 'queued' || p.status === 'processing')
  $: current = pending[0]
</script>

{#if pending.length > 0}
  <div class="usage">
    <span class="dot"></span>
    {#if current}
      Processing {current.name}
      {#if pending.length > 1}({pending.length - 1} queued){/if}
    {:else}
      {pending.length} queued
    {/if}
  </div>
{/if}

<style>
  .usage {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 13px;
    color: var(--muted);
    padding: 6px 0;
  }
  .dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: var(--accent);
    animation: pulse 1s ease-in-out infinite;
  }
  @keyframes pulse {
    50% {
      opacity: 0.3;
    }
  }
</style>
