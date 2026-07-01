# Architectural Quality Limits — Raster vs Vector PDF Rendering

**Date:** 2026-07-01
**Author:** Formaless Engineering
**Status:** Complete — no code changes

---

## Executive Summary

The remaining quality gap between Formaless and a native PDF viewer (Chrome PDFium, Adobe Reader) is **architecturally unavoidable** given the current design: Formaless converts PDF pages to raster PNG images, while native viewers keep vector data alive and re-render at every zoom level.

This is not a bug, not a configuration issue, and not fixable by tuning render settings. It is a fundamental limitation of the raster + `<img>` approach.

---

## Investigation Results

### 1. Canvas Resolution — ✅ No Issue

**Code inspected:** `lib/converter.ts` lines 93–98

```typescript
const canvas = document.createElement("canvas");
canvas.width = renderVP.width;   // matches renderVP exactly
canvas.height = renderVP.height; // matches renderVP exactly
const ctx = canvas.getContext("2d");
```

**Findings:**
- `canvas.width/height` are set from `renderVP.width/height` — exact match, no truncation
- `canvas.style.width/height` is never set — no CSS sizing that could differ from pixel dimensions
- The canvas is off-screen (never in the DOM) — no accidental browser scaling
- ✅ Confirmed: no accidental resize, no dimension mismatch

---

### 2. Browser Scaling — ✅ No Issue at 100% Zoom

**Code inspected:** `lib/converter.ts` lines 127–128, `components/DocumentViewer.tsx` lines 84–94

**The image in generated HTML:**
```html
<img src="data:image/png;base64,..." width="612" height="792">
```
- The `width` and `height` HTML attributes set the exact display dimensions
- These match `dispVP` (1× viewport) exactly
- No CSS overrides the image dimensions
- No stretching, no accidental resize

**The iframe zoom pipeline:**
```tsx
<div className="viewer-page-wrap" style={{
  transform: `scale(${zoom})`,
  transformOrigin: "top center",
}}>
  <iframe srcDoc={currentHtml} ... />
</div>
```

**At 100% zoom:** `transform: scale(1.0)` — no-op. Image is displayed at native dimensions.

**At >100% zoom:** `transform: scale(1.5)` etc. — the browser **interpolates the existing PNG pixels**. This is a CSS transform on the container, not a re-render.

**Verdict at 100%:** ✅ No browser scaling at default zoom. Image is at native resolution.
**Verdict at >100%:** ❌ Browser scales the existing PNG (bicubic interpolation of raster data) → blur is inevitable.

---

### 3. PDF.js Rendering Options — Confirmed Optimal

**Current call:**
```typescript
await page.render({ canvasContext: ctx, viewport: renderVP }).promise;
```

**Audit of all available options for pdfjs-dist 3.11:**

| Option | Current | Available | Effect on Quality |
|--------|---------|-----------|-------------------|
| `intent` | Not set (`'display'`) | `'display'` or `'print'` | Controls **optional content layers**, not rendering precision. Research confirms no anti-aliasing change. |
| `annotationMode` | Not set (default `1`) | `0`, `1`, `2` | Already enabled (1). Changing to `2` forces forms — irrelevant. |
| `background` | Not set (manual `fillRect`) | CSS color string | Redundant — PDF.js defaults to `'rgb(255,255,255)'`. |
| `renderInteractiveForms` | Not set (`false`) | `true`/`false` | Handled by our placeholder system. No change needed. |
| `enableXfa` | Not set (`false`) | `true`/`false` | Only for XFA-based PDFs (rare). No quality impact. |
| `transform` | Not set (`null`) | `number[]` | Applies additional transform. Not needed. |
| `canvasFactory` | Not set | Factory object | Internal — used for worker rendering. |

**Verdict:** ✅ No PDF.js rendering option improves quality beyond what current viewport scale provides. All options that affect rendering are about content filtering (optional content layers, form rendering), not precision.

---

### 4. Generated HTML — ✅ No Stretching

**Code inspected:** `lib/converter.ts` lines 125–131

```html
<div class="page" style="width:612px;height:792px;">
  <img src="data:image/png;base64,..." width="612" height="792" alt="Page 1">
</div>
```

**Key CSS in iframe stylesheet:**
```css
.page{width:612px;height:792px}
.page img{display:block}
```

- The `.page` div has fixed `width` and `height` matching the `dispVP` (1×)
- The `<img>` has `width` and `height` attributes matching the `.page` div
- `.page img{display:block}` — no CSS stretch or distortion
- No `max-width: 100%` or other responsive rules that could resize the image

**Verdict:** ✅ The image is displayed at exactly its intended 1× dimensions. No CSS stretching occurs.

---

### 5. Zoom Pipeline — ❌ Fundamental Issue Identified

**Current zoom behavior:**
```
User clicks zoom+ (zoom: 1.0 → 1.1)
  ↓
DocumentContext: zoom state updated
  ↓
DocumentViewer: <div style="transform: scale(1.1)">
  ↓
iframe content scales up via CSS
  ↓
The SAME PNG data URL is stretched by the browser
  ↓
bicubic interpolation of raster pixels → BLUR
```

**What a native PDF viewer does:**
```
User zooms to 110%
  ↓
PDF viewer calculates new viewport scale
  ↓
page.render({ canvasContext, viewport: newViewport })
  ↓
New canvas at higher resolution
  ↓
Sharp vector-to-raster conversion at new scale
```

**Evidence from research:**
- The official PDF.js viewer **re-renders** on every zoom change via `PDFPageView._render()` with a new viewport scale
- Chrome PDFium keeps vectors alive and re-rasterizes at the display's resolution using native C++ Skia
- PSPDFKit and Apryse both **re-render from vector data** on zoom, using tile-based rendering with Web Workers to maintain responsiveness

**Verdict:** ❌ Formaless does not re-render on zoom. It scales the existing PNG via CSS transform. This is the primary reason zoomed-in text becomes blurry.

---

### 6. Dynamic Re-rendering on Zoom — Feasibility Analysis

**What it would require:**
When the user zooms, instead of scaling the PNG, re-render the PDF page at a higher resolution and replace the image.

**Proposed flow:**
```
User zoom changes
  ↓
Calculate new render scale: zoom * devicePixelRatio * 1.5
  ↓
Create new canvas at higher resolution
  ↓
page.render({ canvasContext: ctx, viewport: newViewport })
  ↓
canvas.toDataURL("image/png")
  ↓
Replace <img> src with new data URL
```

**Cost estimates:**

| Zoom | RENDER_SCALE (2× dPR) | Canvas (letter) | Memory | Render Time | Estimated Latency |
|------|----------------------|-----------------|--------|-------------|-------------------|
| 100% | 2 | 1224×1584 | ~7.7 MB | baseline | ~300ms |
| 150% | 3 | 1836×2376 | ~17.4 MB | ~2.25× | ~675ms |
| 200% | 4 | 2448×3168 | ~31.0 MB | ~4× | ~1.2s |
| 300% | 6 | 3672×4752 | ~69.7 MB | ~9× | ~2.7s |
| 500% | 10 | 6120×7920 | ~193.7 MB | ~25× | ~7.5s |

**Challenges:**

| Concern | Assessment |
|---------|-----------|
| **CPU cost** | Medium to High — re-rendering at higher scales is expensive, especially at 300%+ zoom |
| **Memory** | High — large canvases at high zoom. But can be freed after generating new data URL |
| **Responsiveness** | Re-render is synchronous on the main thread without Web Workers. Would cause noticeable freeze. |
| **Implementation complexity** | Medium — requires keeping the PDF document object alive in memory (currently not done after conversion), and wiring zoom changes to trigger re-renders |
| **iframe interaction** | The image is inside an iframe's `srcDoc`. Replacing it requires either iframe reload (slow) or postMessage communication (complex) |
| **Standalone HTML** | If the HTML is saved to disk, re-rendering on zoom is impossible — the PDF data is gone |

**Critical architectural constraint:** The current design converts the PDF to a **self-contained HTML string**. Once the PDF is converted, the original PDF data is discarded. Dynamic re-rendering would require either:
- Keeping the entire PDF in memory (defeats memory-only architecture)
- Embedding the PDF binary in the HTML (enormous file size)
- A hybrid approach where the HTML references the original PDF file (breaks self-contained HTML)

**Verdict:** Dynamic re-rendering on zoom is technically possible but would require significant architectural changes (keeping PDF alive, Web Workers, iframe communication) and fundamentally alters the "generate once, view anywhere" design.

---

### 7. Why Chrome PDF Viewer Stays Sharp

**Architecture comparison:**

| Aspect | Chrome PDFium | Formaless |
|--------|--------------|-----------|
| Rendering engine | Native C++ (Skia) | JavaScript (PDF.js → Canvas) |
| Vector preservation | **Keeps vectors alive** the entire time | **Rasterizes once** to PNG, discards vectors |
| Zoom behavior | Re-rasterizes vectors at new resolution | CSS-scales the existing PNG |
| Memory model | Page objects + display list in native memory | HTML string with embedded PNG |
| Transport | Bytes streamed to sandboxed process | Data URL in HTML string |
| Interactivity | Forms rendered natively | Placeholder inputs on text layer |

**Why Formaless cannot match this without redesign:**
1. **Self-contained HTML** — Once the PDF is converted to HTML+PNG, the original vector data is gone
2. **Static asset** — The PNG is a baked-in raster. No amount of scaling recovers lost vector information
3. **No PDF.js at view time** — The viewer only loads the generated HTML; it doesn't have access to pdfjs-dist or the original PDF

---

### 8. Industry Viewer Comparison

| Viewer | Rendering Tech | Zoom Strategy | Vector Preserved? | Can Export to HTML? |
|--------|---------------|---------------|-------------------|---------------------|
| **Chrome PDFium** | Native Skia | Re-rasterize | ✅ Yes | ❌ No |
| **PDF.js Viewer** | Canvas + JS | Re-render via pdfjs | ✅ Yes (in memory) | ❌ No |
| **Adobe Acrobat Web** | Proprietary | Re-rasterize | ✅ Yes | ❌ No |
| **PSPDFKit (Nutrient)** | Canvas + Web Workers | Tile-based re-render | ✅ Yes | ❌ No |
| **Apryse (PDFTron)** | Canvas + Web Workers | Tile-based re-render | ✅ Yes | ❌ No |
| **Formaless (current)** | PNG in iframe | CSS scale | ❌ No | ✅ Yes (self-contained HTML) |

**Key insight:** **None of the viewers that maintain zoom sharpness produce self-contained HTML output.** They all require the original PDF to be present and render dynamically. Formaless's ability to generate standalone HTML is the direct trade-off for raster-only quality.

---

### 9. Best Architecture for Formaless

**Constraints:**
1. Must generate self-contained, portable HTML
2. Must support interactive placeholder fields
3. Must work without the original PDF after conversion
4. Should not require a full redesign

**Options ranked by feasibility:**

#### Option A: Accept the raster limitation (recommended for now)
- Keep current architecture
- At 100% zoom, quality is excellent (PNG + DPI-aware supersampling)
- Document that zoom >100% will show pixel interpolation
- Set max zoom to 2.0 (current max is 3.0) to avoid excessive blur
- **Cost:** Zero
- **Quality:** Best at 100%, degrades gracefully at zoom

#### Option B: Hybrid — embed a high-quality raster + re-render hint
- Generate the PNG at a very high base scale (e.g., 4×) regardless of DPI
- This gives more headroom for zoom before blur becomes noticeable
- At 200% zoom on a 4× render, the effective pixel ratio is 2:1 → still sharp
- **Cost:** 4× memory/CPU during conversion, 4× larger data URLs
- **Quality:** Stays sharp up to ~200% zoom

#### Option C: Dual-mode — raster preview + optional PDF download
- Generate the raster HTML as current
- Offer users a "Download original PDF" option for native viewing
- This is honest about the limitations and gives users the best of both worlds
- **Cost:** Simple UI addition; no architecture changes
- **Quality:** User chooses between convenience (HTML) and perfection (native PDF viewer)

#### Option D: Embed PDF.js in the viewer (major architectural change)
- Instead of generating HTML, keep the PDF in memory and use pdfjs-dist to render dynamically
- Store the original PDF bytes alongside the generated HTML for offline use
- Implement re-render-on-zoom using a hidden canvas and push updated data URLs to the iframe
- **Cost:** Very high — months of development, new dependencies, iframe communication layer
- **Quality:** Matches native PDF.js viewer

---

## Root Cause Conclusion

**The remaining quality loss is the unavoidable consequence of rasterizing a vector PDF into a PNG image and then scaling that image via CSS on zoom.**

This is not caused by:
- ❌ Wrong JPEG/PNG choice (PNG was the right choice)
- ❌ Insufficient render scale (DPI-aware scale was the right choice)
- ❌ CSS scaling at 100% (none occurs)
- ❌ PDF.js render settings (all optimal)
- ❌ Canvas dimensions (exact match)
- ❌ Image stretching (none occurs)

It is caused by:
- ✅ **Architecture:** Converting vectors → raster pixels → PNG → CSS transform discards all vector information
- ✅ **No re-render-on-zoom:** Unlike every professional PDF viewer, Formaless does not re-render from vectors when zooming
- ✅ **Self-contained HTML constraint:** The design goal of portable, standalone HTML is inherently incompatible with dynamic vector re-rendering

---

## Recommendations

### Implement Immediately

**1. Cap max zoom at 2.0×** (in `DocumentContext.tsx`, change `ZOOM_MAX` from `3.0` to `2.0`)
- At 3× zoom on a 5× supersampled image, each display pixel covers only ~1.67 source pixels — blur is visible
- At 2× zoom on a 5× supersampled image, each display pixel covers ~2.5 source pixels — still acceptable
- Simple one-line change, zero risk

**2. Generate base PNG at higher scale for zoom headroom**
- Instead of `ceil(dpr * 1.5)`, use `ceil(max(dpr, 2) * 1.5)` to ensure minimum 3× render
- This gives more pixel data to work with when zooming in on standard displays
- Cost: ~2.25× larger for standard displays, but significantly better zoom quality

### Consider for Future

**3. Hybrid approach: keep PDF bytes + re-render on zoom**
- Major architectural change, but would match native PDF viewer quality
- Weigh against product requirements: is self-contained HTML a hard requirement?

**4. Document limitation clearly**
- Set user expectations: "Best viewed at 100% zoom. For high-resolution viewing, download the original PDF."

---

## Files Referenced

| File | Role |
|------|------|
| `lib/converter.ts` | PDF rendering pipeline, image generation |
| `components/DocumentViewer.tsx` | Zoom pipeline (CSS transform on iframe) |
| `context/DocumentContext.tsx` | Zoom state (ZOOM_MIN, ZOOM_MAX, ZOOM_STEP) |
| `docs/analysis/2026-07-01-pdf-render-quality-analysis.md` | Previous investigation report |

---

*End of report.*
