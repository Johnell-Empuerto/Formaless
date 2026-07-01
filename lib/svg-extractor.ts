/**
 * SVG Extractor — extracts simple vector elements (rectangles, lines, borders)
 * from a PDF.js page operator list and generates an SVG overlay.
 *
 * The SVG sits on top of the raster PNG. When the user zooms, the SVG
 * elements (table borders, rectangles, lines) remain vector-sharp while
 * the PNG blurs — dramatically improving perceived quality.
 *
 * Usage:
 *   const opList = await page.getOperatorList();
 *   const result = extractSVG(opList, dispVP.height, dispVP.transform, pdfjsLib.OPS);
 *   // result.svg  → SVG HTML string to inject into the page
 */

export interface SVGExtractResult {
  /** SVG HTML string, or empty string if nothing was extracted */
  svg: string;
  /** Number of vector elements extracted */
  count: number;
}

/** Current graphics state tracked through the operator list */
interface GraphicsState {
  /** Current Transformation Matrix [a, b, c, d, e, f] */
  ctm: number[];
  /** Current stroke color as CSS hex */
  strokeColor: string;
  /** Current fill color as CSS hex */
  fillColor: string;
  /** Current line width (already scaled by CTM) */
  lineWidth: number;
  /** Stroke alpha 0-1 */
  strokeAlpha: number;
  /** Fill alpha 0-1 */
  fillAlpha: number;
  /** Whether clipping is active (skip output while true) */
  clipping: boolean;
}

const DEFAULT_STATE: GraphicsState = {
  ctm: [1, 0, 0, 1, 0, 0],
  strokeColor: "#000000",
  fillColor: "#000000",
  lineWidth: 1,
  strokeAlpha: 1,
  fillAlpha: 1,
  clipping: false,
};

/** Transform point [x, y] through CTM [a, b, c, d, e, f] */
function applyCTM(ctm: number[], x: number, y: number): { x: number; y: number } {
  return {
    x: ctm[0] * x + ctm[2] * y + ctm[4],
    y: ctm[1] * x + ctm[3] * y + ctm[5],
  };
}

/** Multiply CTM a × b */
function multiplyCTM(a: number[], b: number[]): number[] {
  return [
    a[0] * b[0] + a[2] * b[1],
    a[1] * b[0] + a[3] * b[1],
    a[0] * b[2] + a[2] * b[3],
    a[1] * b[2] + a[3] * b[3],
    a[0] * b[4] + a[2] * b[5] + a[4],
    a[1] * b[4] + a[3] * b[5] + a[5],
  ];
}

/** Scale a component (0-1) to 0-255 hex */
function compToHex(c: number): string {
  return Math.round(Math.max(0, Math.min(1, c)) * 255)
    .toString(16)
    .padStart(2, "0");
}

/** Build CSS hex from RGB 0-1 */
function rgbCSS(r: number, g: number, b: number): string {
  return `#${compToHex(r)}${compToHex(g)}${compToHex(b)}`;
}

/**
 * Extract SVG vector elements from a PDF.js operator list.
 *
 * @param operatorList   result of page.getOperatorList()
 * @param pageHeight     display viewport height (for Y-flip: PDF bottom-left → SVG top-left)
 * @param initialCTM     display viewport transform [a, b, c, d, e, f] (dispVP.transform)
 * @param OPS            pdfjsLib.OPS constants object
 */
export function extractSVG(
  operatorList: { fnArray: number[]; argsArray: any[][] },
  pageHeight: number,
  initialCTM: number[],
  OPS: Record<string, number>,
): SVGExtractResult {
  const { fnArray, argsArray } = operatorList;
  const state: GraphicsState = { ...DEFAULT_STATE, ctm: [...initialCTM] };
  const stack: GraphicsState[] = [];

  // Collected SVG <path> data strings
  const paths: string[] = [];

  let pendingPath: string | null = null;

  function emitPath(
    fill: boolean,
    stroke: boolean,
    evenOdd: boolean,
  ) {
    if (!pendingPath) return;
    if (state.clipping) { pendingPath = null; return; }

    const fillV = fill ? state.fillColor : "none";
    const strokeV = stroke ? state.strokeColor : "none";

    if (fillV === "none" && strokeV === "none") { pendingPath = null; return; }
    if ((fillV !== "none" && state.fillAlpha <= 0) ||
        (strokeV !== "none" && state.strokeAlpha <= 0)) { pendingPath = null; return; }

    const parts: string[] = [`d="${pendingPath}"`];
    parts.push(`fill="${fillV}"`);
    parts.push(`stroke="${strokeV}"`);
    if (stroke) parts.push(`stroke-width="${state.lineWidth.toFixed(2)}"`);
    parts.push(`fill-opacity="${state.fillAlpha}"`);
    parts.push(`stroke-opacity="${state.strokeAlpha}"`);
    parts.push(`fill-rule="${evenOdd ? "evenodd" : "nonzero"}"`);

    paths.push(`<path ${parts.join(" ")}/>`);
    pendingPath = null;
  }

  for (let i = 0; i < fnArray.length; i++) {
    const op = fnArray[i];
    const a = argsArray[i];

    switch (op) {
      // ── State save/restore ──
      case OPS.save:
        stack.push({ ...state, ctm: [...state.ctm] });
        break;

      case OPS.restore:
        if (stack.length) {
          // Emit any pending path before restoring state (it was built under current state)
          emitPath(false, false, false);
          Object.assign(state, stack.pop());
        }
        break;

      // ── CTM ──
      case OPS.transform:
        state.ctm = multiplyCTM(state.ctm, a as number[]);
        break;

      // ── Line style ──
      case OPS.setLineWidth:
        state.lineWidth = a[0] as number;
        break;

      // ── Colors ──
      case OPS.setStrokeRGBColor:
        state.strokeColor = rgbCSS(a[0], a[1], a[2]);
        break;
      case OPS.setFillRGBColor:
        state.fillColor = rgbCSS(a[0], a[1], a[2]);
        break;
      case OPS.setStrokeGray:
        state.strokeColor = rgbCSS(a[0], a[0], a[0]);
        break;
      case OPS.setFillGray:
        state.fillColor = rgbCSS(a[0], a[0], a[0]);
        break;
      case OPS.setStrokeCMYKColor: {
        const [c, m, y, k] = a as number[];
        state.strokeColor = rgbCSS(1 - Math.min(1, c + k), 1 - Math.min(1, m + k), 1 - Math.min(1, y + k));
        break;
      }
      case OPS.setFillCMYKColor: {
        const [c, m, y, k] = a as number[];
        state.fillColor = rgbCSS(1 - Math.min(1, c + k), 1 - Math.min(1, m + k), 1 - Math.min(1, y + k));
        break;
      }
      case OPS.setStrokeColor:
      case OPS.setStrokeColorN: {
        const ca = a as number[];
        state.strokeColor = ca.length >= 3 ? rgbCSS(ca[0], ca[1], ca[2]) : rgbCSS(ca[0], ca[0], ca[0]);
        break;
      }
      case OPS.setFillColor:
      case OPS.setFillColorN: {
        const ca = a as number[];
        state.fillColor = ca.length >= 3 ? rgbCSS(ca[0], ca[1], ca[2]) : rgbCSS(ca[0], ca[0], ca[0]);
        break;
      }

      // ── Path construction ──
      case OPS.rectangle: {
        const [rx, ry, rw, rh] = a as number[];
        const tl = applyCTM(state.ctm, rx, ry);
        const br = applyCTM(state.ctm, rx + rw, ry + rh);
        const y0 = pageHeight - tl.y;
        const y1 = pageHeight - br.y;
        const x0 = Math.min(tl.x, br.x);
        const x1 = Math.max(tl.x, br.x);
        const yTop = Math.min(y0, y1);
        const yBot = Math.max(y0, y1);
        const w = x1 - x0;
        const h = yBot - yTop;
        if (w < 0.5 || h < 0.5) break;

        const d = `M ${x0.toFixed(2)} ${yTop.toFixed(2)} h ${w.toFixed(2)} v ${h.toFixed(2)} h ${(-w).toFixed(2)} Z`;
        pendingPath = d;
        // PDF 're' operator implies fill AND stroke with current state
        // We emit immediately as a rectangle-specific path
        const fillV = state.fillColor !== "#000000" ? state.fillColor : "none";
        const parts = [
          `d="${d}"`,
          `fill="${fillV}"`,
          `stroke="${state.strokeColor}"`,
          `stroke-width="${state.lineWidth.toFixed(2)}"`,
          `fill-opacity="${state.fillAlpha}"`,
          `stroke-opacity="${state.strokeAlpha}"`,
        ];
        paths.push(`<path ${parts.join(" ")}/>`);
        pendingPath = null;
        break;
      }

      case OPS.moveTo: {
        const [mx, my] = a as number[];
        const p = applyCTM(state.ctm, mx, my);
        pendingPath = `M ${p.x.toFixed(2)} ${(pageHeight - p.y).toFixed(2)}`;
        break;
      }

      case OPS.lineTo: {
        if (!pendingPath) break;
        const [lx, ly] = a as number[];
        const p = applyCTM(state.ctm, lx, ly);
        pendingPath += ` L ${p.x.toFixed(2)} ${(pageHeight - p.y).toFixed(2)}`;
        break;
      }

      case OPS.curveTo: {
        if (!pendingPath) break;
        const [x1, y1, x2, y2, x3, y3] = a as number[];
        const p1 = applyCTM(state.ctm, x1, y1);
        const p2 = applyCTM(state.ctm, x2, y2);
        const p3 = applyCTM(state.ctm, x3, y3);
        pendingPath += ` C ${p1.x.toFixed(2)} ${(pageHeight - p1.y).toFixed(2)} ${p2.x.toFixed(2)} ${(pageHeight - p2.y).toFixed(2)} ${p3.x.toFixed(2)} ${(pageHeight - p3.y).toFixed(2)}`;
        break;
      }

      case OPS.closePath:
        if (pendingPath) pendingPath += " Z";
        break;

      // ── Clipping ──
      case OPS.clip:
      case OPS.eoClip:
        state.clipping = true;
        pendingPath = null;
        break;

      // ── Path painting ──
      case OPS.stroke:
        emitPath(false, true, false);
        break;
      case OPS.fill:
        emitPath(true, false, false);
        break;
      case OPS.eoFill:
        emitPath(true, false, true);
        break;
      case OPS.fillStroke:
        emitPath(true, true, false);
        break;
      case OPS.eoFillStroke:
        emitPath(true, true, true);
        break;

      // ── Text — skip ──
      case OPS.beginText:
      case OPS.endText:
      case OPS.showText:
      case OPS.showSpacedText:
      case OPS.nextLineShowText:
      case OPS.nextLineSetSpacingShowText:
      case OPS.setFont:
      case OPS.setTextRise:
      // ── Images — skip ──
      case OPS.paintXObject:
      case OPS.paintImageXObject:
      case OPS.paintImageMaskXObject:
      case OPS.beginInlineImage:
      // ── Marked content — skip ──
      case OPS.beginMarkedContent:
      case OPS.endMarkedContent:
      case OPS.beginMarkedContentProps:
      case OPS.beginCompat:
      case OPS.endCompat:
      // ── End marked content sequence ──
      case OPS.markPoint:
      case OPS.markPointProps:
      case OPS.beginDependency:
      case OPS.endDependency:
        break;

      default:
        break;
    }
  }

  if (paths.length === 0) return { svg: "", count: 0 };

  const svg = [
    `<svg class="pf-svg" xmlns="http://www.w3.org/2000/svg"`,
    `  width="100%" height="100%"`,
    `  viewBox="0 0 ${(pageHeight * 0.773).toFixed(0)} ${pageHeight.toFixed(0)}"`,
    `  style="position:absolute;top:0;left:0;width:100%;height:100%;pointer-events:none;overflow:hidden">`,
    ...paths.map((p) => `  ${p}`),
    `</svg>`,
  ].join("\n");

  return { svg, count: paths.length };
}
