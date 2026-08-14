# photoup

Fix and forward photos. A client-side web app that takes photos that came out
too dark or desaturated, corrects exposure, preserves highlights, fixes white
balance, and sends the result to a Telegram group of your choice as an **inline
2560px photo**.

Runs entirely in the browser (no backend). Works as an installable Android web
app (PWA). All development and builds happen inside Docker — nothing is
installed on the host.

## Why this exists

Some cameras produce files that are either too dark or nearly black-and-white,
and the highlight and color information still lives in the RAW file even when
the preview looks dead. photoup:

1. Decodes camera RAW (**Nikon NEF, Canon CR2**) — plus plain JPEG/PNG.
2. Auto-corrects exposure and white balance.
3. Preserves highlights with a tone curve roll-off instead of clipping them.
4. Lets you fine-tune each photo (exposure, highlights, WB temp/hue, grey/skin
   point pickers).
5. Uploads to Telegram at maximum inline quality (resized to ≤2560px, high
   quality JPEG, sent as a `photo`).

## Features

- **Telegram login** — phone or QR, with 2FA. Session is preserved in browser
  storage and survives reloads.
- **Upload** JPEG/PNG/NEF/CR2 (drag-and-drop or file picker).
- **Auto processing** — histogram stretch + gray-world white balance + highlight
  curve, all client-side.
- **Thumbnail grid** — every uploaded photo shows its *processed* preview, with a
  checkbox (checked by default).
- **Editor** — click a thumbnail to open it: large preview, **Reset** / **Auto**
  buttons, **exposure** slider, **highlights** slider, **grey-point** and
  **skin-point** white-balance pickers, and manual **temp** / **hue** sliders.
- **Target group** — select a Telegram group; the choice is remembered across
  reloads.
- **Maximum quality** — export is resized to ≤2560px and encoded at high JPEG
  quality, then sent as an inline `photo` (Telegram stores photos up to 2560px
  without further downscaling).

## Tech stack

| Concern      | Tool |
|--------------|------|
| UI           | Svelte 5 + TypeScript (strict) + Vite |
| Telegram     | `@mtcute/web` (MTProto client), behind an adapter |
| RAW decode   | `libraw-wasm` (LibRaw compiled to WASM) |
| Processing   | `wasm-vips` (libvips compiled to WASM) — exposure/WB/tone/resize/encode |
| PWA          | Web App Manifest + service worker |
| Persistence  | `localStorage` (session + settings) |
| Build/dev    | Docker (`node:20-alpine`, `--network host`) |
| Tests        | Playwright + mock Telegram adapter |
| CI           | GitHub Actions (build + test in Docker) |

## Architecture

```
File (JPG/PNG/NEF/CR2)
  └─ decode ── RAW?  libraw-wasm → 16-bit linear RGB
              └─ else wasm-vips load
  └─ adjust ── wasm-vips: exposure (linear gain) + WB (channel gains)
               + temp/hue + highlight tone curve (S-curve roll-off)
  └─ output ── thumbnail (≤512px, auto-rotate)  → grid preview
               export (≤2560px, JPEG ~95)        → send as photo
```

**Edit at proxy resolution, export at full resolution.** The editor operates on
a reduced working image for instant feedback; the full-resolution decode and
render happen only when you tap *Send*. This keeps memory bounded on Android
(a full 36MP RAW is ~200–430MB of pixels).

## Project layout

```
src/lib/telegram/   Telegram adapter (mtcute + mock)
src/lib/image/      RAW decode, processing, auto-correction
src/stores/         Svelte stores (global state + persistence)
src/components/     Svelte components
src/App.svelte      root, screen switching
```

## Getting started

Everything runs in Docker. Prerequisites: Docker on the host (nothing else).

### Configure Telegram credentials

Create `.env` from the example and fill in your Telegram API credentials
(from https://my.telegram.org):

```bash
cp .env.example .env
# VITE_TELEGRAM_API_ID=...
# VITE_TELEGRAM_API_HASH=...
```

### Development (Docker)

```bash
docker-compose up app
# open http://localhost:5173
```

### Production build

```bash
docker build -t photoup .
docker run --rm --network host -p 4173:4173 photoup
```

### Tests

```bash
docker-compose up --build playwright
```

## Persistence

| What                    | Storage |
|-------------------------|---------|
| Telegram session/phone  | `localStorage` (survives reload) |
| Target group            | `localStorage` (survives reload) |
| App settings            | `localStorage` |
| Loaded photos/adjustments | in-memory only |

## Accepted limitations

- **Highlight recovery** uses a tone-curve roll-off, not per-channel highlight
  reconstruction (that is darktable-level work). Good enough for the "dark /
  washed-out" recovery use case.
- **RAW decode fallback**: if a RAW file fails to decode, the app falls back to
  the file's embedded JPEG preview and shows a notice.
- **Telegram photo compression**: photos sent as `photo` are re-encoded by
  Telegram; resizing to ≤2560px first keeps the result at Telegram's maximum
  retained resolution. For byte-exact lossless transfer, send as a document
  instead (not currently the default).

## References

- Telegram interaction (auth/QR/send/dialogs/adapter pattern):
  <https://github.com/sshamanov/telegram-gallery.git>
- VLM endpoint usage for image evaluation:
  `git@github.com:sshamanov/sd-cpu.git`
- Docker / image-serving patterns:
  `git@github.com:sshamanov/post-server.git`
