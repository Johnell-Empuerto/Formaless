"use client";

import { useRef, useEffect, useCallback } from "react";

interface ResultViewProps {
  html: string;
  fileName: string;
  pageCount: number;
  inputSize: number;
  outputSize: number;
  onDownload: () => void;
  onOpenTab: () => void;
  onNewFile: () => void;
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return bytes + " B";
  if (bytes < 1048576) return (bytes / 1024).toFixed(1) + " KB";
  return (bytes / 1048576).toFixed(1) + " MB";
}

export default function ResultView({
  html,
  fileName,
  pageCount,
  inputSize,
  outputSize,
  onDownload,
  onOpenTab,
  onNewFile,
}: ResultViewProps) {
  const iframeRef = useRef<HTMLIFrameElement>(null);

  // Reset iframe height when html changes
  useEffect(() => {
    if (iframeRef.current) {
      iframeRef.current.style.height = "600px";
    }
  }, [html]);

  const handleIframeLoad = useCallback(() => {
    try {
      const doc =
        iframeRef.current?.contentDocument ||
        iframeRef.current?.contentWindow?.document;
      if (doc) {
        const h = Math.max(
          doc.documentElement.scrollHeight,
          doc.body.scrollHeight,
          400,
        );
        if (iframeRef.current) {
          iframeRef.current.style.height = Math.min(h + 60, 2400) + "px";
        }
      }
    } catch {
      // Cross-origin blocked — fallback height is already set
    }
  }, []);

  return (
    <div className="state-card active">
      <div className="result-toolbar">
        <div className="file-info">
          <div className="file-icon-box">
            <i className="fas fa-file-pdf" />
          </div>
          <div className="file-details">
            <div className="file-name">{fileName}</div>
            <div className="file-meta">
              {pageCount} page{pageCount !== 1 ? "s" : ""} &middot;{" "}
              {formatSize(outputSize)} output &middot; {formatSize(inputSize)}{" "}
              input
            </div>
          </div>
        </div>

        <div className="result-actions">
          <button className="btn btn-primary" onClick={onDownload}>
            <i className="fas fa-download" /> Download HTML
          </button>
          <button className="btn btn-outline" onClick={onOpenTab}>
            <i className="fas fa-external-link-alt" /> Open in Tab
          </button>
          <button className="btn btn-ghost" onClick={onNewFile}>
            <i className="fas fa-plus" /> New File
          </button>
        </div>
      </div>

      <div className="preview-wrap">
        <iframe
          ref={iframeRef}
          title="Converted HTML Preview"
          srcDoc={html}
          onLoad={handleIframeLoad}
        />
      </div>
    </div>
  );
}
