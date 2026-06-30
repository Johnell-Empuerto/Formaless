"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useDocument } from "@/context/DocumentContext";
import DocumentViewer from "@/components/DocumentViewer";
import ViewerToolbar from "@/components/ViewerToolbar";

export default function DocumentPage() {
  const { doc } = useDocument();
  const router = useRouter();

  /* ── Redirect to upload page if no document is in memory ── */
  useEffect(() => {
    if (!doc) router.replace("/");
  }, [doc, router]);

  if (!doc) {
    return (
      <div className="viewer-empty">
        <div className="spinner-ring">
          <svg viewBox="0 0 50 50">
            <circle className="track" cx="25" cy="25" r="20" />
            <circle className="fill" cx="25" cy="25" r="20" />
          </svg>
        </div>
        <p>No document loaded. Redirecting...</p>
      </div>
    );
  }

  return (
    <div className="document-page">
      <ViewerToolbar />
      <DocumentViewer />
    </div>
  );
}
