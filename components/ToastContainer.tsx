"use client";

import { useEffect, useState } from "react";

export interface Toast {
  id: number;
  msg: string;
  type: "success" | "error";
}

interface ToastContainerProps {
  toasts: Toast[];
  onRemove: (id: number) => void;
}

function ToastItem({
  toast,
  onRemove,
}: {
  toast: Toast;
  onRemove: (id: number) => void;
}) {
  const [show, setShow] = useState(false);

  useEffect(() => {
    // Trigger enter animation
    const enter = requestAnimationFrame(() => setShow(true));

    // Auto-dismiss after 4 seconds
    const timer = setTimeout(() => {
      setShow(false);
      // Wait for exit animation before removing from DOM
      setTimeout(() => onRemove(toast.id), 450);
    }, 4000);

    return () => {
      cancelAnimationFrame(enter);
      clearTimeout(timer);
    };
  }, [toast.id, onRemove]);

  const icon = toast.type === "success" ? "fa-check-circle" : "fa-circle-exclamation";

  return (
    <div className={`toast ${toast.type} ${show ? "show" : ""}`}>
      <i className={`fas ${icon}`} />
      {toast.msg}
    </div>
  );
}

export default function ToastContainer({
  toasts,
  onRemove,
}: ToastContainerProps) {
  return (
    <div className="toast-container">
      {toasts.map((t) => (
        <ToastItem key={t.id} toast={t} onRemove={onRemove} />
      ))}
    </div>
  );
}
