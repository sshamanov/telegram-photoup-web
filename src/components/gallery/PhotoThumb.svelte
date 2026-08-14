<script lang="ts">
  import type { Photo } from '../../stores/photos'
  import { toggleSelected } from '../../stores/photos'

  export let photo: Photo
  export let onOpen: (id: string) => void = () => {}
</script>

<div
  class="thumb"
  class:error={photo.status === 'error'}
  role="button"
  tabindex="0"
  onclick={() => onOpen(photo.id)}
  onkeydown={(e) => e.key === 'Enter' && onOpen(photo.id)}
>
  <input
    type="checkbox"
    checked={photo.selected}
    onclick={(e) => e.stopPropagation()}
    onchange={() => toggleSelected(photo.id)}
    aria-label="select"
  />
  <div class="img">
    {#if photo.thumbUrl}
      <img src={photo.thumbUrl} alt={photo.name} />
    {:else if photo.status === 'error'}
      <div class="placeholder error-text">error</div>
    {:else}
      <div class="placeholder">processing…</div>
    {/if}
  </div>
  <div class="name" title={photo.name}>{photo.name}</div>
  <span class="badge">{photo.sourceType === 'raw' ? 'RAW' : 'JPG'}</span>
</div>

<style>
  .thumb {
    position: relative;
    border: 1px solid var(--border);
    border-radius: 10px;
    overflow: hidden;
    background: var(--surface);
    cursor: pointer;
  }
  .thumb:hover {
    border-color: var(--accent);
  }
  .thumb.error {
    border-color: #b0483f;
  }
  .thumb > input {
    position: absolute;
    top: 8px;
    left: 8px;
    z-index: 2;
  }
  .img {
    aspect-ratio: 4 / 3;
    display: flex;
    align-items: center;
    justify-content: center;
  }
  img {
    width: 100%;
    height: 100%;
    object-fit: contain;
    display: block;
  }
  .placeholder {
    color: var(--muted);
    font-size: 12px;
  }
  .error-text {
    color: #ffb4ab;
  }
  .name {
    padding: 6px 10px;
    font-size: 12px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    color: var(--muted);
  }
  .badge {
    position: absolute;
    bottom: 6px;
    right: 8px;
    font-size: 10px;
    color: var(--muted);
    background: var(--bg);
    padding: 1px 5px;
    border-radius: 4px;
  }
</style>
