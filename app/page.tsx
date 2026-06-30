"use client";

import { useState, useCallback, useRef } from "react";
import { useRouter } from "next/navigation";
import UploadZone from "@/components/UploadZone";
import ProcessingView from "@/components/ProcessingView";
import ErrorView from "@/components/ErrorView";
import ToastContainer, { type Toast } from "@/components/ToastContainer";
import { useDocument } from "@/context/DocumentContext";
import { convertPdfToHtml } from "@/lib/converter";

type AppState = "upload" | "processing" | "error";

export default function Home() {
  const [state, setState] = useState<AppState>("upload");
  const [progress, setProgress] = useState(0);
  const [currentPage, setCurrentPage] = useState(0);
  const [totalPages, setTotalPages] = useState(0);
  const [statusText, setStatusText] = useState("");
  const [errorMsg, setErrorMsg] = useState("");
  const { setDocument } = useDocument();
  const router = useRouter();
  const [toasts, setToasts] = useState<Toast[]>([]);

  // Guards against stale conversions if user triggers multiple quickly
  const conversionGen = useRef(0);

  /* ── Toast helpers ── */
  const addToast = useCallback(
    (msg: string, type: "success" | "error" = "success") => {
      const id = Date.now() + Math.random();
      setToasts((prev) => [...prev, { id, msg, type }]);
    },
    [],
  );

  const removeToast = useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  /* ── Reset to upload state ── */
  const reset = useCallback(() => {
    setState("upload");
    setProgress(0);
    setCurrentPage(0);
    setTotalPages(0);
    setStatusText("");
    setErrorMsg("");
  }, []);

  /* ── Core file handler ── */
  const handleFile = useCallback(
    async (file: File) => {
      // Validate type
      if (file.type !== "application/pdf" && !/\.pdf$/i.test(file.name)) {
        setErrorMsg("Please select a valid PDF file.");
        setState("error");
        addToast("Please select a valid PDF file.", "error");
        return;
      }

      // Validate size (100 MB)
      if (file.size > 100 * 1048576) {
        setErrorMsg("File exceeds the 100 MB limit. Try a smaller file.");
        setState("error");
        addToast("File exceeds the 100 MB limit.", "error");
        return;
      }

      // Begin processing
      const gen = ++conversionGen.current;
      setState("processing");
      setStatusText("Loading document...");
      setProgress(0);
      setCurrentPage(0);
      setTotalPages(0);

      try {
        const result = await convertPdfToHtml(file, {
          onProgress: (cur, tot) => {
            if (conversionGen.current !== gen) return;
            setProgress(Math.round((cur / tot) * 100));
            setCurrentPage(cur);
            setTotalPages(tot);
          },
          onStatus: (msg) => {
            if (conversionGen.current !== gen) return;
            setStatusText(msg);
          },
        });

        // Bail if a newer conversion was started
        if (conversionGen.current !== gen) return;

        /* ── Store in context and navigate to document viewer ── */
        setDocument({
          pages: result.pages,
          fileName: file.name,
          pageCount: result.pageCount,
        });
        router.push("/document");
      } catch (err: unknown) {
        if (conversionGen.current !== gen) return;
        console.error("Conversion error:", err);

        let msg = "An unexpected error occurred while converting the PDF.";
        if (err instanceof Error) {
          if (err.name === "PasswordException")
            msg =
              "This PDF is password-protected and cannot be processed in the browser.";
          else if (err.name === "InvalidPDFException")
            msg = "The file does not appear to be a valid or intact PDF.";
          else if (err.message && err.message.length < 200) msg = err.message;
        }
        setErrorMsg(msg);
        setState("error");
        addToast(msg, "error");
      }
    },
    [addToast],
  );

  return (
    <>
      <div className="container">
        {/* Header */}
        <header className="header anim-in">
          <div className="header-badge">
            <i className="fas fa-lock" /> 100% Client-Side
          </div>
          <div className="header-icon">
            <i className="fas fa-file-code" />
          </div>
          <h1>
            PDF to <span>HTML</span>
          </h1>
          <p>
            Convert your PDF documents into standalone HTML files. Everything
            runs locally in your browser — no uploads, no servers.
          </p>
        </header>

        {/* Features */}
        <div className="features anim-in anim-in-d1">
          <div className="feature-chip">
            <i className="fas fa-shield-halved" /> Private &amp; Secure
          </div>
          <div className="feature-chip">
            <i className="fas fa-bolt" /> Instant Conversion
          </div>
          <div className="feature-chip">
            <i className="fas fa-font" /> Selectable Text
          </div>
        </div>

        {/* Conditional view rendering */}
        {state === "upload" && (
          <div className="anim-in anim-in-d2">
            <UploadZone onFileSelect={handleFile} />
          </div>
        )}

        {state === "processing" && (
          <ProcessingView
            progress={progress}
            current={currentPage}
            total={totalPages}
            status={statusText}
          />
        )}

        {state === "error" && <ErrorView message={errorMsg} onRetry={reset} />}
      </div>

      <ToastContainer toasts={toasts} onRemove={removeToast} />
    </>
  );
}
