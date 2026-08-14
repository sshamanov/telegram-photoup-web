# photoup — Detailed Implementation Plan

## 1. Goal

Build a desktop-only browser application for processing Canon/Nikon RAW and JPEG photographs and uploading selected results to a chosen Telegram group as inline photos.

The application is served as static files from Docker. All photo processing and Telegram communication happen in the browser.

Primary priorities:

1. image quality
2. predictable memory use with large RAW files
3. simple architecture
4. fast manual correction workflow
5. reliable Telegram upload

Do not add a backend, database, PWA support, Android-specific behavior, or generalized provider abstractions unless later required.

---

## 2. Confirmed Product Behavior

### 2.1 Supported sources

RAW:
- Canon RAW files used by the user
- Nikon RAW files used by the user
- always develop from RAW sensor data
- never use embedded JPEG previews as the processing source
- monochrome camera picture styles must not make the developed RAW monochrome

JPEG:
- preserve original color/B&W character
- exposure correction only
- crop allowed
- no JPEG white-balance controls

### 2.2 RAW white balance

Default:
- camera RAW white balance

Manual controls:
- Temperature
- Neutral/gray picker

Not included:
- automatic white balance
- Tint slider
- skin picker
- forced neutral rendering

Temperature is a relative warmer/cooler control. Do not promise Kelvin-accurate photographic calibration unless separately implemented and validated.

Neutral picker may internally apply full channel correction even though no explicit Tint control is exposed.

### 2.3 Exposure

RAW and JPEG:
- Auto exposure runs immediately after import
- global exposure only
- no selective shadow lifting
- preserve natural contrast
- mild highlight rolloff only
- some highlight clipping is preferable to strong HDR-like compression

RAW exposure range must tolerate very dark photographs:
- +2 to +4 EV may be normal
- manual slider target range: approximately -3 EV to +5 EV
- slider displays total applied EV, not an offset from Auto

Controls:
- Auto: recompute automatic EV
- moving slider: switch to manual exposure
- Reset: return exposure to baseline / 0 EV

Internal exposure mode:

```text
AUTO | MANUAL
```

Crop behavior:
- if exposure mode is AUTO, recompute Auto after crop commit
- if exposure mode is MANUAL, preserve the manually selected EV

JPEG Auto should be more conservative than RAW because JPEG has already been tone-mapped and has much less recoverable headroom.

### 2.4 Crop

- manual per-photo crop
- crop UI works from the current preview/master
- do not RAW-decode continuously while dragging
- crop becomes final only on commit/apply/mouse-up
- committed RAW crop may trigger a RAW re-decode
- crop must be applied before final resize
- use source resolution when needed so a deep crop can still produce a full 2560 px Telegram result

### 2.5 Telegram output

Target:
- inline Telegram photo
- maximum practical quality
- maximum dimension <= 2560 px

Preferred upload encoding:
- JPEG
- quality 100
- 4:4:4 chroma
- sRGB
- no unnecessary intermediate lossy encoding

Telegram may re-encode the photo. Our goal is to avoid adding visible loss before Telegram receives it.

Do not initially implement "send as file/document" unless later requested.

---

## 3. Proposed Architecture

```text
Docker static server
|
+-- HTML/CSS/JS
+-- application bundle
+-- RAW WASM module
|
v
Desktop Chrome

Main thread
|
+-- Svelte UI
+-- gallery state
+-- crop/editor state
+-- settings
+-- Telegram / mtcute
+-- processing queue
|
+--> RAW Worker
|     |
|     +-- LibRaw-based WASM module
|     +-- RAW unpack / demosaic
|     +-- camera WB / camera color conversion
|     +-- crop handling
|     +-- half/full-resolution decision
|     +-- exposure histogram/statistics
|     +-- resize
|
+--> image rendering/encoding path
      |
      +-- exposure
      +-- manual RAW WB adjustments
      +-- mild highlight rolloff
      +-- sRGB conversion
      +-- JPEG Q100 4:4:4
      |
      +--> mtcute --> Telegram
```

### 3.1 Frontend stack

Use:
- Svelte 5
- Vite
- strict TypeScript
- Web Worker for RAW processing
- `@mtcute/web` for Telegram
- Docker static serving

Keep Telegram integration direct and small.

Suggested module shape:

```text
src/
  telegram.ts
  processing/
    queue.ts
    raw-worker.ts
    raw-worker-api.ts
    jpeg.ts
    exposure.ts
    wb.ts
    crop.ts
  stores/
    gallery.ts
    settings.ts
  components/
    UploadView.svelte
    Gallery.svelte
    PhotoCard.svelte
    Editor.svelte
    CropEditor.svelte
    UsageIndicator.svelte
```

Do not build a generic Telegram provider abstraction.

A small `telegram.ts` API is enough:

```text
init()
login(...)
logout()
listGroups()
sendPhotos(groupId, blobs)
```

---

## 4. Storage

### 4.1 Telegram session

Use the storage mechanism recommended/supported by `@mtcute/web` for browser session persistence.

Do not manually serialize sensitive session internals to localStorage unless the library requires it.

### 4.2 App settings

Small application preferences may use localStorage:

```text
selected Telegram group id
last editor/UI preferences
optional crop UI preferences
```

### 4.3 Photo batch persistence

Do not persist full RAW/JPEG batches across browser reload by default.

Original input `File`/`Blob` objects live only for the active page session.

This keeps storage simple and avoids copying gigabytes of RAW data into IndexedDB/OPFS.

---

## 5. Image State Model

Each photo item should conceptually contain:

```ts
type PhotoItem = {
  id: string
  sourceFile: File
  sourceType: 'raw' | 'jpeg'

  selected: boolean

  status:
    | 'queued'
    | 'processing'
    | 'ready'
    | 'uploading'
    | 'sent'
    | 'error'

  crop: NormalizedCrop | null

  exposureMode: 'auto' | 'manual'
  exposureEV: number

  rawWB?: {
    temperatureOffset: number
    neutralCorrection?: [number, number, number]
  }

  thumbnailBlob?: Blob
  outputBlob?: Blob

  width?: number
  height?: number

  error?: string
}
```

Do not retain decoded full-resolution pixel buffers inside gallery state.

---

## 6. Memory Model

Memory discipline is a primary requirement.

### 6.1 Keep

For every imported image:
- original compressed `File`/`Blob`
- small thumbnail
- final/working <=2560 representation as needed
- edit parameters

### 6.2 Do not keep

Do not keep:
- full-resolution 16-bit RGB RAW conversions for multiple photos
- duplicate full-resolution buffers between JS and multiple WASM heaps
- decoded RAW image after the processing operation is complete

### 6.3 Working master

Preferred retained master for RAW editing:

```text
immutable linear RGB16 <=2560
```

Reason:
- sufficient for final <=2560 output
- compact relative to Float32
- edits are recalculated from the immutable master, not accumulated
- exposure calculations may use float math during rendering

Do not repeatedly modify the same RGB16 master in place.

### 6.4 Worker lifecycle

Only one RAW is processed concurrently.

Benchmark two worker strategies:

A. reuse one RAW Worker across the batch  
B. terminate and recreate the RAW Worker after each RAW

WASM linear memory may retain its high-water allocation even after internal `free()`. Worker termination may provide more predictable browser memory reclamation.

Do not choose A or B before measurement.

---

## 7. RAW Pipeline

Final implementation should be selected only after the comparison phase in section 13.

Expected logical pipeline:

```text
RAW File
  ↓
LibRaw unpack
  ↓
cropbox when crop exists
  ↓
half-size or full-resolution development decision
  ↓
demosaic
  ↓
camera WB
  ↓
camera color transform
  ↓
linear high-precision RGB
  ↓
Auto exposure analysis
  ↓
high-quality downsample to <=2560
  ↓
immutable linear RGB16 master
```

Important:
- do not use embedded preview
- do not use LibRaw auto-brightness as the application's exposure algorithm
- avoid generating a second full-resolution RGB output buffer if the custom WASM wrapper can consume LibRaw's internal processing buffer directly
- do not add a second large WASM image-processing library unless benchmarking proves it valuable

---

## 8. Half-Size vs Full-Resolution RAW Development

This must be benchmarked before final implementation.

For uncropped D810/4000D-class images, half-size RAW development may still produce more than 2560 px on the long side.

Potential normal path:

```text
D810:
7360 x 4912
→ half-size
3680 x 2456
→ high-quality resize
2560 x ~1709
```

This can substantially reduce processing area and memory.

### 8.1 Adaptive rule

For each crop:

```text
if half-size developed crop is still >= target output dimensions:
    use half-size path
else:
    use full-resolution path
```

Do not hardcode this based only on camera model.

Calculate from:
- source dimensions
- crop dimensions
- orientation
- desired final <=2560 dimensions

---

## 9. Crop Implementation

Store crop in normalized source coordinates:

```ts
type NormalizedCrop = {
  x: number // 0..1
  y: number // 0..1
  width: number // 0..1
  height: number // 0..1
}
```

This prevents preview-size/orientation changes from corrupting crop state.

### 9.1 Interaction

While dragging:
- modify only preview crop state
- no RAW re-decode
- no full-res work

On crop commit:
1. store normalized crop
2. determine whether half-size development still preserves enough resolution
3. re-run RAW development if RAW
4. create new <=2560 immutable master
5. release/recycle large RAW working memory
6. if AUTO exposure, recompute exposure
7. if MANUAL exposure, preserve EV

### 9.2 Crop presets

Initial implementation:
- free crop

Optional later:
- original aspect
- 1:1
- 4:3
- 3:2
- 16:9

Do not delay core implementation for presets.

---

## 10. Exposure Algorithm

The final exact algorithm must be tuned against the user's image samples.

Design goals:
- brighten genuinely dark photographs
- avoid selective shadow lifting
- avoid HDR appearance
- retain contrast
- tolerate some clipping
- avoid bright specular points preventing useful correction

### 10.1 Analysis input

RAW:
- use linear developed data before final gamma encoding
- half-size developed image is acceptable if quality tests confirm behavior

JPEG:
- decode JPEG
- convert values to an approximately linear working representation before exposure calculations

### 10.2 Statistics

Start with:
- median / central luminance
- upper-middle percentile
- high percentile clipping guard

Do not let the darkest parts of the frame dominate the calculation.

Do not enforce "no clipped pixels".

Tiny specular highlights should be allowed to clip.

### 10.3 Exposure transform

Conceptually:

```text
linear RGB
→ multiply by 2^EV
→ mild highlight shoulder
→ clip
```

No local tone mapping.

No separate shadow curve.

### 10.4 Highlight shoulder

Keep it simple:
- affects only upper tonal range
- short transition
- no broad compression
- preserve clean bright rendering

The shoulder parameters must be visually tuned from representative samples.

---

## 11. RAW White Balance

Initial camera development:

```text
camera WB
```

Manual Temperature:
- warmer/cooler relative adjustment
- no promise of exact Kelvin calibration

Neutral picker:
1. user enters picker mode
2. user clicks a neutral region
3. sample a small area, not one pixel
4. reject clipped/near-black pixels
5. use robust statistics such as median/trimmed average
6. calculate channel correction
7. apply correction to RAW working pipeline
8. update preview

Neutral picker may correct green/magenta internally even though there is no exposed Tint slider.

Auto exposure must not modify WB.

---

## 12. JPEG Pipeline

```text
JPEG File
  ↓
browser decode
  ↓
orientation
  ↓
crop
  ↓
resize / build <=2560 working representation
  ↓
linearized exposure calculation
  ↓
global EV
  ↓
mild highlight shoulder
  ↓
sRGB
  ↓
JPEG encode
```

No:
- WB correction
- colorization
- saturation correction
- RAW-style highlight recovery

B&W JPEG remains B&W.

JPEG Auto exposure must be conservative compared with RAW.

---

# 13. Mandatory Pre-Implementation Comparison Phase

Do not finalize the image pipeline before these tests are complete.

The purpose is to replace assumptions with measured behavior on the user's actual files.

Create a small `/bench` or developer-only test harness if useful.

Store results in a markdown/JSON benchmark report committed to the repo.

Suggested output:

```text
BENCHMARKS.md
bench/results.json
```

## 13.1 Test corpus

Use representative real files, not synthetic-only tests.

Minimum RAW corpus:
- several Nikon D810 NEFs
- several Canon RAWs from the user's actual Canon body
- normal exposure
- -2/3 EV
- approximately -2 EV
- very dark RAW requiring +3 to +4 EV
- high-contrast scene with bright highlights
- monochrome camera picture style
- warm lighting
- cool lighting
- image requiring neutral-picker correction
- deeply cropped image

JPEG corpus:
- normal JPEG
- dark JPEG
- B&W JPEG
- highlight-heavy JPEG

Keep these under a local ignored `samples/` directory if redistribution is undesirable.

---

## 13.2 RAW decoder validation

Compare candidate LibRaw WASM approaches/builds.

Verify:

- D810 NEF opens
- Canon RAW opens
- B&W picture-style RAW develops as color
- camera WB metadata is accessible/usable
- orientation is correct
- dimensions are correct
- no embedded-preview path is accidentally used
- 16-bit/high-precision output is available
- browser Worker bundling works reliably

Reject any candidate with camera-format instability.

---

## 13.3 Half-size vs full-size quality comparison

For each representative RAW:

Generate:

A. full-resolution demosaic → resize to 2560  
B. half-size demosaic → resize to 2560

Compare at 100% and 200% crops:

- fine texture
- hair
- foliage
- diagonal edges
- text/signage
- moiré
- aliasing
- color artifacts
- highlight edge behavior
- noise character

Record:
- decode time
- peak memory
- output quality observations

Decision rule:

Use half-size as default only if differences at the final 2560 output are visually negligible for the intended use.

If specific cameras/scenes behave badly, keep an adaptive or full-resolution fallback.

---

## 13.4 Crop-path comparison

Test:

A. full frame → develop → crop → resize  
B. RAW cropbox → develop cropped region → resize

Use:
- mild crop
- 50% crop
- deep crop near 2560 target resolution
- very deep crop requiring full-resolution path

Verify:
- crop coordinates map correctly
- no Bayer/demosaic border corruption
- orientation is correct
- output resolution decision is correct
- cropbox meaning matches expected LibRaw behavior
- memory benefit is real

Do not assume crop reduces RAW unpack memory; measure actual browser peak.

---

## 13.5 Memory benchmark

This is a release gate.

Measure at minimum:

- Chrome process/task memory if available manually
- JS heap where available
- WASM heap size/growth
- application-owned buffer accounting
- time spent at each stage

Test:

1. one D810 RAW
2. 10 D810 RAWs sequentially
3. crop/re-edit same D810 RAW repeatedly
4. Canon RAW equivalent
5. mixed RAW/JPEG batch

Compare:

A. persistent worker  
B. worker recreated after each RAW

Also compare:
- full-size development
- half-size development
- cropped development

Acceptance:
- memory must stabilize instead of growing continuously over repeated files
- processing 10+ RAWs sequentially must not accumulate one full decoded image per file
- reopening/cropping must not leak large buffers

Add visible application accounting such as:

```text
Queue: 7
Processing: DSC_1234.NEF
Stage: Demosaic
Source: 47 MB
Working estimate: 80 MB
Output: 12 MB
```

Do not claim this is exact browser RAM.

---

## 13.6 Resizer comparison

Do not ship a quick bilinear resizer without comparison.

Compare at least:
- high-quality area/separable downsample
- Lanczos-class implementation
- any LibRaw/WASM-adjacent implementation being considered

Images:
- foliage
- hair
- architecture
- fine text
- high ISO noise
- repeated patterns

Judge:
- detail retention
- halos/ringing
- moiré
- edge jaggies
- noise texture
- speed
- memory

The final choice should prioritize visual quality, then memory/speed.

---

## 13.7 Linear RGB16 vs Float32 retained master

Build both variants temporarily.

Compare:
- memory
- exposure/WB render speed
- repeated editing
- +4 EV RAW corrections
- neutral picker adjustments
- highlight shoulder

Edits must always restart from immutable master data.

Expected result:
- RGB16 master should be sufficient
- float math can be used per render

But verify rather than assume.

Use Float32 permanently only if a visible or algorithmic advantage is demonstrated.

---

## 13.8 Auto exposure tuning test

Create a grid comparing algorithm variants.

Candidate parameters:
- central percentile/median target
- high percentile guard
- allowed clipping fraction
- maximum RAW auto EV
- maximum JPEG auto EV
- highlight shoulder start/strength

For each sample, record:
- calculated EV
- whether subject brightness looks correct
- whether image retains intended darkness
- whether broad highlights are damaged
- whether tiny speculars are allowed to clip
- whether image becomes flat/HDR-like

The user preference is authoritative:
- no excessive shadow lifting
- clean highlights
- natural contrast
- clipping is acceptable before strong compression

Do not optimize purely for histogram metrics.

---

## 13.9 JPEG Auto comparison

Explicitly test JPEG separately.

Cases:
- +0.5 EV
- +1 EV
- +2 EV
- very dark JPEG

Determine practical auto-EV ceiling from visual results.

Do not simply reuse RAW limits.

---

## 13.10 JPEG encoder comparison

The final Telegram input should be JPEG Q100 4:4:4.

Compare at least:

A. browser `OffscreenCanvas.convertToBlob()` quality=1  
B. explicit JPEG encoder with guaranteed:
   - quality 100
   - 4:4:4
   - controlled sRGB conversion

Compare:
- file size
- chroma detail
- fine red/blue edges
- text
- gradients
- encode speed
- memory

If browser output cannot guarantee 4:4:4, use an explicit encoder.

Prefer compiling the JPEG encoder into the same WASM module if practical rather than adding another large runtime.

---

## 13.11 Telegram format test

Before locking upload encoding, send the same processed photo to a private test group using:

1. JPEG Q100 4:4:4
2. PNG
3. optionally browser-Q100 JPEG

All should be sent as inline photos where Telegram accepts that behavior.

Then retrieve/download the largest Telegram-delivered photo and compare:

- dimensions
- file size
- visual artifacts
- edge detail
- chroma detail
- recompression behavior

If PNG and JPEG produce effectively the same Telegram result, standardize on JPEG Q100 4:4:4.

The expected architecture remains JPEG unless testing clearly contradicts it.

---

## 13.12 Telegram upload behavior

Verify with `@mtcute/web`:

- session persists after reload
- login works
- 2FA works if enabled
- group list resolves correctly
- stored selected group can be resolved after reload
- one photo upload works
- multiple selected photos work
- desired album grouping works if used
- ≤2560 JPEG is sent as inline photo
- upload errors are surfaced per item
- retry does not duplicate successfully sent photos

Keep Telegram logic independent from image processing.

---

# 14. Decision Gates

Do not move from spike code to final implementation until these are decided.

## Gate A — RAW decoder

Must know:
- chosen LibRaw WASM/build
- Canon/Nikon compatibility
- how to access processing data without unnecessary full-res copies

## Gate B — resolution strategy

Must know:
- whether half-size is visually acceptable at final 2560 output
- exact adaptive rule for half-size vs full-size after crop

## Gate C — memory

Must know:
- measured D810 peak
- measured Canon peak
- worker reuse vs recreate behavior
- no sequential-batch growth/leak

## Gate D — resize

Must select:
- final high-quality resize algorithm
- measured quality/performance tradeoff

## Gate E — exposure

Must have:
- RAW Auto tuning
- JPEG Auto tuning
- highlight shoulder parameters
- allowed clipping behavior validated against samples

## Gate F — encoding/Telegram

Must know:
- JPEG encoder choice
- whether explicit 4:4:4 encoder is needed
- Telegram result of JPEG vs PNG comparison

Only after all gates pass should the prototype paths be consolidated into the final production pipeline.

---

# 15. Implementation Phases

## Phase 1 — Skeleton

Implement:
- Svelte/Vite/TS project
- Docker static serving
- upload input
- gallery item state
- selection checkbox
- editor shell
- processing queue
- worker messaging
- basic usage indicator
- mock Telegram module

No image-quality tuning yet.

Acceptance:
- batch files appear immediately
- one worker task at a time
- UI never blocks on RAW work

---

## Phase 2 — RAW spike

Implement minimal:
- LibRaw WASM Worker
- D810/Canon decode
- camera WB/color
- half-size/full-size experiments
- direct output access
- benchmark instrumentation

Produce `BENCHMARKS.md`.

Do not build final editor around the spike until Gate A/B/C decisions are made.

---

## Phase 3 — Processing core

Implement:
- immutable <=2560 RGB16 master
- exposure statistics
- global EV
- mild highlight shoulder
- RAW Temperature
- Neutral picker
- high-quality resize
- JPEG path

All edits are parameter-based and rendered from immutable source/master.

---

## Phase 4 — Crop

Implement:
- free crop UI
- normalized crop coordinates
- preview-only drag
- commit semantics
- RAW re-decode on commit
- half/full resolution decision
- AUTO/MANUAL exposure preservation rules

---

## Phase 5 — Encoder

Implement selected JPEG path:
- sRGB conversion
- Q100
- 4:4:4
- Blob output

Verify no accidental intermediate JPEG is used during editing.

---

## Phase 6 — Telegram

Replace mock with direct `@mtcute/web` integration.

Implement:
- login/session
- group selection
- persistent selected group
- upload selected ready photos
- per-item state/error/retry

Do not mix Telegram concerns into processing Worker code.

---

## Phase 7 — Final QA

Run:
- full benchmark corpus
- repeated batch memory test
- crop/re-edit stress test
- Telegram delivery comparison
- browser reload/session test

Then remove:
- unused comparison implementations
- temporary encoders
- unused resize paths
- benchmark-only UI

Keep reproducible benchmark scripts/tests.

---

# 16. UI Requirements

Main screen:

```text
[Telegram account/status]
[Target group selector]

[Upload photos]

[thumbnail][✓]
[thumbnail][✓]
[thumbnail][✓]
...

[Upload selected]
```

Thumbnail:
- actual processed output appearance
- selected by default
- processing/error indicator
- source type marker optional

Editor:

RAW:

```text
image / crop overlay

Reset   Auto

Exposure  [-3 ........ +5]

Temperature [cool .... warm]

Neutral Picker

Crop / Apply
```

JPEG:

```text
image / crop overlay

Reset   Auto

Exposure

Crop / Apply
```

Do not expose technical RAW controls.

---

# 17. Processing Status / Usage Indicator

Purpose:
- show that the app is working
- make large RAW behavior understandable
- help diagnose memory issues

Display only values we can honestly know or estimate:

```text
Processing 2 / 8
DSC_1234.NEF
Stage: Resize
Source file: 48 MB
Working estimate: 90 MB
```

Optional developer mode may show:
- Worker WASM heap size
- stage timings
- decode dimensions
- half/full-size choice

Do not label estimates as exact Chrome memory use.

---

# 18. Automated Tests

## Unit tests

Cover:
- normalized crop conversion
- half/full resolution decision
- exposure mode transitions
- EV multiplication
- highlight shoulder monotonic behavior
- neutral picker robust sampling
- temperature parameter behavior
- JPEG conservative auto-EV constraints
- resize dimension calculations
- orientation calculations

## Worker tests

Cover:
- one task at a time
- task cancellation
- worker failure
- worker recreation
- large-file queue progression
- stale result rejection if user changes crop while processing

## UI tests

Use Playwright with mocks for:
- import batch
- default checked state
- deselect
- open editor
- exposure adjustment
- Auto
- Reset
- crop commit
- RAW/JPEG control differences
- group persistence
- upload success/failure
- retry behavior

## Golden-image tests

Keep a small redistributable fixture set where possible.

For deterministic stages:
- compare output dimensions
- compare histograms/statistics
- compare selected pixel ranges/tolerance

Do not rely only on pixel-perfect JPEG comparisons across different encoders/browser versions.

---

# 19. Error Handling

Per-photo errors should not abort the entire batch.

Examples:

```text
Unsupported RAW
RAW decode failed
Not enough memory
JPEG decode failed
Processing cancelled
Telegram upload failed
Telegram authorization expired
Target group unavailable
```

On recoverable processing error:
- keep original source
- keep item in gallery
- allow retry

On memory failure:
- terminate RAW Worker
- recreate clean Worker
- retry only if safe
- do not automatically loop forever

---

# 20. Non-Goals

Do not add:

- backend photo processor
- Android support
- PWA/offline installability
- automatic WB
- Tint UI
- skin detection/picker
- AI colorization
- HDR/local tone mapping
- selective shadow recovery
- cloud photo storage
- persistent batch recovery
- generalized Telegram/provider abstraction
- TIFF workflow
- full photo-management features

---

# 21. Final Acceptance Criteria

The implementation is ready when:

1. D810 and target Canon RAWs reliably develop from sensor data.
2. B&W RAW picture style produces normal color output.
3. RAW files are auto-exposed immediately.
4. +3 to +4 EV RAW correction remains visually usable on appropriate samples.
5. highlights remain clean without strong HDR-like compression.
6. JPEG B&W stays B&W.
7. RAW has only Camera WB + Temperature + Neutral picker.
8. crop preserves source detail and can still produce 2560 px output when source crop permits.
9. one RAW at a time is processed.
10. repeated large RAW processing does not continuously grow memory.
11. gallery does not retain full-resolution decoded RAWs.
12. final inline photo is <=2560 px.
13. final upload encoding is the winner of the JPEG/PNG/encoder comparison, expected to be JPEG Q100 4:4:4.
14. Telegram session and selected group survive page reload.
15. selected photos upload reliably as inline Telegram photos.
16. benchmark decisions and comparison results are documented.
17. no backend is required beyond static file serving.
