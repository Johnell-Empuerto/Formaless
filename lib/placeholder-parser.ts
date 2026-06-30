/**
 * Placeholder parser — extensible system for detecting and rendering
 * interactive form fields inside a PDF-derived HTML document.
 *
 * To add a new placeholder type (e.g. {{number}}, {{date}}):
 * 1. Add the type string to the PLACEHOLDER_PATTERN capture group.
 * 2. Add a case to renderPlaceholderField().
 * 3. Register the associated CSS class in the converter's style block.
 */

export interface PlaceholderPosition {
  left: number;
  top: number;
  width: number;
  height: number;
  fontSize: number;
}

/** Matches exact placeholders like {{text}}, {{number}}, etc. */
const PLACEHOLDER_PATTERN = /^\{\{(text)\}\}$/;

/**
 * Detect whether a text item is a known placeholder.
 * Returns the placeholder type (e.g. "text") or null.
 */
export function detectPlaceholder(text: string): string | null {
  const trimmed = text.trim();
  const match = trimmed.match(PLACEHOLDER_PATTERN);
  return match ? match[1] : null;
}

/**
 * Render an interactive field for a detected placeholder.
 * Returns the HTML string, or null if the type is unknown.
 */
export function renderPlaceholderField(
  type: string,
  pos: PlaceholderPosition,
): string | null {
  switch (type) {
    case "text":
      return renderTextInput(pos);
    default:
      return null;
  }
}

/* ── Internal renderers ── */

function renderTextInput(pos: PlaceholderPosition): string {
  return (
    `<input` +
    `  type="text"` +
    `  class="pf-field pf-text"` +
    `  style="left:${pos.left.toFixed(1)}px;top:${pos.top.toFixed(1)}px;` +
    `width:${pos.width.toFixed(1)}px;height:${pos.height.toFixed(1)}px;` +
    `font-size:${pos.fontSize.toFixed(1)}px"` +
    `  autocomplete="off"` +
    `  spellcheck="false"` +
    `/>`
  );
}
