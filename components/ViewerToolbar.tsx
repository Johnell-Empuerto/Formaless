"use client";

import { useDocument } from "@/context/DocumentContext";
import { useRouter } from "next/navigation";

export default function ViewerToolbar() {
  const { doc, currentPage, zoom, prevPage, nextPage, zoomIn, zoomOut } =
    useDocument();
  const router = useRouter();

  if (!doc) return null;

  const zoomPct = Math.round(zoom * 100);

  return (
    <div className="viewer-toolbar">
      {/* Left group */}
      <div className="toolbar-group">
        <button
          className="tool-btn"
          onClick={() => router.push("/")}
          title="Back to upload"
        >
          <i className="fas fa-arrow-left" />
          <span className="tool-btn-label">Back</span>
        </button>
        <span className="toolbar-divider" />
        <span className="toolbar-doc-name">{doc.fileName}</span>
      </div>

      {/* Center group — page navigation */}
      <div className="toolbar-group">
        <button
          className="tool-btn"
          onClick={prevPage}
          disabled={currentPage === 0}
          title="Previous page (←)"
        >
          <i className="fas fa-chevron-left" />
        </button>
        <span className="toolbar-page-indicator">
          {currentPage + 1} / {doc.pageCount}
        </span>
        <button
          className="tool-btn"
          onClick={nextPage}
          disabled={currentPage === doc.pageCount - 1}
          title="Next page (→)"
        >
          <i className="fas fa-chevron-right" />
        </button>
      </div>

      {/* Right group — zoom */}
      <div className="toolbar-group">
        <button
          className="tool-btn"
          onClick={zoomOut}
          disabled={zoom <= 0.25}
          title="Zoom out"
        >
          <i className="fas fa-minus" />
        </button>
        <span className="toolbar-zoom-label">{zoomPct}%</span>
        <button
          className="tool-btn"
          onClick={zoomIn}
          disabled={zoom >= 3.0}
          title="Zoom in"
        >
          <i className="fas fa-plus" />
        </button>
        <span className="toolbar-divider" />
        <button className="tool-btn tool-btn-placeholder" title="Fit width">
          <i className="fas fa-arrows-left-right" />
        </button>
        <button className="tool-btn tool-btn-placeholder" title="Fit page">
          <i className="fas fa-arrows-maximize" />
        </button>
      </div>
    </div>
  );
}
