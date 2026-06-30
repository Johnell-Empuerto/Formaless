"use client";

interface ProcessingViewProps {
  progress: number;
  current: number;
  total: number;
  status: string;
}

export default function ProcessingView({
  progress,
  current,
  total,
  status,
}: ProcessingViewProps) {
  return (
    <div className="state-card active">
      <div className="processing-inner">
        <div className="spinner-ring">
          <svg viewBox="0 0 50 50">
            <circle className="track" cx="25" cy="25" r="20" />
            <circle className="fill" cx="25" cy="25" r="20" />
          </svg>
        </div>

        <div className="processing-title">Converting your PDF</div>
        <div className="processing-subtitle">{status}</div>

        <div className="progress-track">
          <div className="progress-fill" style={{ width: `${progress}%` }} />
        </div>

        <div className="progress-meta">
          <span>
            {total > 0 ? `Page ${current} of ${total}` : "Preparing..."}
          </span>
          <span className="progress-pct">{progress}%</span>
        </div>
      </div>
    </div>
  );
}
