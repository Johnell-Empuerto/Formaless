import { detectPlaceholder, renderPlaceholderField, type PlaceholderPosition } from "./placeholder-parser";
import { extractSVG } from "./svg-extractor";

export interface ConversionCallbacks {
  onProgress: (current: number, total: number) => void;
  onStatus: (message: string) => void;
}

export interface ConversionResult {
  html: string;
  pageCount: number;
  pages: string[];
}

/** Minimal shape we need from pdfjs-dist TextItem */
interface TextItemLike {
  str: string;
  transform: number[];
  width?: number;
}
function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** CSS for interactive placeholder fields injected into the output HTML. */
const PLACEHOLDER_CSS = `
.pf-field{position:absolute;border:none;outline:none;background:#fff;padding:0;margin:0;color:transparent;cursor:text;caret-color:#1a1a1a;line-height:1;overflow:hidden;text-overflow:clip;white-space:pre;resize:none;box-sizing:border-box;font-family:inherit;min-width:0;min-height:0}
.pf-field:focus{color:#000;background:#fff}
.pf-field.filled{color:#000}
`;

/** Inline script that toggles a "filled" class on .pf-field elements. */
const PLACEHOLDER_SCRIPT = `<script>
(function(){document.querySelectorAll(".pf-field").forEach(function(e){function t(){e.classList.toggle("filled",e.value!=="")}e.addEventListener("input",t),t()})})();
</script>`;

function buildOutputHtml(filename: string, pagesHtml: string): string {
  const title = escapeHtml(filename.replace(/\.pdf$/i, ""));
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${title}</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{background:#525659;padding:24px 16px;display:flex;flex-direction:column;align-items:center;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"Helvetica Neue",Arial,sans-serif}
.page{position:relative;margin:18px 0;box-shadow:0 2px 14px rgba(0,0,0,.38);overflow:hidden;background:#fff;flex-shrink:0}
.page img{display:block;image-rendering:crisp-edges;image-rendering:-webkit-optimize-contrast;-ms-interpolation-mode:nearest-neighbor;transform:translateZ(0)}
.tl{position:absolute;top:0;left:0;width:100%;height:100%;overflow:hidden;font-size:1px;line-height:1}
.pdf24_01{position:absolute;white-space:pre;color:#000;cursor:text;overflow:hidden}
.pdf24_01::selection{background:rgba(0,90,210,.32);color:#000}
.pdf24_01 span{color:#000}
::-moz-selection{background:rgba(0,90,210,.32)}
.pf-svg{position:absolute;top:0;left:0;width:100%;height:100%;pointer-events:none;overflow:hidden}
.pf-svg path{vector-effect:non-scaling-stroke}
${PLACEHOLDER_CSS}
</style>
</head>
<body>
 ${pagesHtml}
${PLACEHOLDER_SCRIPT}
</body>
</html>`;
}

/**
 * Converts a PDF File to a self-contained HTML string.
 * Uses dynamic import of pdfjs-dist so it never runs on the server.
 */
export async function convertPdfToHtml(
  file: File,
  callbacks: ConversionCallbacks,
): Promise<ConversionResult> {
  // Dynamic import — only resolves on the client
  const pdfjsLib = await import("pdfjs-dist");

  // Point to the matching CDN worker (must match pdfjs-dist version)
  pdfjsLib.GlobalWorkerOptions.workerSrc =
    "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";

  // Scale render buffer for high-DPI displays (minimum 3× for sharp background zoom)
  const dpr = window.devicePixelRatio || 1;
  const RENDER_SCALE = Math.max(3, Math.ceil(dpr * 1.8));

  const buf = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: new Uint8Array(buf) }).promise;
  const numPages = pdf.numPages;

  callbacks.onStatus(
    `Found ${numPages} page${numPages > 1 ? "s" : ""}. Rendering...`,
  );

  let pagesHtml = "";
  const pages: string[] = [];

  for (let i = 1; i <= numPages; i++) {
    const page = await pdf.getPage(i);
    const renderVP = page.getViewport({ scale: RENDER_SCALE });
    const dispVP = page.getViewport({ scale: 1 });

    /* ── Extract operator list for SVG generation ── */
    const [opList, tc] = await Promise.all([
      page.getOperatorList(),
      page.getTextContent(),
    ]);
    const svgResult = extractSVG(opList, dispVP.height, dispVP.transform, pdfjsLib.OPS);

    /* ── Render page to off-screen canvas ── */
    const canvas = document.createElement("canvas");
    canvas.width = renderVP.width;
    canvas.height = renderVP.height;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Could not get 2D canvas context.");

    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({ canvasContext: ctx, viewport: renderVP }).promise;

    const imgSrc = canvas.toDataURL("image/png");

    let spans = "";

    for (const rawItem of tc.items) {
      const item = rawItem as TextItemLike;
      if (!item.str || item.str.trim() === "") continue;

      const tx = item.transform[4];
      const ty = item.transform[5];

      // Derive font size from the transform matrix
      const fs = Math.max(
        Math.hypot(item.transform[0], item.transform[1]),
        Math.hypot(item.transform[2], item.transform[3]),
        6,
      );

      // Flip Y: PDF origin is bottom-left → HTML is top-left
      const htmlX = tx;
      const htmlY = dispVP.height - ty;
      const spanW = item.width || item.str.length * fs * 0.55;
      const spanH = fs * 1.2;

      // Check if this text item is an interactive placeholder
      const placeholderType = detectPlaceholder(item.str);
      if (placeholderType) {
        const pos: PlaceholderPosition = {
          left: htmlX,
          top: htmlY - fs * 0.82,
          width: spanW,
          height: spanH,
          fontSize: fs,
        };
        const fieldHtml = renderPlaceholderField(placeholderType, pos);
        if (fieldHtml) {
          spans += fieldHtml + "\n";
          continue;
        }
      }

      // pdf24-style: visible text on PNG background using em units
      // Base font-size on .tl is 1px → 1em = 1px for exact positioning
      spans += `<div class="pdf24_01" style="left:${htmlX.toFixed(4)}em;top:${(htmlY - fs * 0.82).toFixed(4)}em;font-size:${fs.toFixed(4)}em;width:${spanW.toFixed(4)}em;height:${spanH.toFixed(4)}em"><span>${escapeHtml(item.str)}</span></div>\n`;
    }

    const pw = Math.round(dispVP.width);
    const ph = Math.round(dispVP.height);

    const pageDiv =
      `  <div class="page" style="width:${pw}px;height:${ph}px;">\n` +
      `    <img src="${imgSrc}" width="${pw}" height="${ph}" alt="Page ${i}">\n` +
      (spans ? `    <div class="tl">\n${spans}    </div>\n` : "") +
      (svgResult.svg ? `    ${svgResult.svg}\n` : "") +
      `  </div>`;

    pagesHtml += pageDiv + "\n\n";
    pages.push(buildOutputHtml(file.name, pageDiv));

    /* ── Report progress ── */
    callbacks.onProgress(i, numPages);
    callbacks.onStatus(`Rendering page ${i} of ${numPages}...`);

    /* ── Free canvas memory ── */
    canvas.width = 0;
    canvas.height = 0;

    /* ── Yield to the UI thread ── */
    await new Promise((r) => setTimeout(r, 5));
  }

  return {
    html: buildOutputHtml(file.name, pagesHtml),
    pageCount: numPages,
    pages,
  };
}
