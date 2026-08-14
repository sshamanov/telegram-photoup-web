# photoup — design spec

Date: 2026-08-14
Status: approved

## Purpose

A client-side PWA that corrects dark/desaturated photos (JPEG + Nikon NEF +
Canon CR2) and sends them to a chosen Telegram group as inline 2560px photos,
at maximum quality. No backend; everything runs in the browser, developed and
built entirely in Docker.

## Goals

1. Preserve highlights and recover color from dark/monochrome-looking files.
2. Export as "normal bright colorful" photos.
3. Inline Telegram upload at ≤2560px, high-quality JPEG.
4. Session and group selection survive browser reloads.
5. Works as an installable Android web app (PWA).
6. All development/build/test inside Docker; CI via GitHub Actions.

## Non-goals (v1)

- Per-channel highlight reconstruction (darktable-class). A tone-curve roll-off
  is the accepted approximation.
- Editing photos already uploaded to Telegram.
- Sending as document (byte-lossless) — the chosen behavior is inline `photo`.
- Any server-side processing or storage.

## Tech stack

- Svelte 5 + TypeScript strict + Vite
- `@mtcute/web` — Telegram MTProto (auth, dialogs, upload)
- `libraw-wasm` — RAW decode (NEF/CR2 → 16-bit linear RGB)
- `wasm-vips` — exposure/WB/tone-curve/resize/encode
- PWA (manifest + service worker)
- localStorage (session + settings)
- Docker `node:20-alpine` (`--network host`)
- GitHub Actions + Playwright (mock adapter)

## Architecture

### Modules (each has one purpose, a clear interface, testable alone)

| Module | Responsibility | Depends on |
|--------|----------------|-----------|
| `lib/telegram/adapter.ts` | `TelegramAdapter` interface | types |
| `lib/telegram/mtcute.ts` | real Telegram client | `@mtcute/web`, adapter |
| `lib/telegram/mock.ts` | deterministic mock (tests/dev) | adapter |
| `lib/image/raw.ts` | RAW decode → 16-bit RGB | `libraw-wasm` |
| `lib/image/process.ts` | adjust + resize + encode | `wasm-vips` |
| `lib/image/auto.ts` | auto exposure/WB algorithms | types |
| `lib/image/types.ts` | `Adjustments`, `PhotoSource`, etc. | — |
| `stores/*` | global state + persistence | Svelte |
| `components/*` | UI | stores, lib |

### Data flow (per photo)

```
File
  → decode: RAW → libraw-wasm → 16-bit linear RGB buffer
            else → wasm-vips load
  → adjust (wasm-vips):
      exposure = linear gain (EV)
      WB       = per-channel gains (grey/skin pickers, or temp/hue)
      temp/hue = R/B gains (temp), G gain (hue/tint)
      highlights = tone curve LUT (S-curve with roll-off shoulder)
  → render on demand:
      thumbnail: ≤512px, auto-rotate, JPEG/WebP → object URL
      export:    ≤2560px long edge, JPEG ~95 → Blob → send as photo
```

### Resolution strategy

- Editor feedback uses a reduced working image (default 2048px long edge).
- Full-resolution decode + render happens only on *Send*.
- Rationale: 36MP RAW decodes to ~200–430MB of pixels; that is unsafe in a
  phone browser but fine one-shot at export time (and even then, export is
  capped at 2560px so full-res decode is only needed to preserve DR before
  downscale — a detail to confirm during implementation).

### Auto algorithm (client-side, deterministic)

- Exposure: histogram black/white point stretch toward a target mid-luminance.
- White balance: gray-world (equalize channel means), refined by a neutral
  point when the user supplies one.
- Highlights: fixed default S-curve roll-off.
- Reset: identity adjustments.

## UI flow

1. **Auth** — phone / QR / 2FA. Session → localStorage.
2. **Main** — upload dropzone + group selector + thumbnail grid.
3. **Thumbnail** — processed preview + checkbox (default checked).
4. **Editor** — preview + Reset/Auto + exposure + highlights + WB (grey/skin
   pickers + temp/hue sliders).
5. **Send** — uploads all checked photos as photos (progress per file).

## Persistence (localStorage keys)

- `telegram.session`, `telegram.phone` (auth)
- `telegram.apiId`, `telegram.apiHash` (credentials, env-backed)
- `photoup.targetGroup` (selected group id + title)
- `photoup.settings` (export size/quality, default adjustments)

## Error handling

- Telegram calls wrapped in adapter: session expiry → re-auth; disconnect →
  backoff retry (reused from telegram-gallery).
- RAW decode failure → fall back to embedded JPEG preview + toast.
- Every `createObjectURL` paired with `revokeObjectURL`.

## Testing

- Playwright in Docker, mock adapter (`VITE_USE_MOCK_ADAPTER=true`).
- Coverage: auth flow; upload → processed thumbnail renders; editor controls
  change the preview; group selection persists; send invokes `sendMedia` with
  `photo` type and ≤2560px export.
- Image-pipeline unit tests run against `samples/` (gitignored, local-only).

## Docker / CI

- `Dockerfile`: multi-stage build → static serve.
- `docker-compose.yml`: `app` (dev, port 5173) + `playwright` (tests).
- `.github/workflows/ci.yml`: build + test in Docker.

## Open implementation risks

1. **libraw-wasm → wasm-vips buffer handoff.** Need an efficient path for
   16-bit RGB into wasm-vips (`Image.newFromMemory` preferred; intermediate
   16-bit PPM/TIFF as fallback).
2. **RAW decode memory on Android.** Mitigated by proxy-resolution editing and
   2560px export cap; confirm real memory during implementation.
3. **wasm-vips Vite bundling.** `@mtcute/wasm` and `wasm-vips` need
   `optimizeDeps.exclude` / asset-locating config (pattern known from
   telegram-gallery).
