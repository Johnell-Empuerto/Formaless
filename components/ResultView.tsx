"use client";

interface ResultViewProps {
  html: string;
  fileName: string;
  pageCount: number;
  inputSize: number;
  outputSize: number;
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
  onNewFile,
}: ResultViewProps) {
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
          <button className="btn btn-outline" onClick={onNewFile}>
            <i className="fas fa-plus" /> New File
          </button>
        </div>
      </div>

      <div className="preview-wrap">
        <iframe
          title="Converted Document"
          srcDoc={html}
        />
      </div>
    </div>
  );
}
