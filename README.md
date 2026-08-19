# photoup

Fix and forward photos. A client-side web app that takes photos that came out
too dark or with a monochrome camera picture style, corrects exposure, applies
mild highlight rolloff, fixes white balance (RAW only), and sends the result to
a Telegram group of your choice as an **inline ≤2560px photo**.

Desktop web app (Chrome). No backend — all processing runs in the browser. All
development and builds happen inside Docker; nothing is installed on the host.

## Why this exists

Some cameras produce files that are either too dark or nearly black-and-white
(a monochrome *picture style* baked into the RAW preview), even though the
sensor recorded full color. photoup:

1. Decodes camera RAW (**Nikon NEF, Canon CR2**) — plus plain JPEG/PNG.
2. Auto-corrects exposure (global, not selective) and preserves natural contrast.
3. Applies mild highlight rolloff — some clipping is preferred over an HDR look.
4. For RAW: white balance is camera-as-shot by default, with a manual
   **temperature** slider and a **neutral (gray) picker**.
5. Lets you **crop** each photo.
6. Uploads to Telegram as an inline photo (resized to ≤2560px, 4:4:4 mozjpeg with
   adaptive quality — maximum quality that still fits Telegram's ~10 MB photo limit).

## Features

- **Telegram login** — phone or QR, with 2FA. Session preserved in browser
  storage; survives reloads.
- **Upload** JPEG/PNG/NEF/CR2 (drag-and-drop or file picker).
- **Auto exposure** immediately after upload.
- **Thumbnail grid** — every photo shows its *processed* preview, with a
  checkbox selected by default.
- **Editor** — Reset / Auto / Exposure for every photo; **Temperature +
  neutral picker + Crop** for RAW; **Crop** for JPEG; a live **luminance
  histogram** showing tonal distribution (and highlight clipping).
- **Target group** — remembered across reloads.
- **Maximum quality** — ≤2560px, 4:4:4 mozjpeg with adaptive quality (the highest
  that still fits Telegram's ~10 MB photo limit), sent as an inline `photo`.
- **Usage indicator** — live memory/processing status.

## Tech stack

| Concern     | Tool |
|-------------|------|
| UI          | Svelte 5 + TypeScript (strict) + Vite |
| Telegram    | `@mtcute/web` (MTProto client), behind an adapter |
| RAW decode  | `libraw-wasm` (LibRaw WASM → camera-WB 16-bit linear RGB) |
| Processing  | Browser canvas + Web Worker + `@jsquash/jpeg` (4:4:4 mozjpeg, adaptive quality) |
| Persistence | `localStorage` (session + settings) |
| Build/dev   | Docker (`node:20-alpine`, `--network host`) |
| Tests       | Playwright + mock Telegram adapter |
| CI          | GitHub Actions (build + test in Docker) |

## Architecture

```
File (JPG/PNG/NEF/CR2)
  └─ decode ── RAW?  libraw-wasm → 16-bit linear RGB
              └─ else browser decode
  └─ adjust ── RAW: camera WB + [temperature / neutral picker]
               both: global auto exposure + mild highlight rolloff (linear space)
  └─ crop ──── optional manual crop (applied at render time)
  └─ output ── thumbnail (≤512px)  → grid preview
               export (≤2560px, adaptive 4:4:4 mozjpeg) → send as photo
```

## Processing concept

- **RAW:** decode to 16-bit linear RGB (camera WB + color matrix) → [WB offset /
  hue / auto WB / neutral picker] → auto or manual exposure → mild highlight
  rolloff → camera-"Standard" tone curve → crop → resize ≤2560px → sRGB JPEG.
  The export bakes the final WB into libraw's `userMul` (pre color matrix, native
  sensor data); the preview reproduces it via the camera matrix so they match.
- **JPEG:** decode → auto or manual exposure → mild highlight rolloff → crop →
  resize ≤2560px → JPEG.

The source is decoded once and cached; edits re-render only the thumbnail, and
the export is rendered once at send. Reprocessing **always starts from the
original decoded source** — never cumulatively from an edited preview.

## Project layout

```
src/lib/telegram/   Telegram adapter (mtcute + mock)
src/lib/image/      RAW decode, processing, auto-exposure
src/stores/         Svelte stores (global state + persistence)
src/components/     Svelte components
src/App.svelte      root
```

## Status

Working end-to-end for JPEG/PNG/RAW: upload → auto-exposure → editor (exposure,
WB offset + auto WB + neutral picker, crop) → album send, with Telegram behind a
mock adapter for tests.

- **RAW decode**: `libraw-wasm` decodes NEF/CR2 to camera-WB 16-bit linear RGB
  (verified against the D810 NEF and Canon CR2 samples).
- **Export**: 4:4:4 mozjpeg with adaptive quality — maximum quality, lowered only
  to stay under Telegram's ~10 MB photo limit (verified against the live account).

Deferred:
- **Real-Telegram upload test** (PNG vs JPEG 4:4:4 round-trip) — needs a live
  session (or a test bot).

## Getting started

Everything runs in Docker. Prerequisites: Docker on the host (nothing else).

### Configure Telegram credentials

```bash
cp .env.example .env
# VITE_TELEGRAM_API_ID=...   (from https://my.telegram.org)
# VITE_TELEGRAM_API_HASH=...
```

### Development

```bash
docker-compose up app        # http://localhost:5173
```

This is the **only** server — there is no separate production/preview service.
(CI still runs `docker build -t photoup .` as a build gate, but nothing runs a
second server locally.)

### Tests

```bash
docker-compose up --build playwright
```

## Persistence

| What                     | Storage |
|--------------------------|---------|
| Telegram session/phone   | `localStorage` (survives reload) |
| Target group             | `localStorage` (survives reload) |
| App settings             | `localStorage` |
| Loaded photos/adjustments | in-memory only |

## Accepted limitations

- **Highlight recovery** is a mild tone-curve rolloff, not per-channel
  reconstruction.
- **RAW white balance** uses camera-as-shot values by default (no automatic
  WB); manual correction is via temperature + neutral picker.
- **JPEG color is never altered** — only exposure + crop.
- **Exports are capped to Telegram's ~10 MB photo limit** — the encoder keeps the
  highest quality that fits, but very detailed images are re-compressed (and
  Telegram re-encodes photos anyway).

## References

- Telegram interaction (auth/QR/send/dialogs/adapter pattern):
  <https://github.com/sshamanov/telegram-gallery.git>
- VLM endpoint usage for image evaluation:
  `git@github.com:sshamanov/sd-cpu.git`
- Docker / image-serving patterns:
  `git@github.com:sshamanov/post-server.git`
