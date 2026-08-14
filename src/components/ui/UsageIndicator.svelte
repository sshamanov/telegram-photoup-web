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
    gap: 10px;
    font-size: 11px;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: var(--muted);
    padding: 4px 0;
  }
  .dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: var(--accent);
    box-shadow: 0 0 10px rgba(255, 122, 69, 0.7);
    animation: pulse 1.4s ease-in-out infinite;
  }
  @keyframes pulse {
    50% {
      opacity: 0.25;
      transform: scale(0.8);
    }
  }
</style>
