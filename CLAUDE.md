# photoup — Agent Instructions

## What this project is

Browser-based photo corrector + Telegram uploader. The user uploads photos
(JPEG + Nikon NEF + Canon CR2) that are too dark or carry a monochrome camera
picture style, and the app auto-corrects exposure, applies mild highlight
rolloff, fixes white balance (RAW only), crops, and sends them to a chosen
Telegram group as **inline ≤2560px photos**.

Desktop Chrome. Client-only — no backend; all image processing and Telegram
interaction happens in the browser.

## Tech stack

- Svelte 5 + TypeScript (strict) + Vite
- `@mtcute/web` — Telegram MTProto client (auth, dialogs, upload)
- `libraw-wasm` — decode camera RAW (NEF/CR2) → camera-WB 16-bit linear RGB
- Browser canvas + Web Worker + `@jsquash/jpeg` — exposure/WB/tone/resize/encode (4:4:4 mozjpeg, adaptive quality to fit Telegram's ~10 MB photo limit)
- `localStorage` — session + settings persistence
- Docker (`node:20-alpine`, `--network host`) for all dev/build/test
- GitHub Actions — CI (build + Playwright tests in Docker)
- Playwright + mock Telegram adapter — UI tests

## SYSTEM BOUNDARIES — absolute hard rules

These rules override everything else. No exceptions.

1. **Working directory is the project root only.**
   Never `cd` outside it. Never read or write paths outside it. No `/tmp`,
   no `~/`, no absolute paths to other directories. Temporary files go in
   `./tmp/` (create it if missing; it is gitignored).

2. **Never install system-level tools.**
   No `apt`, `brew`, `yum`, `pip install` (outside a venv), `npm install -g`,
   `curl | bash`, or any command that modifies the host OS.

3. **Never modify system configuration.**
   No `/etc/`, no `~/.bashrc`, no `~/.gitconfig`, no system service files.

4. **All builds and dev run inside Docker. Nothing is installed on the host.**
   Every `npm`/`node` command runs in a `node:20-alpine` container with
   `--network host`. Build pattern:
   ```
   docker run --rm --network host \
     -v "$(pwd)":/app -w /app \
     node:20-alpine <command>
   ```
   Dev server pattern (port 5173, exposed via host networking):
   ```
   docker run --rm --network host \
     -v "$(pwd)":/app -w /app \
     node:20-alpine npm run dev -- --host --port 5173
   ```

5. **One server only — the dev server on port 5173.** There is no separate
   production or preview service. All work and all user-facing verification
   happen against this single dev server. Never start a second server (e.g.
   `vite preview` on another port) — it causes the stale-build confusion.
   If 5173 is in use, kill the process:
   `lsof -ti:5173 | xargs kill -9 2>/dev/null || true`

6. **Sample photos are never committed.** `samples/` is gitignored. Use them
   locally to verify the image pipeline, never add them to git.

7. **Verify before claiming "done" or "works".** Every behavior or UI change
   must be confirmed by running it — a Playwright test for behavior, or a
   screenshot for anything visual. Never assert a change is correct from reading the code diff alone.

## Commit discipline

**Commit after every logical block of work. Do not batch unrelated changes.**

A "logical block" is: a self-contained feature/sub-feature, a bug fix, adding
or updating tests, a refactor without behavior change, or a docs/config/tooling
update.

Commit flow (mandatory before moving to the next block):
1. `npm run check` (type check) inside Docker unless the change is docs-only.
2. Run the required test gate when the change touches executable behavior.
3. `git add -A && git diff --cached --stat` to review what will be committed.
4. Commit with a Conventional Commits message: `type: subject` (max 72 chars).
   Types: `feat` | `fix` | `refactor` | `style` | `chore` | `docs` | `test`
5. `git status` to confirm clean working tree.

The git log **is** the changelog. Keep commit subjects meaningful and scoped so
the history reads as a change log. Never use `--no-verify`.

## Code rules

1. **Adapter pattern for Telegram**: never import `@mtcute/web` in feature code.
   All Telegram calls go through `src/lib/telegram/adapter.ts` (interface) and
   `src/lib/telegram/mtcute.ts` (implementation). Reused from telegram-gallery.
2. **Adapter pattern for images**: never import `libraw-wasm` or `@jsquash/jpeg`
   in feature code. All image ops go through `src/lib/image/` engine modules.
3. **No `console.log` in production**: use `src/lib/debug.ts` (stripped in prod).
4. **URL lifecycle**: every `URL.createObjectURL()` must pair with
   `URL.revokeObjectURL()`.
5. **No `alert`/`confirm`**: use the Toast store and component.
6. **TypeScript strict**: no `any`, no type assertions outside adapter/engine
   boundary files.
7. **Progressive delivery**: every commit is a working, usable app. No stubs.

## Architecture

```
src/lib/telegram/adapter.ts   <- TelegramAdapter interface (only import contract)
src/lib/telegram/mtcute.ts    <- mtcute implementation
src/lib/telegram/mock.ts      <- mock for tests/dev
src/lib/image/raw.ts          <- libraw-wasm decode (RAW -> 16-bit linear float)
src/lib/image/process.ts      <- decoded base + render (exposure/WB/rolloff/crop)
src/lib/image/resize.ts       <- linear-space area-average downscale
src/lib/image/math.ts         <- clamp, fitWithin, cropToPixels, autoExposureEV
src/lib/image/worker.ts       <- @jsquash JPEG 4:4:4 encode worker (adaptive quality)
src/lib/image/encode.ts       <- encode worker RPC
src/lib/image/types.ts        <- shared image types
src/stores/                   <- Svelte writable stores (global state)
src/components/               <- Svelte components
src/App.svelte                <- root, screen switching via store
src/main.ts                   <- entry point
```

## State ownership

| State                 | Store             | Persisted              |
|-----------------------|-------------------|------------------------|
| TelegramClient        | stores/telegram   | No (in-memory)         |
| Auth state            | stores/telegram   | session -> localStorage |
| Selected target group | stores/settings   | localStorage           |
| Loaded photos         | stores/photos     | No                     |
| Per-photo adjustments | stores/photos     | No                     |
| User settings         | stores/settings   | localStorage           |

## Image pipeline (client-side)

Decoded sources are cached (a "base") and re-rendered on demand — edits never
re-decode the source and never run the expensive export encode.

1. **Decode (once, cached)**: RAW (NEF/CR2) via `libraw-wasm` → camera-WB 16-bit
   sRGB → gamma-decoded to **linear float RGB** (planar r/g/b). JPEG/PNG via
   browser decode (`createImageBitmap`). Always decode real RAW sensor data —
   never the embedded preview. RAW decode runs on the main thread (libraw-wasm
   spawns its own worker and does not initialize correctly in a nested worker).
   The base is held outside the reactive store and released on close/send/clear;
   only the actively-edited photo keeps one (decode-on-demand).
2. **Adjust (at render time)**:
   - WB is a relative warmth offset + hue (0 = camera as-shot / no change), with
     an auto-WB button (neutral-reference grey-world) and a drag-to-pick neutral
     picker. The preview applies the WB through the camera matrix
     (`M·diag(wb)·M⁻¹`) so it matches the userMul export exactly; the export
     bakes `camMul × offset` into libraw's `userMul` (pre color matrix, on the
     native sensor data). Uses `useCameraMatrix` for richer color.
   - Exposure: standard auto, a "Slide" aggressive auto (film-slide, hard clip,
     target 230), and manual. Plus mild highlight rolloff.
   - RAW only: a camera-"Standard"-style S-curve (mid-tone contrast + slight
     shadow lift) is applied in sRGB so RAW preview/export aren't flat — the
     JPEG already carries the camera's own tone.
   - JPEG: exposure + crop only (never alter color).
3. **Crop**: optional manual crop, applied at render time from the full-res base.
4. **Render**: a ≤512px thumbnail (browser JPEG) updates the grid/editor on every
   edit; the ≤2560px export (4:4:4 mozjpeg via `@jsquash`, **adaptive quality**:
   maximum quality, lowered only to stay under Telegram's ~10 MB photo limit) is
   rendered once at send. `@jsquash` encode runs in a worker so the UI stays
   responsive.
5. **Histogram**: a 256-bin luminance histogram over the final sRGB preview,
   shown in the editor and updated live with adjustments.

**Reprocess from the original decoded source** — never cumulatively from an
edited preview. **Keep memory low**: decode-on-demand, sequential processing
queue, release decoded buffers on close/replace, and show a live usage
indicator.

## Reference

- Telegram interaction (auth/QR/sendMedia/getDialogs/adapter): `telegram-gallery`
  — https://github.com/sshamanov/telegram-gallery.git
- Image serving / Docker patterns: `image-server` — git@github.com:sshamanov/post-server.git

## Authority documents

- `README.md` — project authority document (what/why, architecture, workflow).
- The git log — the change log (conventional commits).

If code changes architecture, supported behavior, workflow gates, or accepted
limitations, update `README.md` and this file in the same commit.
