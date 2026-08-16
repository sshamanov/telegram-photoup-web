<script lang="ts">
  import { addPhotos } from '../../stores/photos'

  const RAW_RE = /\.(nef|cr2|arw|dng|raf|orf)$/i

  function isPhoto(file: File): boolean {
    return file.type.startsWith('image/') || RAW_RE.test(file.name)
  }

  function handleFiles(files: FileList | null): void {
    if (!files || files.length === 0) return
    addPhotos([...files])
  }

  function onDrop(event: DragEvent): void {
    event.preventDefault()
    handleFiles(event.dataTransfer?.files ?? null)
  }

  /** Ctrl+V / paste: ingest image files copied from the file manager (like Telegram Web). */
  function onPaste(event: ClipboardEvent): void {
    const dt = event.clipboardData
    if (!dt) return
    let files: File[] = []
    if (dt.files.length > 0) {
      // File-manager copies surface in `files`; `items` mirrors them, so prefer this.
      files = [...dt.files].filter(isPhoto)
    } else {
      // In-browser image copies (e.g. an image on a page) surface via items only.
      for (const item of dt.items) {
        if (item.kind === 'file' && item.type.startsWith('image/')) {
          const f = item.getAsFile()
          if (f) files.push(f)
        }
      }
    }
    if (files.length === 0) return
    event.preventDefault()
    addPhotos(files)
  }
</script>

<svelte:window onpaste={onPaste} />

<label
  class="zone"
  ondragover={(e) => e.preventDefault()}
  ondrop={onDrop}
>
  <input
    type="file"
    multiple
    accept="image/*,.nef,.cr2,.arw,.dng,.raf,.orf"
    onchange={(e) => handleFiles(e.currentTarget.files)}
    hidden
  />
  <strong>Upload photos</strong>
  <span>Drop JPEG / PNG / NEF / CR2 here, or press Ctrl+V to paste</span>
</label>

<style>
  .zone {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 8px;
    padding: 30px;
    border: 1.5px dashed var(--border-strong);
    border-radius: var(--radius-lg);
    cursor: pointer;
    text-align: center;
    color: var(--muted);
    transition: border-color 0.18s ease, background 0.18s ease;
  }
  .zone:hover {
    border-color: var(--accent);
    background: rgba(255, 122, 69, 0.04);
  }
  .zone strong {
    font-family: var(--font-display);
    font-size: 18px;
    font-weight: 500;
    color: var(--text);
    letter-spacing: 0.01em;
  }
  .zone span {
    font-size: 12px;
    letter-spacing: 0.04em;
  }
</style>
