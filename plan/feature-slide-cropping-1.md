---
goal: Non-destructive per-slide cropping for image and PDF exports
version: 1.0
date_created: 2026-11-12
last_updated: 2026-11-12
owner: Flashbang maintainers
status: Completed
tags: [feature, slide-cropping, electron, image-export, pdf]
---

# Introduction

![Status: Completed](https://img.shields.io/badge/status-Completed-brightgreen)

Add crop presets, an adjustable retained-area rectangle, and optional automatic black-bar detection to captured slides. Keep the original screenshot visible and unchanged; shade only the area that will be discarded with translucent red and diagonal red hatching. Apply the crop to PNGs inside ZIP exports and to images embedded in PDFs.

Implemented on 2026-11-12. The user waived further browser automation and testing beyond the automated suites after implementation. Repository root: `D:/VS Code Programs/flashbang`. Source references were verified at baseline revision `18c7ce7`; line numbers below identify the original integration points and may have moved.

Verified baseline:

- Captures converge at [electron/screenCapture.ts:19](file:///D:/VS%20Code%20Programs/flashbang/electron/screenCapture.ts#L19); both window capture and screen-region capture create temporary PNGs.
- [electron/tempManager.ts:5](file:///D:/VS%20Code%20Programs/flashbang/electron/tempManager.ts#L5) and [src/types/index.ts:21](file:///D:/VS%20Code%20Programs/flashbang/src/types/index.ts#L21) define separate `ScreenshotItem` interfaces. Images and their metadata last only for the current session.
- [electron/export.ts:11](file:///D:/VS%20Code%20Programs/flashbang/electron/export.ts#L11) implements PDF export; `exportToZip` starts at line 90 and currently copies original PNG bytes.
- [src/components/EditorArea.tsx:149](file:///D:/VS%20Code%20Programs/flashbang/src/components/EditorArea.tsx#L149) displays the original image with zoom/pan but has no crop controls.
- [electron/db.ts:26](file:///D:/VS%20Code%20Programs/flashbang/electron/db.ts#L26) provides SQLite-backed default settings. New default keys are inserted by `initDatabase` at line 97.
- Both existing TypeScript configurations passed `tsc --noEmit` on the inspected baseline. There is no existing automated test suite or test script.

## 1. Requirements & Constraints

- **REQ-001**: Crops belong to individual screenshot IDs, not queue positions, tabs, capture coordinates, or presentation files. Reordering and closing/reopening a tab retain that image's crop. Deleting an image deletes its metadata.
- **REQ-002**: Offer these aspect-ratio presets in order: `16:9`, `4:3`, `16:10`, `3:2`, `1:1`, `9:16`, `3:4`, plus `Free` selection and `Reset crop`. Selecting a preset starts with the largest centered rectangle of that ratio inside the original image; users can move and resize it without stretching the image.
- **REQ-003**: Provide a per-slide `Crop` editor with rectangle drawing, dragging the retained area, and four corner resize handles. Preset selection locks the ratio; `Free` unlocks it without changing the current rectangle. `Apply` commits the draft; `Cancel` or Escape restores the saved crop. `Reset crop` immediately clears the saved crop after a successful update.
- **REQ-004**: Original pixels remain visible during editing and afterward. Only excluded pixels receive `rgba(239,68,68,0.18)` fill and `repeating-linear-gradient(135deg, rgba(239,68,68,0.55) 0 2px, transparent 2px 8px)`. The retained area stays clear. Handles appear only while editing. The overlay must follow image zoom, pan, resizing, and tab changes.
- **REQ-005**: Original temporary PNG bytes, `filePath`, `dataUrl`, `width`, `height`, and `sizeBytes` remain unchanged by cropping. Render cropped PNG bytes only during export; never rasterize the editor, its hatching, or its handles into output.
- **REQ-006**: PDF and ZIP use the same crop-to-PNG implementation. Exact PDFs use cropped pixel dimensions as page dimensions, preserving existing pixel-to-point behavior. A4 PDFs retain A4 sizing and the existing 24-point margin; auto orientation and image fitting use cropped dimensions. PNGs without a crop are exported byte-for-byte unchanged.
- **REQ-007**: Add a persisted, default-off `autoDetectBlackBars` toggle labeled `Auto-crop black bars on new captures`. Snapshot its value when each capture starts. While enabled, independently detect each incoming screenshot before emitting its captured event; do not reuse the last slide's rectangle. This applies equally to the capture button, global hotkey, window capture, region capture, and window fallback capture.
- **REQ-008**: Turning automatic detection on or off never changes existing images. Uncertain detection leaves a new image uncropped. Manual edits or reset remain authoritative for that image; export never reruns detection. Restart restores the toggle but not the temporary image session.
- **REQ-009**: Provide `Detect black bars` for the active slide inside the crop editor. It updates only the draft on a successful match, with Apply required to save. No match preserves the current draft and displays `No confident black bars found`. Detection errors preserve existing pixels and crop metadata.
- **REQ-010**: Show original and output dimensions, for example `1920 × 1080 → 1440 × 1080 px`, and a `Cropped` indicator in the image list with `Manual` or `Auto` in its accessible description. Explain near the editor that `Red areas are removed from exported images and PDFs` and that unapplied changes are not exported.
- **SEC-001**: New crop IPC accepts existing image IDs and crop metadata only, never renderer-provided paths, PNG bytes, or output destinations. Validate runtime payloads, finite coordinates, enum values, nonzero rectangles, bounds, and preset-ratio consistency in the main process. Restrict new handlers to the main window's main frame. Do not change Electron security settings.
- **CON-001**: This feature edits screenshots of PowerPoint slides, not `.ppt`/`.pptx` files. No PowerPoint parser, OCR, AI service, network upload, presentation import, single-image save route, bulk editing UI, or session-recovery system is included.
- **CON-002**: Use installed Electron `nativeImage`, `pdf-lib`, JSZip, React, and TypeScript. Add no production or development dependency for this feature; use Node's built-in test/assert libraries and an Electron integration-test script.
- **CON-003**: Keep the existing physical screen capture and DIP conversion logic unchanged. Crop coordinates refer only to the final captured PNG, not desktop coordinates or CSS pixels. Do not broaden this work into consolidating unrelated duplicated types or changing build output paths.
- **GUD-001**: Prefer missing an uncertain black border over discarding slide content. Auto detection is a heuristic, not a guarantee; dark slide backgrounds can resemble borders. Originals, visible overlays, manual adjustment, and Reset are mandatory safeguards.
- **PAT-001**: Main-process `tempManager` owns committed crop metadata. The renderer owns only temporary editing drafts. Publish committed changes through the existing `on-images-updated` event; do not introduce a second persistent image store.

### Data and geometry contract

Create dependency-free `electron/crop.ts`. It must not import Electron, Node, React, or filesystem APIs so both renderer and main code can use it without changing either TypeScript root directory.

```ts
export interface CropRect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export const CROP_PRESETS = {
  '16:9': 16 / 9,
  '4:3': 4 / 3,
  '16:10': 16 / 10,
  '3:2': 3 / 2,
  '1:1': 1,
  '9:16': 9 / 16,
  '3:4': 3 / 4,
} as const;

export type CropPreset = keyof typeof CROP_PRESETS;
export type CropCorner = 'nw' | 'ne' | 'sw' | 'se';

export interface CropSpec {
  rect: CropRect;
  preset: CropPreset | null;
  source: 'manual' | 'auto';
}

export interface PixelCropRect {
  x: number;
  y: number;
  width: number;
  height: number;
}
```

- `CropRect` is the retained rectangle, normalized to the original image; `(0,0)` is top-left and `(1,1)` is bottom-right. Bounds are `0 <= left < right <= 1` and `0 <= top < bottom <= 1`. Pixel rectangles use half-open far edges.
- Add required `crop: CropSpec | null` to both existing `ScreenshotItem` definitions; initialize every new screenshot with `null`. Add required `autoDetectBlackBars: boolean` to both `AppSettings` definitions and initialize it to `false` in database and renderer defaults.
- `fitCropPreset(width, height, preset): CropRect`: for ratio `r`, use retained width `min(width, height*r)` and retained height `retainedWidth/r`, centered within the source. Compute with floating-point source pixels, then normalize.
- `toPixelCrop(rect, width, height): PixelCropRect`: round normalized near/far edges to nearest integers. Clamp the near x/y edges to `[0,width-1]`/`[0,height-1]`; clamp the far edges to `[near+1,width]`/`[near+1,height]`. Derive width/height by subtraction. Use this same conversion for preview dimensions, validation, and export. No resize or padding is performed.
- `validateCropSpec(value: unknown, width: number, height: number): CropSpec | null`: reject malformed input instead of silently repairing it; return a detached copy of valid metadata. Validate normalized bounds before pixel conversion. When a preset exists, require the floating-point pixel width to differ from `height * presetRatio` by no more than `0.000001 * max(width,height)`. Canonicalize a rectangle whose converted pixel bounds are the full image to `null`.
- `moveCropRect(rect, dxPixels, dyPixels, width, height): CropRect`: translate in source pixels and clamp translation at the image bounds without resizing.
- `resizeCropRect(rect, corner, point, preset, width, height): CropRect`, with `point: {x:number; y:number}` in source pixels: anchor the opposite corner, prohibit crossing it, and clamp to source bounds. Free resizing uses independent x/y extents of at least one pixel. Locked resizing projects the desired positive extents `(dx,dy)` onto `(r,1)`: `h=(r*dx+dy)/(r*r+1)`, `w=r*h`; clamp `h` between `max(1,1/r)` and the maximum permitted by both image edges. If the anchored position cannot fit that minimum, retain the prior rectangle.
- `rectFromPoints(start, end, width, height): CropRect | null`: clamp the endpoints to source bounds, order the edges, and reject rectangles under one source pixel in either dimension. Drawing a new rectangle switches to Free mode; moving or resizing does not.
- All coordinate updates preserve floating-point geometry until pixel conversion. Output aspect ratios can differ from the selected ratio by edge rounding of at most one pixel per dimension.

### IPC contract

Add these methods to the preload bridge and renderer `ElectronAPI`:

```ts
setImageCrop: (
  id: string,
  crop: CropSpec | null
) => Promise<{ success: boolean; image?: ScreenshotItem; error?: string }>;

detectImageCrop: (
  id: string
) => Promise<{ success: boolean; crop?: CropSpec | null; error?: string }>;
```

- Channels are `set-image-crop` and `detect-image-crop`. Verify `event.sender === mainWindow.webContents` and `event.senderFrame === mainWindow.webContents.mainFrame`, with the existing null/destroyed-window checks, before accessing files or changing metadata.
- `set-image-crop`: resolve an existing ID, validate metadata using its original dimensions, update only that item's crop, emit `on-images-updated`, and return the updated item. Unknown/deleted IDs and invalid payloads return `success:false` without an event or mutation.
- `detect-image-crop`: resolve an existing ID, detect from its original PNG, and return `success:true` with either an automatic `CropSpec` or `null`. This method never mutates the item. An I/O or decoding failure returns `success:false`.
- Do not assign detection responses to a different active slide. Discard responses after a draft is canceled/replaced or its image ID is no longer active.
- Validate a supplied `autoDetectBlackBars` setting as a boolean in the existing settings-save boundary; reject invalid values before writing settings. Existing settings keys and serialization remain unchanged.

### Automatic detection contract

Create `electron/blackBarDetection.ts` with pure `detectBlackBars(pixels: Uint8Array, width: number, height: number): CropRect | null`. Input is a full-resolution, tightly packed four-byte bitmap from `nativeImage.toBitmap({scaleFactor:1})`. On Windows the channel layout is BGRA; the algorithm uses the maximum of the first three bytes, so channel ordering does not affect its decision. Use an opaque colored fixture to verify this native adapter.

Implement these fixed initial rules, rather than a generic bounding box around non-black content:

1. Scan once to accumulate near-black counts per row and column. A pixel is near-black when `alpha >= 250` and `max(channel0,channel1,channel2) <= 20`. A row/column qualifies as a bar line when at least `99.5%` of its pixels are near-black.
2. Count consecutive qualifying lines from each image edge. Evaluate left/right as one pair and top/bottom as another. A pair qualifies only when both runs are at least `2` pixels, neither exceeds `floor(axisLength*0.25)`, and their thickness difference is at most `max(2,round(axisLength*0.005))`. A run extending beyond the limit fails that axis; do not truncate it into a valid border.
3. Start with the full image and remove only qualifying pairs. If no pair qualifies, return `null`. Single-sided borders and significantly asymmetric pairs are intentionally left untouched on that axis.
4. Require the candidate to retain at least `32` pixels on each axis and at least `50%` of the original area. Reject fully black frames and candidates failing these conditions.
5. For each trimmed edge, examine the three-pixel-wide strip immediately inside the candidate, across its retained opposite dimension. At least `10%` of that strip must have `alpha >= 250` and `max(channel0,channel1,channel2) > 40`. Reject the candidate if any trimmed edge lacks this transition. This avoids treating sparse central text on a dark slide as a reliable slide boundary.
6. Return the exact detected integer edges normalized to the source dimensions, without snapping to any aspect-ratio preset. Store successful results as `{rect, preset:null, source:'auto'}`. No match must never reuse another slide's result.

`electron/imageProcessing.ts` provides the native adapters:

- `detectScreenshotCrop(item: ScreenshotItem): CropSpec | null`: read the original PNG, decode at scale factor 1, obtain the actual bitmap dimensions and pixels, call `detectBlackBars`, and wrap a match as automatic metadata. Decode failures throw; callers implement the distinct automatic/manual error behavior described above.
- `getProcessedPng(item: ScreenshotItem): Buffer`: read the original PNG. If `crop === null`, return the bytes unchanged. Otherwise decode at scale factor 1, convert the normalized rect using decoded PNG dimensions, call `nativeImage.crop`, and return `.toPNG()`. Do not cache processed copies or write over temporary originals.

### Editor behavior contract

- Place a compact crop toolbar in `EditorArea` beneath the tabs. Keep capture-target controls separate in `SettingsPanel`; they continue to select what is initially captured, not what is removed at export.
- Maintain the crop draft per active editing session, initialized from the committed item or the full-image rectangle. Selecting a new tab, closing the tab, deleting the image, or receiving a newly captured active image cancels the draft. State this behavior in the editor's help text. Existing committed crops are unaffected.
- Use `CropEditor` for the toolbar, image viewport, existing zoom/pan controls, draft management, and image-aligned overlay; `EditorArea` retains the tab bar and hosts this component beneath it. Move the existing viewport/zoom/pan implementation into `CropEditor` rather than maintaining two viewers. Pass `image: ScreenshotItem`, `onApply: (id: string, crop: CropSpec | null) => Promise<boolean>`, and `onDetect: (id: string) => Promise<{success:boolean; crop?:CropSpec | null; error?:string}>`. Key the component by image ID to cancel drafts/reset zoom on a tab change. Own the image element ref inside `CropEditor`. Render the saved exclusion overlay even when crop-editing mode is closed.
- Keep the overlay within the same transformed wrapper as the image. The wrapper must match the rendered image content, not the full editor viewport; move the existing image border outside the measured content box. Use `ResizeObserver` for image-only CSS dimensions and the image's current `getBoundingClientRect()` for pointer mapping: `x=(clientX-rect.left)*image.width/rect.width`, with the corresponding y formula. Do not multiply by zoom or devicePixelRatio again.
- Render four non-overlapping exclusion rectangles: top and bottom across full width, then left and right across the retained vertical interval. Hide zero-sized rectangles. Hatching is visual only; use labeled controls and text for accessibility rather than color alone.
- Use Pointer Events and pointer capture. Primary-button interactions in crop mode draw, move, or resize; they must not trigger image panning. Preserve existing zoom controls and allow middle-button pan while cropping. On pointer cancellation restore the pre-gesture draft. Wheel events over controls must not initiate crop gestures.
- Keep existing primary-button pan behavior outside crop mode. Suspend transform animation during gestures. Focusable retained-area and corner controls support arrow-key movement by one source pixel, or ten with Shift, through the same geometry functions. Do not add or change global shortcuts.
- Manual preset selection, drawing, moving, or resizing sets draft `source:'manual'`; a detection result stays `source:'auto'` until manually adjusted. Disable Apply/Reset/detect during the current request. Apply failure leaves the editable draft and shows an error; do not optimistically change committed metadata.
- Export always uses committed metadata. Buttons remain usable with a draft open but show the explicit `Apply crop before exporting changes` hint. Do not implicitly apply a draft on export.

## 2. Implementation Steps

Each phase declares its prerequisites. Within a phase, tasks without dependencies on one another may run in parallel only when their owned files do not overlap. `Completed` remains `No` until the specified verification succeeds.

### Implementation Phase 1

- **GOAL-001**: Establish the crop model, deterministic geometry, conservative detector, and native PNG processing. Prerequisites: none. Completion: pure modules compile, new images initialize without crops, and native helpers never alter source files.

| Task | Description | Completed | Date |
|------|-------------|-----------|------|
| TASK-001 | Create `electron/crop.ts` with the exact types, preset map, validation, and six geometry functions defined above. Keep imports empty. Verify the 1920×1080 / 4:3 preset converts to `{x:240,y:0,width:1440,height:1080}`. | Yes | 2026-11-12 |
| TASK-002 | Depends on TASK-001. In `electron/tempManager.ts:5`, `src/types/index.ts:21`, `electron/db.ts:8,26`, and `src/App.tsx:10`, add the declared crop/settings fields and defaults. Add `TempManager.setCrop(id: string, crop: CropSpec \| null): ScreenshotItem \| null`; replace the item with a new object and a detached crop copy rather than mutating an existing item or nested rect. Keep `getItems()` and its existing ordering behavior. Initialize `crop:null` in `addScreenshot` at line 47. The renderer imports the pure crop types from `../../electron/crop`; no global type consolidation. | Yes | 2026-11-12 |
| TASK-003 | Depends on TASK-001; can run alongside TASK-002. Create `electron/blackBarDetection.ts` implementing the six detection rules exactly. Use typed row/column count arrays, no external API or image-content bounding box, and no thresholds exposed in settings. Verify clean centered letterbox and pillarbox fixtures and all-black rejection. | Yes | 2026-11-12 |
| TASK-004 | Depends on TASK-002 and TASK-003. Create `electron/imageProcessing.ts` with `detectScreenshotCrop` and `getProcessedPng` as specified. Decode original PNG buffers with `nativeImage.createFromBuffer`, reject empty images, and use the 1x representation consistently. Verify native PNG dimensions and unchanged original file hashes. | Yes | 2026-11-12 |

### Implementation Phase 2

- **GOAL-002**: Connect crop updates, incoming captures, and both export paths to one committed metadata source. Prerequisite: GOAL-001. Completion: main-process updates are validated, capture events include final auto-crop metadata, and PDF/ZIP remove the same pixels.

| Task | Description | Completed | Date |
|------|-------------|-----------|------|
| TASK-005 | In `electron/main.ts` beside image handlers at line 152, add `set-image-crop` and `detect-image-crop` with the exact IPC contract. Add the boolean check to `save-settings` at line 110. Extend `electron/preload.ts:5` and `src/types/index.ts:39` with both methods; preserve existing unsubscribe functions and events. Invalid IDs/payloads must not mutate metadata or accept paths. | Yes | 2026-11-12 |
| TASK-006 | In `electron/screenCapture.ts:19`, keep the existing initial settings snapshot but await the selected capture branch into a local item. When that snapshot enables auto detection, call `detectScreenshotCrop`, store a successful match using `tempManager.setCrop`, and return the updated item before callers publish it. On detector read/decode errors, log the error and return the original uncropped item without failing the capture. Do not edit `captureWindow`, `cropScreenRegion`, or hotkey callback logic; their return path already converges here, including fallback captures. | Yes | 2026-11-12 |
| TASK-007 | In `electron/export.ts:34,113`, replace raw file reads with `getProcessedPng(item)`. Use the cropped embedded PNG dimensions for all existing PDF layout calculations. Preserve missing-file handling, ZIP numbering, compression, cancellation, and dialogs. The initial `getItems()` snapshot is stable because TASK-002 replaces objects; subsequent crop changes must not change an export already awaiting its save dialog. | Yes | 2026-11-12 |

### Implementation Phase 3

- **GOAL-003**: Deliver per-slide crop editing and visible automatic-crop status without changing capture-region selection. Prerequisite: GOAL-002. Completion: presets/free selection can be applied and reset, discarded pixels show the required hatching, and all controls remain usable at the minimum window size.

| Task | Description | Completed | Date |
|------|-------------|-----------|------|
| TASK-008 | Create `src/components/CropEditor.tsx` implementing the editor behavior contract using the pure geometry functions. Move the existing viewport and zoom/pan behavior from `EditorArea.tsx:31-80,135-197` into this component, integrating the image-aligned overlay without changing the zoom limits. Include preset/Free selection, Apply/Cancel/Reset, Detect black bars, exclusion rectangles, keyboard-capable move/corner handles, per-request disabling, and source/output dimension display. Keep draft state local; never mutate image props. | Yes | 2026-11-12 |
| TASK-009 | Depends on TASK-008. In `src/App.tsx` beside action handlers at line 177, add `handleSetImageCrop` returning success as a boolean and `handleDetectImageCrop` returning the declared detection result; use existing toast errors. Pass callbacks into `EditorArea` at line 292. Update `src/components/EditorArea.tsx:11,31,135` to render the keyed `CropEditor` beneath its retained tab bar, passing the active image and callbacks; remove the viewport/zoom/pan code moved in TASK-008. Continue to refresh committed images through the existing `on-images-updated` listener at `src/App.tsx:73`; do not double-append captures. | Yes | 2026-11-12 |
| TASK-010 | Can run alongside TASK-008 and TASK-009 because it owns separate files. In `src/components/SettingsPanel.tsx` under Capture Target at line 61, add the persisted auto-detect checkbox and `Checks each new capture; existing images stay unchanged` text. Keep it visible even with no images. In `src/components/Sidebar.tsx:101`, add the small Cropped indicator with Manual/Auto description without interfering with delete/reorder. Wrap or scroll new controls at 800×600 without hiding existing actions. | Yes | 2026-11-12 |

### Implementation Phase 4

- **GOAL-004**: Verify crop geometry, image fidelity, export integration, and interactive workflows. Prerequisites: GOAL-002 for automated test construction; GOAL-003 before final interactive verification. Completion: all tests/builds pass, native and browser checks are performed, and no original capture is altered.

| Task | Description | Completed | Date |
|------|-------------|-----------|------|
| TASK-011 | Create `tests/crop.test.cjs` using `node:test` and `node:assert/strict`, requiring compiled `dist-electron/crop.js` and `dist-electron/blackBarDetection.js`. Generate fixtures in memory; implement TEST-001 through TEST-004. No fixture downloads or committed screenshot assets. | Yes | 2026-11-12 |
| TASK-012 | Can run alongside TASK-011. Create `tests/crop-electron.test.cjs` as an Electron main script using native images, assert, existing `pdf-lib`/JSZip, and temporary fixtures. Before readiness set isolated `userData` and `temp` paths under a new OS-temporary sandbox; call `initDatabase` and `tempManager.init` only there. Stub `dialog.showSaveDialog` to sandbox paths, exercise real processing/export functions, and restore it in `finally`. Implement TEST-005 through TEST-008 and TEST-012. Always clean only the test-owned sandbox and exit Electron with code 0 on success or 1 on failure. | Yes | 2026-11-12 |
| TASK-013 | Depends on TASK-011 and TASK-012. In `package.json:7`, add `test:crop` with value `npm run build:electron && node --test tests/crop.test.cjs && electron tests/crop-electron.test.cjs`. Keep other scripts and dependencies unchanged. Run `npm run test:crop` and `npm run build:all`; both must exit 0. | Yes | 2026-11-12 |
| TASK-014 | Depends on TASK-009, TASK-010, and TASK-013. Run `npm start` and verify TEST-009 through TEST-011 in the real Electron app. Also open its Vite renderer in a browser with a temporary in-memory `window.electronAPI` test double for fixture-driven crop gestures; keep that double outside production source. Check browser/Electron console errors and screenshots at 800×600 and 1200×800. Verify capture/hotkey and save-dialog behavior in Electron, not just the browser mock. Report any unavailable interactive checks as unverified, not passed. Remaining interactive checks were waived by the user; see verification notes below. | Waived by user | 2026-11-12 |

## 3. Alternatives

- **ALT-001**: Destructively crop on capture or Apply. Rejected because users could not move or remove a crop later, and false automatic matches would permanently discard original slide content.
- **ALT-002**: Crop only through CSS or a PDF clipping rectangle. Rejected because CSS does not change ZIP pixels, and PDF-only clipping can retain unwanted original pixels inside the document. Both outputs must embed the actually cropped PNG.
- **ALT-003**: Detect once and reuse that rectangle for every future image. Rejected because a mixed 16:9/4:3 sequence requires per-image decisions; a successful prior match does not establish the next slide's borders.
- **ALT-004**: Find the bounding box of all non-black pixels or use AI/OCR. Rejected because sparse/dark slide content causes unsafe cropping, and local paired-edge detection meets the black-bar requirement without dependencies or uploads.
- **ALT-005**: Add a cropping library or reorganize all shared types into a new build root. Rejected for this small feature: the existing image APIs and one dependency-free geometry module suffice without packaging changes.

## 4. Dependencies

- **DEP-001**: Installed Electron 31 exposes `nativeImage.createFromBuffer`, `getSize`, `toBitmap`, `crop`, and `toPNG`. Verify actual 1x bitmap dimensions/channel handling with TEST-005; do not assume desktop DIP coordinates are image pixels.
- **DEP-002**: Installed `pdf-lib` and JSZip implement the two current export routes. No package upgrades or lockfile changes are planned.
- **DEP-003**: Node 24 in the development environment supplies the pure test runner. The Electron integration script runs under Electron's bundled Node runtime and must not require host-only Node 24 APIs.
- **DEP-004**: Existing SQLite default-key insertion persists the new boolean without a schema migration. Existing sessions have no durable image records to migrate.
- **DEP-005**: Windows desktop access is needed for real global-hotkey, window/region capture, DPI, and native-dialog checks. A browser test double cannot validate these integrations.

## 5. Files

Paths below are relative to the repository root. New-file names are planned locations; existing-file links above and in Related Specifications identify verified source anchors.

- **FILE-001**: `electron/crop.ts` — new pure crop types, presets, validation, pixel conversion, and gesture geometry.
- **FILE-002**: `electron/blackBarDetection.ts` — new pure paired-edge detector.
- **FILE-003**: `electron/imageProcessing.ts` — new native PNG detection/export adapters.
- **FILE-004**: `electron/tempManager.ts` — per-item crop metadata and immutable `setCrop` updates.
- **FILE-005**: `electron/db.ts` — `AppSettings.autoDetectBlackBars` and its default.
- **FILE-006**: `electron/screenCapture.ts` — one auto-detection call after capture branches converge.
- **FILE-007**: `electron/main.ts` — validated crop IPC and new-setting validation.
- **FILE-008**: `electron/preload.ts` — two narrow crop bridge methods.
- **FILE-009**: `electron/export.ts` — shared cropped PNG processing for PDF and ZIP.
- **FILE-010**: `src/types/index.ts` — mirrored image/settings fields and renderer IPC declarations.
- **FILE-011**: `src/App.tsx` — default setting and per-image crop/detection action wiring.
- **FILE-012**: `src/components/EditorArea.tsx` — retain tabs and host the per-image crop editor; move viewport behavior to the new component.
- **FILE-013**: `src/components/CropEditor.tsx` — new crop draft controls, existing zoom/pan viewport, and image-aligned red exclusion overlay.
- **FILE-014**: `src/components/SettingsPanel.tsx` — future-capture auto-detect toggle.
- **FILE-015**: `src/components/Sidebar.tsx` — per-image Cropped status.
- **FILE-016**: `tests/crop.test.cjs` — new pure geometry/detector tests.
- **FILE-017**: `tests/crop-electron.test.cjs` — new isolated native image/export tests.
- **FILE-018**: `package.json` — one test script; no dependency changes.

## 6. Testing

- **TEST-001**: Presets and rounding. A 1920×1080 image with a centered 4:3 crop produces `240,0,1440,1080`; a 1600×1200 image with a centered 16:9 crop produces `0,150,1600,900`. Test all seven presets, portrait images, odd dimensions, a one-pixel free crop, a full-image no-op, and normalized edge rounding without out-of-bounds pixels. Ratio drift must remain within the specified edge-rounding tolerance.
- **TEST-002**: Validation and gesture geometry. Reject NaN, Infinity, negative/out-of-range edges, zero/reversed rectangles, unknown presets/sources, and preset-inconsistent rectangles. Move without resizing, clamp all four edges, resize from each corner with/without lock, prohibit corner crossing, reverse free-draw direction, and verify keyboard-sized pixel increments.
- **TEST-003**: Positive detection fixtures. Generate opaque light-content images with exact black and near-black RGB(20,20,20) paired borders: 240-pixel left/right bars at 1920×1080, 150-pixel top/bottom bars at 1600×1200, and combined bars retaining at least 50% area. Expect exact detected integer edges. Include under-threshold bright pixel contamination and the pair-symmetry tolerance boundary.
- **TEST-004**: Conservative detection fixtures. Expect null for a full-content borderless slide, all-black/all-white frames, transparent frames, sparse white text on black, single-sided/asymmetric borders, one-pixel borders, non-black RGB(21,21,21) borders, runs over the 25% limit, insufficient inner transition, and candidates under the retained-area/dimension limits. Over-threshold pixel contamination must not be accepted as a clean black bar.
- **TEST-005**: Native adapter correctness. Generate colored corner/edge sentinels and an opaque near-black-bar fixture using `nativeImage.createFromBitmap`; round-trip PNG to bitmap and verify dimensions, alpha, detector bounds, and crop output pixel positions. Check that `.toBitmap({scaleFactor:1})` yields exactly `width*height*4` bytes for the selected representation. Cropping must not swap channels, stretch content, or introduce hatching.
- **TEST-006**: ZIP and source integrity. Crop one image, leave another untouched, and export twice; parse ZIP with JSZip. Verify ordered filenames, cropped dimensions and sentinel positions, exact uncropped PNG byte identity, and unchanged SHA-256 hashes for every original PNG. Reset/re-crop must always start from the original rather than a prior export.
- **TEST-007**: PDFs. Parse exported PDFs with `pdf-lib`; verify exact-page sizes match processed PNG dimensions and embedded image XObjects have cropped width/height, not original uncropped dimensions. Test A4 auto/portrait/landscape with a crop changing image orientation, preserve the 24-point margin, and check aspect-preserving fit. Compare rendered content visually with corresponding ZIP images; no red overlay may be embedded.
- **TEST-008**: Metadata lifetime and export snapshots. Set a crop, reorder images, and confirm it remains with the same ID. Verify `setCrop` does not mutate previously returned objects or crop rects. Change a crop while the test save-dialog promise is unresolved; that export must use its initial snapshot and the next export must use the new crop. Unknown/deleted IDs fail without mutation. Verify the toggle survives database reload in the isolated test profile, while newly added screenshots always initialize with `crop:null`.
- **TEST-009**: Native capture sequence. Turn auto detection on; capture 4:3 pillarboxed, full-width 16:9, and dark uncertain slides in sequence. Only confident matches get independent crops, with none inherited from the preceding image. Repeat through button/hotkey, region/window, and window fallback. Toggle off: future images are uncropped and old crops remain. Override/reset an auto crop and confirm later captures/export do not overwrite it. Test a detection failure without losing the captured screenshot.
- **TEST-010**: Interactive crop editor. Apply each preset, draw a reversed-direction free rectangle, drag/resize to every boundary, run Detect, Apply/Cancel/Reset, switch/close tabs, delete an edited image, and receive a new capture during a draft. Verify no stale detection response lands on another slide. Test at 25%, 100%, and 400% zoom with pan, window resize, and 100%/150%/200% Windows display scaling. The translucent hatched region must cover exactly the excluded area, remain visible after Apply, and disappear after Reset.
- **TEST-011**: Interaction regression and accessibility. At 800×600 and 1200×800 verify focus labels, arrow/Shift-arrow controls, Escape cancel, empty-state toggle visibility, save/cancel/error states, disabled in-flight controls, unchanged capture coordinates, region/window overlays, existing zoom/pan, reorder, deletion, clear-all, and global undo semantics. Browser and Electron consoles must have no new uncaught errors. A no-match Detect request must retain the draft and show its message.
- **TEST-012**: Detection performance. Generate 3840×2160 fixtures in memory. Warm the pure detector five times, then measure thirty runs; require median under 100 ms on the development machine and report the machine and median. Measure native decode plus detection separately and report it without hiding that cost. Verify a manual ten-capture burst loses no captured events and keeps ordering correct. If the pure detector misses the target, optimize the single-pass loop and rerun all detector fixtures before completion; do not silently loosen thresholds.

Run commands from the repository root after implementation:

```sh
npm run test:crop
npm run build:all
npm start
```

Implementation verification on 2026-11-12: all 155 pure tests and 16 native Electron checks passed, as did `npm run build:all` and `git diff --check`. The 4K detector median was 30.59 ms; file-read/decode/detection median was 94.78 ms on the development i7-7700. Browser checks confirmed all seven preset dimension previews, Apply/Cancel/Reset, and saved red hatching. An isolated Electron instance verified renderer/main crop IPC, rejection of another window's crop requests, invalid payloads, and PDF/ZIP export calls. The running user instance and its settings/screenshots were not modified.

Further interactive automation was stopped at the user's request. Actual region capture of the test window returned an uncropped image because the window's thin non-black border prevented a confident paired-edge match, consistent with RISK-002. Full-screen follow-up, complete pointer/keyboard/zoom/pan workflows, native window/hotkey capture, and Windows DPI checks remain unverified rather than passed. The isolated development server was stopped; no test harness or fixture was added to production source.

## 7. Risks & Assumptions

- **RISK-001**: Uniform dark slide artwork can be visually indistinguishable from letterboxing. The defined paired-edge and transition checks reduce false positives but cannot eliminate them. Keep detection opt-in, preserve originals, and require the visible exclusion overlay and reset path.
- **RISK-002**: Window borders, title bars, uneven letterboxing, compressed video, and animated transitions may prevent confident detection. These cases remain manual-crop workflows; this iteration does not attempt UI-chrome removal or temporal analysis.
- **RISK-003**: Mixing desktop DIPs, image pixels, and transformed CSS coordinates can misalign previews and exports. Normalized original-PNG coordinates, one conversion function, and explicit zoom/DPI tests are release requirements.
- **RISK-004**: Full-resolution PNG decoding/detection occurs in the main process. The performance check bounds detector cost; total decode cost must also be reported. Do not add a worker pool preemptively, but do not claim acceptable responsiveness without testing it.
- **RISK-005**: Image and settings types are duplicated across process boundaries. Change both definitions and both settings defaults in TASK-002, and compile both configurations; do not put Electron imports into the pure module used by the renderer.
- **ASSUMPTION-001**: “Processed as images” means the existing PNG-in-ZIP export, not an additional single-image save feature.
- **ASSUMPTION-002**: Red hatching marks pixels that will be removed, not retained pixels. It is a preview annotation and must never appear in exported content.
- **ASSUMPTION-003**: Automatic mode means redetect every future image while enabled, not copy one detected rectangle to all images. No existing captures are silently batch-modified.
- **ASSUMPTION-004**: Per-image crop metadata follows the existing temporary-session lifetime. Only the auto-detect preference survives application restarts; no session persistence is introduced.
- **ASSUMPTION-005**: Rectangular clipping is sufficient. Rotation, perspective correction, arbitrary polygons, adjustable detection thresholds, and user-defined saved presets are outside this feature.

## 8. Related Specifications / Further Reading

- [README.md:13](file:///D:/VS%20Code%20Programs/flashbang/README.md#L13) — existing capture, export, and temporary-session behavior.
- [electron/main.ts:123](file:///D:/VS%20Code%20Programs/flashbang/electron/main.ts#L123) and [electron/hotkeys.ts:34](file:///D:/VS%20Code%20Programs/flashbang/electron/hotkeys.ts#L34) — button and global-hotkey capture callers.
- [electron/preload.ts:34](file:///D:/VS%20Code%20Programs/flashbang/electron/preload.ts#L34) and [src/App.tsx:73](file:///D:/VS%20Code%20Programs/flashbang/src/App.tsx#L73) — existing full-image-list update event and renderer listener.
- [src/components/SettingsPanel.tsx:184](file:///D:/VS%20Code%20Programs/flashbang/src/components/SettingsPanel.tsx#L184) — current image/PDF save actions.
- [tsconfig.electron.json:6](file:///D:/VS%20Code%20Programs/flashbang/tsconfig.electron.json#L6) and [tsconfig.json:23](file:///D:/VS%20Code%20Programs/flashbang/tsconfig.json#L23) — existing compilation boundaries; keep output layout unchanged.
- [package.json:7](file:///D:/VS%20Code%20Programs/flashbang/package.json#L7) — build and development scripts.
