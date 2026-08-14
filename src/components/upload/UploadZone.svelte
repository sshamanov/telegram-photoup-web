<script lang="ts">
  import { addPhotos } from '../../stores/photos'

  function handleFiles(files: FileList | null): void {
    if (!files || files.length === 0) return
    addPhotos([...files])
  }

  function onDrop(event: DragEvent): void {
    event.preventDefault()
    handleFiles(event.dataTransfer?.files ?? null)
  }
</script>

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
  <span>Drop JPEG / PNG / NEF / CR2 here, or click to browse</span>
</label>

<style>
  .zone {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 6px;
    padding: 28px;
    border: 2px dashed var(--border);
    border-radius: 12px;
    cursor: pointer;
    text-align: center;
    color: var(--muted);
  }
  .zone:hover {
    border-color: var(--accent);
  }
</style>
