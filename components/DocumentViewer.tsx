"use client";

import { useCallback, useEffect, useRef } from "react";
import { useDocument } from "@/context/DocumentContext";

export default function DocumentViewer() {
  const { doc, currentPage, zoom, nextPage, prevPage } = useDocument();
  const containerRef = useRef<HTMLDivElement>(null);
  const iframeRef = useRef<HTMLIFrameElement>(null);

  /* ── Dynamically size iframe to match page content ── */
  const onIframeLoad = useCallback(() => {
    const doc =
      iframeRef.current?.contentDocument ||
      iframeRef.current?.contentWindow?.document;
    if (doc) {
      const h = Math.max(
        doc.documentElement.scrollHeight,
        doc.body.scrollHeight,
        400,
      );
      if (iframeRef.current) iframeRef.current.style.height = h + "px";
    }
  }, []);

  /* ── Keyboard shortcuts ── */
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === "ArrowLeft") {
        e.preventDefault();
        prevPage();
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        nextPage();
      }
    },
    [prevPage, nextPage],
  );

  useEffect(() => {
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [handleKeyDown]);

  /* ── Mouse wheel ── */
  const handleWheel = useCallback(
    (e: React.WheelEvent) => {
      // Only capture vertical wheel events
      if (Math.abs(e.deltaX) > Math.abs(e.deltaY)) return;
      if (e.deltaY > 0) nextPage();
      else prevPage();
    },
    [prevPage, nextPage],
  );

  /* ── Click left/right thirds of the viewer ── */
  const handleViewerClick = useCallback(
    (e: React.MouseEvent) => {
      if (!containerRef.current) return;
      const rect = containerRef.current.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const third = rect.width / 3;
      if (x < third) prevPage();
      else if (x > rect.width - third) nextPage();
    },
    [prevPage, nextPage],
  );

  if (!doc) {
    return (
      <div className="viewer-empty">
        <p>No document loaded.</p>
      </div>
    );
  }

  const currentHtml = doc.pages[currentPage] ?? "";
  const pageLabel = `${currentPage + 1} / ${doc.pageCount}`;
  const zoomPct = Math.round(zoom * 100);

  return (
    <div className="viewer-layout">
      {/* Toolbar is rendered by the parent page */}

      <div
        ref={containerRef}
        className="viewer-canvas"
        onWheel={handleWheel}
        onClick={handleViewerClick}
      >
        <div
          className="viewer-page-wrap"
          style={{
            transform: `scale(${zoom})`,
            transformOrigin: "top center",
          }}
        >
          <iframe
            ref={iframeRef}
            key={currentPage}
            className="viewer-iframe"
            srcDoc={currentHtml}
            title={`Page ${currentPage + 1}`}
            onLoad={onIframeLoad}
          />
        </div>
      </div>

      {/* Click hints — navigation zones */}
      <div className="viewer-nav-hints">
        <span className="nav-hint prev">←</span>
        <span className="nav-hint next">→</span>
      </div>
    </div>
  );
}
