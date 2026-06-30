"use client";

interface ErrorViewProps {
  message: string;
  onRetry: () => void;
}

export default function ErrorView({ message, onRetry }: ErrorViewProps) {
  return (
    <div className="state-card active">
      <div className="error-inner">
        <div className="error-icon-box">
          <i className="fas fa-triangle-exclamation" />
        </div>
        <div className="error-title">Conversion Failed</div>
        <div className="error-msg">{message}</div>
        <button className="btn btn-primary" onClick={onRetry}>
          <i className="fas fa-arrow-rotate-left" /> Try Again
        </button>
      </div>
    </div>
  );
}
