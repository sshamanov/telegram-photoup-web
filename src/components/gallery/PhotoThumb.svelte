<script lang="ts">
  import type { Photo } from '../../stores/photos'
  import { toggleSelected } from '../../stores/photos'

  export let photo: Photo
  export let onOpen: (id: string) => void = () => {}
</script>

<div
  class="thumb"
  class:error={photo.status === 'error'}
  class:selected={photo.selected}
  role="button"
  tabindex="0"
  onclick={() => onOpen(photo.id)}
  onkeydown={(e) => e.key === 'Enter' && onOpen(photo.id)}
>
  <div class="img">
    {#if photo.thumbUrl}
      <img src={photo.thumbUrl} alt={photo.name} />
    {:else if photo.status === 'error'}
      <div class="placeholder error-text">error</div>
    {:else}
      <div class="placeholder">developing…</div>
    {/if}
  </div>

  <div class="meta">
    <span class="name" title={photo.name}>{photo.name}</span>
    <span class="badge">{photo.sourceType === 'raw' ? 'RAW' : 'JPG'}</span>
  </div>

  <input
    type="checkbox"
    checked={photo.selected}
    onclick={(e) => e.stopPropagation()}
    onchange={() => toggleSelected(photo.id)}
    aria-label={`select ${photo.name}`}
    class="tick"
  />
</div>

<style>
  .thumb {
    position: relative;
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    overflow: hidden;
    cursor: pointer;
    transition:
      border-color 0.18s ease,
      box-shadow 0.18s ease,
      transform 0.18s ease;
  }
  .thumb:hover {
    border-color: var(--border-strong);
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.5);
    transform: translateY(-2px);
  }
  .thumb.selected {
    border-color: var(--accent);
    box-shadow: 0 0 0 1px var(--accent), 0 8px 24px rgba(0, 0, 0, 0.5);
  }
  .thumb.error {
    border-color: var(--danger);
  }

  .img {
    aspect-ratio: 1 / 1;
    display: flex;
    align-items: center;
    justify-content: center;
    background:
      radial-gradient(circle at center, rgba(255, 122, 69, 0.04), transparent 70%),
      var(--bg-raise);
    border-bottom: 1px solid var(--border);
  }
  img {
    width: 100%;
    height: 100%;
    object-fit: cover;
    display: block;
  }
  .placeholder {
    color: var(--faint);
    font-size: 11px;
    letter-spacing: 0.06em;
    text-transform: uppercase;
  }
  .error-text {
    color: var(--danger);
  }

  .meta {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    padding: 8px 10px;
  }
  .name {
    font-size: 12px;
    color: var(--text);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    min-width: 0;
  }
  .badge {
    flex-shrink: 0;
    font-size: 10px;
    letter-spacing: 0.1em;
    color: var(--accent-2);
    border: 1px solid var(--border-strong);
    border-radius: 5px;
    padding: 1px 5px;
  }

  .tick {
    position: absolute;
    top: 8px;
    left: 8px;
    width: 18px;
    height: 18px;
    margin: 0;
    -webkit-appearance: none;
    appearance: none;
    border-radius: 0;
    background: rgba(13, 11, 9, 0.7);
    border: 1.5px solid var(--border-strong);
    cursor: pointer;
    transition: all 0.15s ease;
  }
  .tick:checked {
    background-color: var(--accent);
    background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16'%3E%3Cpath d='M3.5 8.5l3 3 6-6.5' fill='none' stroke='%232a1408' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E");
    background-position: center;
    background-repeat: no-repeat;
    background-size: 11px 11px;
    border-color: var(--accent);
    box-shadow: 0 0 10px rgba(255, 122, 69, 0.5);
  }
</style>
