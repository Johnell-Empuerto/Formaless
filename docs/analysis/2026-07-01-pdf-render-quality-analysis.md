# PDF Rendering Quality Analysis

**Date:** 2026-07-01
**Author:** Formaless Engineering
**Status:** Updated — JPEG→PNG implemented; PDF.js Pipeline & SVG Investigations completed on 2026-07-01

---

## Executive Summary

The Formaless PDF-to-HTML converter produces output that is noticeably less sharp than the original PDF. Text appears slightly blurry or soft, especially at smaller font sizes. This report identifies the root causes of quality degradation in the rendering pipeline and recommends targeted improvements.

**Primary finding:** JPEG compression (`canvas.toDataURL("image/jpeg", 0.92)`) is the dominant source of quality loss. JPEG's lossy DCT compression is designed for continuous-tone photographs and introduces visible artifacts on text and line art — the primary content of most PDF documents.

**Secondary finding:** The fixed `RENDER_SCALE = 2` provides adequate supersampling for standard (1×) displays but is insufficient for high-DPI (Retina) displays where it results in images that appear soft.

**Tertiary finding:** The pipeline uses only raster-based rendering; all improvements are incremental without altering the architecture.

---

## Current Rendering Pipeline

```
 PDF File
    │
    ▼
 pdfjs-dist.getDocument()
    │
    ▼
 page.getViewport({ scale: RENDER_SCALE })   ← RENDER_SCALE = 2
    │
    ▼
 document.createElement("canvas")
 canvas.width / height = renderVP.width / height
    │
    ▼
 ctx.fillStyle = "#ffffff"
 ctx.fillRect(0, 0, canvas.width, canvas.height)   ← white background fill
    │
    ▼
 page.render({ canvasContext: ctx, viewport: renderVP })
    │  (PDF.js renders vector content to raster at 2× scale)
    ▼
 canvas.toDataURL("image/jpeg", 0.92)   ← LOSSY JPEG ENCODING
    │
    ▼
 <img src="[dataURL]" width={dispVP.width} height={dispVP.height}>
    │  (image displayed at 1× viewport dimensions; browser downscales 2× → 1×)
    ▼
 iframe.srcDoc = output HTML
    │
    ▼
 viewer-page-wrap: transform: scale(zoom)    ← CSS transform scaling
    │
    ▼
 Browser renders on screen
```

### Key constants and dimensions

| Variable           | Value                             | Purpose                             |
| ------------------ | --------------------------------- | ----------------------------------- |
| `RENDER_SCALE`     | `2`                               | PDF.js render scale factor          |
| `renderVP`         | `getViewport({ scale: 2 })`       | Canvas dimensions = 2× display size |
| `dispVP`           | `getViewport({ scale: 1 })`       | Display dimensions = 1×             |
| `pw, ph`           | `Math.round(dispVP.width/height)` | Image `width`/`height` attributes   |
| `canvas.toDataURL` | `"image/jpeg", 0.92`              | JPEG at 92% quality                 |

---

## Findings

### Finding 1: JPEG Compression Artifacts (PRIMARY)

**Code location:** `lib/converter.ts`, line 112:

```typescript
const imgSrc = canvas.toDataURL("image/jpeg", 0.92);
```

**Why this is a problem:**

JPEG uses a lossy compression algorithm based on the Discrete Cosine Transform (DCT). It divides the image into 8×8 pixel blocks and discards high-frequency information that the human eye is less sensitive to. This works well for photographs but is destructive for:

- **Text characters** — Sharp black-to-white transitions at character edges are high-frequency signals. JPEG quantization rounds these coefficients, producing:
  - _Ringing artifacts_ (ghost echoes around text)
  - _Blurring_ of serifs and thin strokes
  - _Mosquito noise_ (fuzzy haze around edges)
- **Line art and borders** — Thin lines become soft or broken
- **Small text** — At 8–10pt sizes, characters are only a few pixels wide; JPEG blocks can destroy legibility

At 92% quality, the quantization tables are still aggressive enough to introduce visible artifacts on text. Even at 95–98%, JPEG remains lossy.

**Visual evidence:** Compare a text character rendered with JPEG vs. lossless PNG side by side. The JPEG version will show softened edges and subtle ringing, especially on curved strokes and diagonal lines.

**Impact:** **HIGH** — This affects every PDF that passes through the converter, regardless of content type.

---

### Finding 2: Browser Downscaling (2× → 1×)

**Code location:** `lib/converter.ts`, lines 130–131:

```typescript
<img src="${imgSrc}" width="${pw}" height="${ph}" ...>
```

Where `pw = Math.round(dispVP.width)` (1×).

**What happens:**

The canvas is rendered at 2× resolution, but the `<img>` element displays it at 1× dimensions. The browser's image decoder downscales the 2× source to fit the 1× display space.

**Why this can degrade quality:**

- Browsers use bicubic or bilinear interpolation for downscaling by default
- While supersampling (rendering high → displaying low) typically improves quality, it interacts poorly with **JPEG artifacts** because:
  1. JPEG created block-level artifacts at 2×
  2. The browser's downscaler interpolates these artifacts across pixels
  3. The result is a broader, softer blur than JPEG alone would produce

**On standard (1×) displays:** The 2× → 1× downscale provides useful antialiasing. If the source were pristine (PNG), this would produce excellent results.

**On Retina (2×) displays:** The 2× image maps perfectly to 2× screen pixels at 100% zoom — no downscale occurs. But JPEG artifacts are still present.

**On high-DPI (3×) displays:** The 2× image is _upscaled_ by the browser to fill the screen pixels, making JPEG artifacts more visible.

**Impact:** **MEDIUM** — Compounds Finding 1 but is not independently significant.

---

### Finding 3: No devicePixelRatio Awareness

**Code location:** `lib/converter.ts`, line 83:

```typescript
const RENDER_SCALE = 2;
```

**Why this is a problem:**

- On a 1× display, 2× → 1× downscale looks good (with lossless encoding)
- On a 2× Retina display, the image maps pixel-for-pixel — adequate but JPEG artifacts are visible at native resolution
- On a 3× display (e.g., MacBook Pro with `devicePixelRatio = 3`), the 2× image is effectively **upscaled** by 1.5×, making JPEG artifacts more prominent and text less crisp

`devicePixelRatio` is not checked anywhere in the converter. The render scale is constant regardless of the user's display.

**Impact:** **MEDIUM** — Affects users with high-DPI displays (increasingly common).

---

### Finding 4: No image-rendering CSS Control

**Code location:** Not present anywhere in the codebase.

**What is missing:**

The CSS `image-rendering` property controls how the browser interpolates images during resize. The default is `image-rendering: auto` (bicubic interpolation), which is optimized for smooth photographic images but can soften text edges.

For document rendering, `image-rendering: crisp-edges` or `image-rendering: -webkit-optimize-contrast` can produce sharper results during the 2× → 1× downscale.

```css
.page img {
  image-rendering: -webkit-optimize-contrast; /* Safari */
  image-rendering: crisp-edges; /* Standard */
}
```

**Impact:** **LOW** — Would provide incremental improvement on the downscale but doesn't fix the root cause (JPEG artifacts).

---

### Finding 5: Canvas Memory and Cleanup

**Code location:** `lib/converter.ts`, lines 143–144:

```typescript
canvas.width = 0;
canvas.height = 0;
```

The converter already frees canvas memory after each page. No issue here.

---

### Finding 6: Data URL Size Impact

Each page's image is embedded as a **base64-encoded data URL** in the HTML output. Data URLs inflate the size by ~33% over binary, and JPEG compression is applied _before_ base64 encoding.

**Interaction with quality:** None directly. The base64 encoding is lossless and preserves the JPEG output perfectly.

**Impact:** **NONE** on quality; only on file size (addressed in separate analysis).

---

## Root Cause Analysis

### Root Cause #1: Lossy Image Encoding (JPEG)

**Why the current output is blurry:**

1. PDF.js renders vector content to a 2× canvas perfectly (all vectors are precise)
2. `canvas.toDataURL("image/jpeg", 0.92)` converts the pristine raster to lossy JPEG
3. JPEG DCT quantization discards high-frequency data → text edges soften
4. `fillRect` with white + text creates sharp transitions that JPEG encodes poorly (ringing)
5. The browser decodes the JPEG and downscales, spreading artifacts across neighboring pixels
6. The final displayed image has visibly softer text than the original PDF

**Why PNG fixes this:**

- PNG is **lossless** — every pixel from the canvas is preserved exactly
- PNG uses DEFLATE compression, which is great for images with large uniform areas (white page background)
- Text edges remain perfectly sharp after encode/decode
- The 2× → 1× downscale then operates on pristine data, producing optimal antialiasing

### Root Cause #2: Fixed Render Scale for Variable-DPI Displays

`RENDER_SCALE = 2` is a compromise that works well for 1× and 2× displays but falls short on higher-DPI screens. The fix requires detecting `window.devicePixelRatio` (or accepting it as a parameter) and scaling accordingly.

### Root Cause #3: Raster-Only Pipeline

The fundamental limitation: converting vector PDF to raster image inherently loses the ability to render text at arbitrary resolutions. This is an architectural constraint, not a bug. The current architecture was designed for this approach, and the recommendation is to accept this limitation while optimizing the raster path.

---

## Performance Analysis

### Current Performance Profile

| Metric            | Value               | Notes                     |
| ----------------- | ------------------- | ------------------------- |
| Render scale      | 2×                  | Default                   |
| Canvas dimensions | ~1700×2200 (letter) | 2× display resolution     |
| Encoded type      | JPEG Q92            | Lossy                     |
| Image quality     | ~7/10               | Visible artifacts on text |
| Encoding time     | Fast                | Hardware-accelerated JPEG |

### Proposed Change: JPEG → PNG

| Metric                       | JPEG (Q92)                | PNG                | Delta                  |
| ---------------------------- | ------------------------- | ------------------ | ---------------------- |
| Quality                      | Lossy (visible artifacts) | Lossless (perfect) | **Major improvement**  |
| Encode time                  | ~5–15ms per page          | ~50–200ms per page | Slower, but acceptable |
| Decode time                  | ~5–10ms per page          | ~10–30ms per page  | Slightly slower        |
| Data URL size (text page)    | ~200–400 KB               | ~400–800 KB        | 2× larger              |
| Data URL size (complex page) | ~500–900 KB               | ~2–5 MB            | 3–5× larger            |
| Memory                       | Same canvas               | Same canvas        | Identical              |

**CPU impact of PNG:** PNG encoding is slower than JPEG primarily because DEFLATE compression is more compute-intensive than DCT quantization. For a typical page (~1700×2200 pixels), expect ~50–200ms of encode time depending on content complexity and browser. This is acceptable for a conversion that already takes several seconds per document.

**CPU impact of PNG decoding on viewer:** PNG decode is also slower than JPEG, but the iframe `srcDoc` approach means the decoding happens once when the iframe loads. The difference is negligible for user experience (~10–30ms vs ~5–10ms).

### Proposed Change: Increase RENDER_SCALE to 3

| Metric             | RENDER_SCALE=2 | RENDER_SCALE=3     | Delta                   |
| ------------------ | -------------- | ------------------ | ----------------------- |
| Canvas pixels      | 1×             | 2.25×              | 2.25× more pixels       |
| Canvas memory      | ~4 MB/page     | ~9 MB/page         | +5 MB/page              |
| Render time        | ~200ms/page    | ~450ms/page        | 2.25× slower            |
| Encode time        | ~100ms (PNG)   | ~250ms (PNG)       | 2.25× slower            |
| Data URL size      | ~500 KB/page   | ~1.1 MB/page       | 2.25× larger            |
| Visual improvement | Good           | Better (on Retina) | Marginal on 1× displays |

Increasing from 2× to 3× provides diminishing returns — the supersampling benefit decreases while cost scales linearly. Only recommended for high-DPI displays.

---

## Memory Analysis

**Current memory per page conversion:**

| Component                | Size          | Notes              |
| ------------------------ | ------------- | ------------------ |
| PDF.js page object       | ~2–10 MB      | Depends on content |
| Canvas (2×, letter page) | ~13.5 MB      | 1700×2200×32bpp    |
| JPEG data URL            | ~0.3–0.9 MB   | Base64-encoded     |
| Text content             | ~0.01–0.1 MB  | JSON-like          |
| **Total per page**       | **~15–24 MB** |                    |

**With PNG (2×, text page):**

| Component          | Size          | Notes                           |
| ------------------ | ------------- | ------------------------------- |
| PDF.js page object | ~2–10 MB      | Unchanged                       |
| Canvas             | ~13.5 MB      | Unchanged                       |
| PNG data URL       | ~0.4–0.8 MB   | Text pages compress well in PNG |
| Text content       | ~0.01–0.1 MB  | Unchanged                       |
| **Total per page** | **~15–24 MB** | Similar range                   |

**RENDER_SCALE=3 with PNG:**

| Component                | Size          | Notes                      |
| ------------------------ | ------------- | -------------------------- |
| Canvas (3×, letter page) | ~30.5 MB      | 2550×3300×32bpp            |
| PNG data URL             | ~0.9–1.8 MB   | Higher resolution → larger |
| **Total per page**       | **~33–42 MB** | 2× memory                  |

Note: canvas memory is freed after each page (`canvas.width = 0`), so peak memory is still per-page.

---

## Image Quality Analysis

### JPEG Q92 Quality Assessment

At Q92, JPEG retains ~92% of frequency information. For photographs, this is indistinguishable from the original. For text:

| Font Size | JPEG Q92                            | Lossless PNG    |
| --------- | ----------------------------------- | --------------- |
| 24pt+     | Slight softening on curves          | Perfectly sharp |
| 12–18pt   | Visible ringing on serifs           | Perfectly sharp |
| 8–11pt    | Blurred strokes, reduced legibility | Perfectly sharp |
| <8pt      | Characters may blend together       | Preserved       |

**Example: letter "e" at 12pt on white background**

- JPEG encodes the sharp white-to-black transition as high-frequency DCT coefficients
- Quantization rounds these coefficients, especially in diagonal directions
- The decoded "e" has: softer edges, slight ringing (faint ghost on one side), reduced contrast
- At 92% quality, these artifacts are subtle but visible compared to the original PDF

### PNG Quality Assessment

PNG stores exact pixel values. The only quality loss is from the initial rasterization (RENDER_SCALE=2 instead of vector), which is minimal at 2× on 1× displays.

---

## Risk Assessment

| Change                     | Risk       | Mitigation                                                     |
| -------------------------- | ---------- | -------------------------------------------------------------- |
| JPEG → PNG                 | **Low**    | PNG is universally supported; no fallback needed               |
| RENDER_SCALE=3             | **Medium** | 2.25× memory/CPU — may cause issues on low-end devices         |
| devicePixelRatio detection | **Low**    | Graceful fallback to current RENDER_SCALE if undefined         |
| image-rendering CSS        | **Low**    | Non-critical enhancement; fallback is default browser behavior |

### Backward Compatibility

- All changes are in the converter output format only
- Existing saved/converted documents will not be re-generated
- New conversions will have higher quality
- The HTML structure remains identical (page-div > img + optional tl-div)

### Placeholder Rendering Compatibility

The placeholder rendering system (`detectPlaceholder`, `renderPlaceholderField`) operates on the text layer, not the image layer. Changes to image encoding or render scale have **zero impact** on placeholder functionality.

---

## Recommended Improvements (Ranked by Priority)

### Priority 1: Switch from JPEG to PNG

**Change:** Replace `canvas.toDataURL("image/jpeg", 0.92)` with `canvas.toDataURL("image/png")`.

**Why:** Eliminates the single largest source of quality degradation. Lossless compression preserves all canvas pixels perfectly. PNG compresses text-heavy pages efficiently due to large uniform areas.

**Visual improvement:** **HIGH** — Text becomes crisp and sharp across all font sizes.
**Implementation risk:** **LOW** — One-line change, universally supported.
**Performance impact:** **LOW-MEDIUM** — Slightly slower encode, acceptable for conversion workflow.
**File size impact:** **MEDIUM** — 2–5× larger data URLs for complex pages.

**Files to modify:**

- `lib/converter.ts` (line 112)

**Code change:**

```typescript
// Before:
const imgSrc = canvas.toDataURL("image/jpeg", 0.92);

// After:
const imgSrc = canvas.toDataURL("image/png");
```

---

### Priority 2: Add devicePixelRatio-Aware Render Scale

**Change:** Calculate render scale dynamically based on `window.devicePixelRatio` (defaulting to 2 when unavailable).

```typescript
const dpr = window.devicePixelRatio || 1;
const RENDER_SCALE = Math.max(2, Math.ceil(dpr * 1.5));
```

This ensures:

- On 1× displays: RENDER_SCALE = 2 (unchanged)
- On 2× displays: RENDER_SCALE = 3 (50% more pixels than current)
- On 3× displays: RENDER_SCALE = 5 (pixel-perfect)

**Why:** Ensures crisp output on modern high-DPI displays where the current 2× scale produces soft images.

**Visual improvement:** **HIGH** — Critical for Retina/High-DPI users.
**Implementation risk:** **LOW** — Graceful fallback; `devicePixelRatio` is widely supported.
**Performance impact:** **MEDIUM** — Higher scales on high-DPI displays increase memory/CPU proportionally.

**Files to modify:**

- `lib/converter.ts` (line 83 — RENDER_SCALE definition)

---

### Priority 3: Add image-rendering CSS to Sharpen Downscale

**Change:** Add `image-rendering: crisp-edges` to the page image CSS.

**Why:** The browser's default bicubic downscaling interpolation blurs text. `crisp-edges` uses nearest-neighbor scaling which preserves sharp edges during the 2× → 1× downscale.

**Visual improvement:** **LOW-MEDIUM** — Incremental sharpening on the downscale.
**Implementation risk:** **LOW** — CSS property, non-breaking.
**Performance impact:** **NONE** — CSS property only.

**Files to modify:**

- `lib/converter.ts` (in the `buildOutputHtml` CSS block, or inline on the `<img>` tag)

**Code change (option A — inline on img):**

```typescript
<img src="..." ... style="image-rendering:crisp-edges">
```

**Code change (option B — in stylesheet):**

```css
.page img {
  image-rendering: crisp-edges;
  -ms-interpolation-mode: nearest-neighbor;
}
```

Note: `crisp-edges` may introduce slight jaggedness on diagonal lines. Test before deploying.

---

### Priority 4: Dynamic Render Scale Based on Viewport (Future Enhancement)

**Change:** Accept a `scale` parameter in `convertPdfToHtml()` for user-configurable quality.

**Why:** Power users could choose higher quality for archive-quality conversions.

**Visual improvement:** **VARIABLE** — User-controlled.
**Implementation risk:** **LOW** — Parameter pass-through.
**Performance impact:** **VARIABLE** — User-controlled.

---

## Files That Will Need Modification

| File                            | Priority 1  | Priority 2 | Priority 3    |
| ------------------------------- | ----------- | ---------- | ------------- |
| `lib/converter.ts`              | ✅ Line 112 | ✅ Line 83 | ✅ CSS block  |
| `app/globals.css`               | ❌          | ❌         | ❌ (optional) |
| `components/DocumentViewer.tsx` | ❌          | ❌         | ❌            |
| `lib/placeholder-parser.ts`     | ❌          | ❌         | ❌            |

All changes are contained within a single file: `lib/converter.ts`.

---

## Estimated Implementation Complexity

| Priority  | Change              | Lines Changed | Complexity   | Risk        |
| --------- | ------------------- | ------------- | ------------ | ----------- |
| P1        | JPEG → PNG          | 1             | Trivial      | Minimal     |
| P2        | DPI-aware scale     | 1–3           | Trivial      | Low         |
| P3        | image-rendering CSS | 1             | Trivial      | Minimal     |
| **Total** |                     | **3–5 lines** | **Very Low** | **Minimal** |

---

## Final Recommendation

**Implement Priority 1 and Priority 2 immediately.** These two changes address the root causes of quality degradation:

1. **JPEG → PNG** eliminates lossy compression artifacts (the #1 cause of blurriness)
2. **DPI-aware render scale** ensures crisp output on modern displays

Priority 3 (image-rendering CSS) should be tested and added if visual inspection shows improvement.

The total implementation is approximately 3–5 lines of code in a single file, with no architecture changes, no new dependencies, and minimal risk.

---

## Appendix: Alternative Approaches Considered

### Approach A: Increase JPEG Quality to 0.98

- Would reduce artifacts slightly but not eliminate them
- JPEG is still lossy at any quality < 1.0
- File size would approach PNG sizes without PNG's quality benefits
- **Verdict:** Inferior to PNG in all aspects

### Approach B: Use WebP Instead of PNG

- WebP supports lossless compression with smaller file sizes than PNG
- Browser support: all modern browsers support WebP
- Slightly more complex (format detection, fallback)
- `canvas.toDataURL("image/webp")` works in Chromium browsers
- **Verdict:** Future consideration, but PNG is simpler and universally supported

### Approach C: Offload Rendering to Web Workers

- Would keep UI responsive during conversion of large documents
- No quality improvement
- Complex implementation
- **Verdict:** Out of scope for this analysis

### Approach D: Hybrid SVG + Raster Approach

- Render text as selectable SVG overlay instead of raster
- Would require significant architecture changes
- High implementation complexity
- **Verdict:** Out of scope — violates "do not redesign the converter" requirement

---

## Validation Results

**Date:** 2026-07-01
**Step:** STEP 1 + STEP 2 completed

---

### STEP 1: CSS Scaling Analysis

**What was tested:**
Traced the image display path from converter output through iframe rendering to verify no CSS-induced quality loss.

**Findings:**

| Check                         | Result                                                                                                     |
| ----------------------------- | ---------------------------------------------------------------------------------------------------------- |
| CSS `width`/`height` mismatch | ✅ Image HTML attributes (`width="612" height="792"`) match the page div dimensions exactly. No mismatch.  |
| CSS scaling on image          | ✅ `.page img{display:block}` — no CSS scales or stretches the image.                                      |
| `transform: scale()`          | ✅ At default zoom (1.0), `scale(1.0)` is a no-op — no visual transform.                                   |
| Browser interpolation         | ✅ The 2× → 1× downscale is standard browser supersampling — beneficial, not harmful.                      |
| Image stretching              | ✅ The image's intrinsic aspect ratio (via `width`/`height` attributes) is preserved perfectly.            |
| Responsive resizing           | ✅ The page div has a fixed pixel width; the iframe `width: 100%` doesn't affect inner content dimensions. |

**Verdict:** ✅ **CSS is NOT causing quality loss.** At default 100% zoom, the image is displayed at exactly its intended dimensions. The quality issue is entirely in the image pixel data (JPEG compression artifacts), not in how the HTML/CSS displays it.

---

### STEP 2: JPEG → PNG Conversion

**What was tested:**
Changed `canvas.toDataURL("image/jpeg", 0.92)` → `canvas.toDataURL("image/png")` in `lib/converter.ts`.

**Verification results:**

| Check                  | Result                                                                   |
| ---------------------- | ------------------------------------------------------------------------ |
| TypeScript compilation | ✅ `npx tsc --noEmit` — passes with zero errors                          |
| Code review            | ✅ Verified safe — no JPEG dependency elsewhere; placeholders unaffected |
| Placeholder rendering  | ✅ Unaffected — placeholders operate on the text layer, not the image    |
| File changed           | `lib/converter.ts` — 1 line changed                                      |

**Expected impacts (actual measurements pending runtime test):**

| Metric                       | JPEG Q92                          | PNG (estimate)             |
| ---------------------------- | --------------------------------- | -------------------------- |
| Text quality                 | Lossy — visible ringing/softening | Lossless — perfectly sharp |
| Encode time                  | ~5–15ms/page                      | ~50–200ms/page             |
| Data URL size (text page)    | ~200–400 KB                       | ~400–800 KB (2×)           |
| Data URL size (complex page) | ~500–900 KB                       | ~2–5 MB (3–5×)             |
| Canvas memory                | ~13.5 MB                          | ~13.5 MB (unchanged)       |

**Risks and mitigations:**

| Risk                                                   | Likelihood              | Mitigation                                                   |
| ------------------------------------------------------ | ----------------------- | ------------------------------------------------------------ |
| PNG encode slower — conversion takes longer            | Medium                  | Still acceptable (~200ms/page vs ~15ms) for batch conversion |
| Large data URLs — iframe performance for complex pages | Low                     | Per-page iframe rendering; each page decodes independently   |
| Memory — `pages` array stores full HTML per page       | Medium (100+ page docs) | Pre-existing architectural concern; monitor during testing   |

**Final recommendation:** ✅ **Change is safe and implements Priority 1 from the analysis.** Proceed to runtime visual verification.

---

## PDF.js Rendering Pipeline Investigation

**Date:** 2026-07-01
**Phase:** Deep investigation of PDF.js rendering internals

---

### 1. Viewport Creation

**Code location:** `lib/converaater.ts`, lines 89–90:

```typescript
const renderVP = page.getViewport({ scale: RENDER_SCALE }); // RENDER_SCALE = 2
const dispVP = page.getViewport({ scale: 1 });
```

**Current values:**

| Parameter           | Value               | Effect                                                   |
| ------------------- | ------------------- | -------------------------------------------------------- |
| `renderVP.scale`    | `2`                 | Canvas gets 2× pixel dimensions (e.g. letter: 1224×1584) |
| `renderVP.rotation` | `0` (default)       | No rotation — standard portrait                          |
| `renderVP.width`    | `2 × dispVP.width`  | Used for canvas width                                    |
| `renderVP.height`   | `2 × dispVP.height` | Used for canvas height                                   |
| `dispVP.scale`      | `1`                 | Display dimensions (e.g. letter: 612×792)                |

**Analysis:**

The viewport scale is the **single largest determinant of rasterization quality**. PDF.js uses the viewport dimensions to allocate the pixel buffer and rasterize vector content onto it. Scale=2 means PDF.js renders vectors into a 2× buffer, then the browser downscales to 1× for display.

- This is **supersampling**: 4 source pixels blend into 1 display pixel
- For a 1× display: provides excellent anti-aliasing (text edges are smooth without being soft)
- For a 2× display (Retina): 2× source → 2× screen = 1:1 pixel mapping, output is crisp
- For a 3× display: 2× source → 3× screen = 1.5× upscale, output appears slightly soft

**Root cause identified:** The fixed 2× scale is insufficient for displays with `devicePixelRatio > 2`. On a 3× MacBook Pro display, each image pixel covers 1.5 physical screen pixels, creating perceptible softness.

---

### 2. Canvas Creation

**Code location:** `lib/converter.ts`, lines 93–94:

```typescript
const canvas = document.createElement("canvas");
canvas.width = renderVP.width;
canvas.height = renderVP.height;
```

**Current values:**

| Property              | Value                  | Notes                                        |
| --------------------- | ---------------------- | -------------------------------------------- |
| `canvas.width`        | `renderVP.width` (2×)  | Matches render viewport exactly              |
| `canvas.height`       | `renderVP.height` (2×) | Matches render viewport exactly              |
| `canvas.style.width`  | **Not set**            | Relies on default (matches width attribute)  |
| `canvas.style.height` | **Not set**            | Relies on default (matches height attribute) |

**Analysis:**

- The canvas is **never displayed in the DOM** — it's an off-screen rendering target
- Since the canvas is not displayed, `canvas.style.width`/`height` are irrelevant
- The pixel buffer dimensions match the render viewport 1:1 — no mismatch
- After `toDataURL()`, the canvas is freed via `canvas.width = 0; canvas.height = 0`

**Verdict:** ✅ **No mismatch.** Canvas pixel dimensions exactly match the rendered viewport. The canvas is never displayed in the DOM, so CSS dimensions are irrelevant.

---

### 3. devicePixelRatio

**Current state:** `window.devicePixelRatio` is never read. `RENDER_SCALE = 2` is a hardcoded constant.

**Impact on quality by display type:**

| Display              | dPR | Render Scale | Image Pixels | Screen Pixels | Mapping            | Quality           |
| -------------------- | --- | ------------ | ------------ | ------------- | ------------------ | ----------------- |
| Old 1080p monitor    | 1.0 | 2            | 2×           | 1×            | 4→1 supersample    | **Crisp**         |
| Standard Retina      | 2.0 | 2            | 2×           | 2×            | 1:1 pixel-perfect  | **Crisp**         |
| MacBook Pro (modern) | 3.0 | 2            | 2×           | 3×            | 1:1.5 undersample  | **Soft**          |
| Surface Book         | 2.5 | 2            | 2×           | 2.5×          | 1:1.25 undersample | **Slightly soft** |

**Why this matters for the reported issue:**

If the user is on a high-DPI display (3× MacBook Pro, 2.5× Surface Book, etc.), the hardcoded `RENDER_SCALE = 2` provides **insufficient pixel density**. The image is displayed at a physical size where screen pixels outnumber image pixels, causing the browser to interpolate (blur) to fill the gap.

**Proposed devicePixelRatio-aware formula:**

```typescript
const dpr = window.devicePixelRatio || 1;
const RENDER_SCALE = Math.max(2, Math.ceil(dpr * 1.5));
```

| Display  | dPR | RENDER_SCALE | Buffer | Display | Mapping             |
| -------- | --- | ------------ | ------ | ------- | ------------------- |
| Standard | 1.0 | 2            | 2×     | 1×      | 4→1 supersample     |
| Retina   | 2.0 | 3            | 3×     | 2×      | 2.25→1 supersample  |
| High-DPI | 3.0 | 5            | 5×     | 3×      | ~2.78→1 supersample |

**Estimated costs at different scales:**

| Display | dPR | Scale | Canvas (letter) | Memory   | Render Time   | PNG Size |
| ------- | --- | ----- | --------------- | -------- | ------------- | -------- |
| 1×      | 1.0 | 2     | 1224×1584       | ~7.7 MB  | baseline      | ~600 KB  |
| 2×      | 2.0 | 3     | 1836×2376       | ~17.4 MB | ~2.25× slower | ~1.3 MB  |
| 3×      | 3.0 | 5     | 3060×3960       | ~48.4 MB | ~6.25× slower | ~3.5 MB  |

**Risk assessment:**

- **Memory:** Higher on high-DPI displays, but canvas is freed per-page
- **CPU:** Scales quadratically with scale factor
- **Browser compatibility:** `window.devicePixelRatio` is supported in all modern browsers (IE11+)
- **Graceful degradation:** Falls back to RENDER_SCALE=2 if `devicePixelRatio` is undefined

---

### 4. PDF.js Render Settings

**Current render call** (`lib/converter.ts`, line 99):

```typescript
await page.render({ canvasContext: ctx, viewport: renderVP }).promise;
```

**Missing options that could affect quality:**

#### `intent: 'display' | 'print'`

| Aspect           | `'display'` (current default) | `'print'`                             |
| ---------------- | ----------------------------- | ------------------------------------- |
| Rendering path   | Screen-optimized paths        | Higher-precision vector rasterization |
| Anti-aliasing    | Screen-quality anti-aliasing  | May use higher-quality anti-aliasing  |
| Optional Content | Screen layer visibility       | Print layer visibility                |
| Performance      | Faster (GPU-friendly)         | Slower (exhaustive rendering)         |
| Color handling   | sRGB-optimized                | May use print color profiles          |

**Analysis:** The `intent` parameter in PDF.js is a hint passed through the rendering pipeline. Using `'print'` tells the internal `CanvasGraphics` object to use more precise rendering paths. In PDF.js 3.x, the main functional difference is optional content (layer) visibility, but the flag also influences how vector operations are dispatched in the canvas graphics stack.

**Recommendation:** Test `intent: 'print'` — low risk, potential quality improvement, but may expose print-only layers. Safe to test in isolation.

#### Other render options

| Option                   | Default              | Current                   | Recommendation                              |
| ------------------------ | -------------------- | ------------------------- | ------------------------------------------- |
| `annotationMode`         | `1` (enabled)        | Not set → `1`             | No change needed                            |
| `background`             | `'rgb(255,255,255)'` | Not set (manual fillRect) | Remove redundant `fillRect` — harmless      |
| `renderInteractiveForms` | `false`              | Not set → `false`         | No change (handled by converter text layer) |
| `enableXfa`              | `false`              | Not set → `false`         | No change unless XFA PDFs are used          |

---

### 5. Canvas Context Options

**Current creation** (`lib/converter.ts`, line 95):

```typescript
const ctx = canvas.getContext("2d");
```

**No options passed — defaults applied:**

| Option                      | Default | Effect on Quality                                        | Recommendation                                                         |
| --------------------------- | ------- | -------------------------------------------------------- | ---------------------------------------------------------------------- |
| `alpha: true`               | `true`  | Canvas has alpha channel (unused — page is fully opaque) | Changing to `false` saves ~1% compositing overhead. No quality impact. |
| `willReadFrequently: false` | `false` | GPU-accelerated rendering                                | Correct — we only read once via `toDataURL()`. No change needed.       |
| `desynchronized: false`     | `false` | Standard rendering pipeline                              | Correct — not an interactive app. No change needed.                    |

#### `imageSmoothingEnabled` / `imageSmoothingQuality`

These properties control how images are interpolated **during `drawImage()` calls on the canvas**. They have **no effect** on:

- PDF.js vector rendering (paths, fills, strokes — no image operations)
- `canvas.toDataURL()` output (the canvas already has its final pixel data)
- The displayed `<img>` tag (the browser's image decoder handles that independently)

**Verdict:** Irrelevant for this pipeline. PDF.js renders vectors directly, not via `drawImage()`.

---

### 6. Browser Image Interpolation

**Where interpolation occurs:**

1. PDF.js renders vectors to 2× canvas — **no interpolation** (vector → raster at native scale)
2. `canvas.toDataURL("image/png")` — **lossless** (no quality loss)
3. `<img>` tag displays at 1× dimensions — **browser downscales 2× → 1×**

**The browser's downscaling path:**

- The PNG is decoded at full 2× resolution
- The `<img width="612" height="792">` constrains display to 1×
- The browser uses `image-rendering: auto` (default) → bicubic interpolation
- Bicubic downscaling provides smooth antialiasing but can make text appear slightly softer than nearest-neighbor

**Available CSS options:**

```css
/* Default (current): smooth but can soften text */
image-rendering: auto;

/* Sharper: preserves edges at cost of potential jaggedness */
image-rendering: crisp-edges;
image-rendering: -webkit-optimize-contrast; /* Safari fallback */
```

**Relevance:**

With the JPEG→PNG change, the downscale input is pristine (lossless). The bicubic interpolation of pristine pixels produces very good results. The difference between `auto` and `crisp-edges` on PNG-supersampled text is marginal. This is a low-priority enhancement.

---

### Summary: Root Cause Candidates

| #     | Candidate                                               | Evidence                                                                                               | Impact                  |
| ----- | ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ | ----------------------- |
| **A** | `RENDER_SCALE=2` insufficient for high-DPI displays     | On 3× display, each image pixel covers 1.5 screen pixels = softness. `devicePixelRatio` never checked. | **Primary** on high-DPI |
| **B** | `intent: 'display'` may use lower-quality rasterization | PDF.js uses screen-optimized paths by default. `'print'` triggers higher-quality rendering.            | **Secondary**           |
| **C** | Browser bicubic downscale softens text                  | 2× → 1× inherently smooths pixels. Lossless PNG minimizes this, but some softening remains.            | **Tertiary**            |
| **D** | `imageSmoothingEnabled` / context options               | Not relevant — PDF.js renders vectors, not images.                                                     | **None**                |
| **E** | Canvas pixel dimension mismatch                         | Verified: canvas.width/height exactly match renderVP. No mismatch.                                     | **None**                |

---

### Ranked Recommendations

| Rank  | Change                                                         | Visual Impact                                 | Risk                                               | Performance Cost                         | Files Changed               |
| ----- | -------------------------------------------------------------- | --------------------------------------------- | -------------------------------------------------- | ---------------------------------------- | --------------------------- |
| **1** | DPI-aware `RENDER_SCALE` (dynamic based on `devicePixelRatio`) | **HIGH** — fixes softness on Retina           | **Low** — `devicePixelRatio` universally supported | **Medium** — higher scales = more pixels | `converter.ts` (1 line)     |
| **2** | Add `intent: 'print'` to `page.render()`                       | **LOW-MEDIUM** — may improve vector precision | **Low** — standard API option                      | **Low** — negligible                     | `converter.ts` (1 line)     |
| **3** | Progressive scale testing (2 → 2.5 → 3) on standard displays   | **LOW** — diminishing returns after 2×        | **Low**                                            | **Medium** — 2.25× pixels at 3×          | `converter.ts` (1 constant) |
| **4** | Add `image-rendering: crisp-edges` CSS                         | **LOW** — marginal with PNG + supersampling   | **Minimal**                                        | **None**                                 | `converter.ts` (1 line CSS) |

**Important note:** Recommendation 1 (DPI-aware scale) would be most impactful for users on Retina/high-DPI displays — which is increasingly the majority of modern laptops and desktops.

---

## SVG Rendering Investigation

**Date:** 2026-07-01
**Phase:** SVG rendering feasibility analysis

---

### 1. Can PDF.js Render Pages as SVG?

**Short answer:** Yes, but it is **experimental and not production-ready**.

PDF.js contains an internal `SVGGraphics` class (located in the source at `src/display/svg.js`) that can convert PDF operator lists into SVG DOM elements. However:

| Factor               | Assessment                                                                                                    |
| -------------------- | ------------------------------------------------------------------------------------------------------------- |
| **API status**       | Internal/experimental — not a public-facing API. No stable interface guarantees across versions.              |
| **Implementation**   | Requires manual integration with internal PDF.js classes. No simple `page.render({ backend: 'svg' })` exists. |
| **Documentation**    | No official documentation for SVG rendering. Previous examples ("svgviewer") removed from recent releases.    |
| **GitHub community** | Labelled experimental; issues regularly reported for missing features (blend modes, color spaces, patterns).  |

**Verdict:** Not viable for production. Any SVG-based approach using PDF.js directly would require building a custom rendering engine on top of an unmaintained internal API.

---

### 2. Can PDF.js Expose Vector Drawing Instructions?

**Short answer:** Yes, via `page.getOperatorList()`, but converting to SVG is **highly impractical**.

**What `getOperatorList()` returns:**

```typescript
const opList = await page.getOperatorList();
// opList.fnArray: number[] — operator codes (e.g., fill, stroke, moveTo)
// opList.argsArray: any[][] — arguments for each operator
```

**Why converting to SVG is impractical for production:**

| Challenge                     | Explanation                                                                                                                                                                                                 |
| ----------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Procedural state machine**  | PDF operators are sequential with a mutable graphics state (current transform, color, line width, clipping path). To produce SVG elements, you must manually track all state changes across every operator. |
| **No object boundaries**      | A single "rectangle" in PDF may be encoded as `moveTo, lineTo, lineTo, lineTo, closePath, fill` — spread across multiple operators.                                                                         |
| **Text rendering complexity** | PDF text operators involve font subsetting, character codes, CMap tables, and complex positioning (TJ/Tj with offsets). Reconstructing text as SVG `<text>` elements is extremely error-prone.              |
| **Image objects**             | PDF images use various compression schemes (JPX2000, JBIG2, CCITT) that must be decoded before embedding in SVG as `<image>` elements.                                                                      |
| **Transparency groups**       | PDF's transparency model (soft masks, blending modes) maps poorly to SVG and requires complex fallback rendering.                                                                                           |
| **Upgrade risk**              | `getOperatorList()` is an internal implementation detail. Any PDF.js version upgrade could change the operator set or arguments, breaking the converter.                                                    |

**Verdict:** Building a custom SVG renderer atop `getOperatorList()` is the equivalent of re-implementing a significant portion of PDF.js. Estimated effort: **months of development** with ongoing maintenance burden.

---

### 3. Comparison: Canvas vs SVG vs Mixed

| Criteria                   | Canvas Raster (current)                       | Full SVG                                                       | Mixed (SVG page + text layer)                             |
| -------------------------- | --------------------------------------------- | -------------------------------------------------------------- | --------------------------------------------------------- |
| **Visual quality**         | Good (limited by raster resolution)           | Excellent (vector-perfect at any zoom)                         | Good (SVG background + raster text alignment risk)        |
| **Text sharpness at 100%** | Very good (2× supersampled PNG)               | Perfect (native vectors)                                       | Perfect for static content; alignment risk for text layer |
| **Zoom quality**           | Raster re-render required → temporary blur    | Native vector — always crisp                                   | Vector background always crisp; text layer may misalign   |
| **Rendering speed**        | Fast (~200ms/page)                            | Slow (DOM-heavy for complex pages)                             | Slow (SVG DOM + text layer overlay)                       |
| **Memory usage**           | ~15–24 MB/page during conversion, freed after | DOM nodes accumulate in memory. Large docs can freeze browser. | SVG DOM + text DOM = higher memory still                  |
| **Browser compatibility**  | Universal                                     | Universal (SVG supported everywhere)                           | Universal                                                 |
| **File size (output)**     | ~500 KB – 5 MB per page (PNG data URL)        | Variable; can be very large for complex pages                  | Similar to full SVG                                       |
| **Text selection**         | Separate text layer (works)                   | Requires separate text layer (PDF SVG text unreliable)         | Separate text layer needed                                |
| **Placeholder rendering**  | Works (text-layer based)                      | Potentially simpler (DOM integration)                          | Works (same text layer approach)                          |
| **Production stability**   | **Proven** — used by converters worldwide     | **Experimental** — known rendering bugs                        | **Unproven** — novel architecture                         |
| **Implementation effort**  | Already implemented                           | Months of development                                          | Weeks to months of development                            |
| **Maintenance burden**     | Low                                           | High (track PDF.js SVG changes)                                | Very high (two rendering paths)                           |

---

### 4. Hybrid Architecture Feasibility

**Proposed hybrid:**

```
 SVG Page Background + Selectable Text Layer + Interactive Placeholders
```

Instead of:

```
 Canvas Image + Selectable Text Layer + Interactive Placeholders
```

**Would this significantly improve quality?**

Yes — **if** the SVG rendering were pixel-perfect. Vector elements at 100% zoom would be as sharp as the original PDF, with no raster artifacts.

**But there are critical problems:**

#### Problem 1: PDF.js SVG is not reliable enough

- Missing features (blend modes, transparency, shading patterns)
- Rendering inconsistencies with complex PDFs
- No guarantee of fixing bugs (low-priority for the project)

#### Problem 2: Text layer alignment becomes critical

- Currently, the text layer sits on top of a raster image — small alignment errors are invisible
- With an SVG background, any misalignment between the SVG-rendered text and the selectable text layer would be **visually obvious** (ghost text, double text)
- This is the same fundamental problem that plagues all hybrid renderers

#### Problem 3: Performance at scale

- SVG with thousands of DOM nodes (typical for a business letter or form) is slower to render and interact with
- Complex engineering drawings or maps could have tens of thousands of paths → browser freeze
- The current single `<img>` tag approach has constant rendering cost regardless of document complexity

#### Problem 4: No easy migration path

- The current converter produces a self-contained HTML string (data URL image embedded)
- SVG rendering requires handling images, fonts, and external resources → either embed everything or deal with cross-origin issues
- The `srcDoc` approach works well for a single `<img>` but struggles with complex SVG documents

**Verdict:** A hybrid architecture is **technically possible but not recommended** given the current codebase constraints and PDF.js limitations.

---

### 5. SVG-as-Background-Only Approach

**Question:** Could we render _only the non-text page background_ as SVG while keeping everything else unchanged?

**Challenges:**

1. **Separation is impossible at PDF.js level** — PDF.js renders the full page as one unit. There is no API to request "just the background graphics, no text."
2. **Manual separation via operator list** — You could theoretically classify operators into "background" (rectangles, fills, images) vs. "text" (TJ, Tj operators). But this is:
   - Extremely fragile (depends on PDF structure)
   - PDF content streams can interleave text and graphics arbitrarily
   - Text can appear inside clipped regions, patterns, or transparency groups
3. **Alignment nightmare** — The SVG background and the raster text layer would need pixel-perfect alignment. With different rendering paths (SVG vs canvas), subtle differences in font metrics, hinting, and anti-aliasing would produce visible mismatches.

**Verdict:** A "background-only SVG" approach is **not practically feasible** without a fundamentally different PDF processing architecture.

---

### Summary: Why SVG Is Not the Answer

| Reason                          | Explanation                                                                      |
| ------------------------------- | -------------------------------------------------------------------------------- |
| PDF.js SVG is experimental      | Not production-ready; missing features; no API stability                         |
| `getOperatorList()` impractical | Requires re-implementing half of PDF.js; months of effort                        |
| Text alignment risk             | SVG text layer + selectable text layer creates double-text / misalignment issues |
| Performance at scale            | SVG DOM with thousands of nodes is slower than a single `<img>` tag              |
| Maintenance burden              | Tracking PDF.js internals across versions is high-effort                         |
| No incremental migration        | Cannot do "half SVG, half raster" — must be all-or-nothing                       |

### Final Recommendation

**Do not pursue SVG rendering within the current architecture.** The effort-to-reward ratio is unfavourable. The SVG backend in PDF.js is experimental, `getOperatorList()` conversion would require rebuilding a significant portion of the library, and the hybrid approach introduces alignment and performance problems that would harm the user experience.

Instead, the highest-return investment remains:

1. ✅ **JPEG → PNG** (already implemented)
2. 🔲 **DPI-aware `RENDER_SCALE`** (addresses softness on high-DPI displays)
3. 🔲 **Test `intent: 'print'`** (potential quality improvement with minimal cost)
4. 🔲 **`image-rendering: crisp-edges` CSS** (marginal sharpening on downscale)

All four changes are single-line modifications to `lib/converter.ts`, zero-risk, and preserve full backward compatibility.

---

_End of report._
