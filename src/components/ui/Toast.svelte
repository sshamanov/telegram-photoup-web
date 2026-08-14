<script lang="ts">
  import { toasts } from '../../stores/ui'
</script>

<div class="toasts">
  {#each $toasts as toast (toast.id)}
    <div class="toast {toast.kind}">{toast.text}</div>
  {/each}
</div>

<style>
  .toasts {
    position: fixed;
    bottom: 16px;
    right: 16px;
    display: flex;
    flex-direction: column;
    gap: 8px;
    z-index: 200;
  }
  .toast {
    padding: 10px 14px;
    border-radius: 8px;
    background: var(--surface);
    border: 1px solid var(--border);
    max-width: 320px;
  }
  .toast.error {
    border-color: #b0483f;
    color: #ffb4ab;
  }
  .toast.info {
    border-color: var(--accent);
  }
</style>
