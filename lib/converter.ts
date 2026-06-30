export interface ConversionCallbacks {
  onProgress: (current: number, total: number) => void;
  onStatus: (message: string) => void;
}

export interface ConversionResult {
  html: string;
  pageCount: number;
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
.page img{display:block}
.tl{position:absolute;top:0;left:0;width:100%;height:100%;overflow:hidden}
.tl span{position:absolute;color:transparent;white-space:pre;cursor:text;line-height:1;overflow:hidden}
.tl span::selection{background:rgba(0,90,210,.32);color:transparent}
::-moz-selection{background:rgba(0,90,210,.32)}
</style>
</head>
<body>
 ${pagesHtml}
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

  const RENDER_SCALE = 2;

  const buf = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: new Uint8Array(buf) }).promise;
  const numPages = pdf.numPages;

  callbacks.onStatus(
    `Found ${numPages} page${numPages > 1 ? "s" : ""}. Rendering...`,
  );

  let pagesHtml = "";

  for (let i = 1; i <= numPages; i++) {
    const page = await pdf.getPage(i);
    const renderVP = page.getViewport({ scale: RENDER_SCALE });
    const dispVP = page.getViewport({ scale: 1 });

    /* ── Render page to off-screen canvas ── */
    const canvas = document.createElement("canvas");
    canvas.width = renderVP.width;
    canvas.height = renderVP.height;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Could not get 2D canvas context.");

    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({ canvasContext: ctx, viewport: renderVP }).promise;

    const imgSrc = canvas.toDataURL("image/jpeg", 0.92);

    /* ── Extract text layer with absolute positions ── */
    const tc = await page.getTextContent();
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

      spans += `<span style="left:${htmlX.toFixed(1)}px;top:${(htmlY - fs * 0.82).toFixed(1)}px;font-size:${fs.toFixed(1)}px;width:${spanW.toFixed(1)}px;height:${spanH.toFixed(1)}px;">${escapeHtml(item.str)}</span>\n`;
    }

    const pw = Math.round(dispVP.width);
    const ph = Math.round(dispVP.height);

    pagesHtml +=
      `  <div class="page" style="width:${pw}px;height:${ph}px;">\n` +
      `    <img src="${imgSrc}" width="${pw}" height="${ph}" alt="Page ${i}">\n` +
      (spans ? `    <div class="tl">\n${spans}    </div>\n` : "") +
      `  </div>\n\n`;

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
  };
}
