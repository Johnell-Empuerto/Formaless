"use client";

import { useState, useCallback, useRef } from "react";
import UploadZone from "@/components/UploadZone";
import ProcessingView from "@/components/ProcessingView";
import ResultView from "@/components/ResultView";
import ErrorView from "@/components/ErrorView";
import ToastContainer, { type Toast } from "@/components/ToastContainer";
import { convertPdfToHtml } from "@/lib/converter";

type AppState = "upload" | "processing" | "result" | "error";

export default function Home() {
  const [state, setState] = useState<AppState>("upload");
  const [progress, setProgress] = useState(0);
  const [currentPage, setCurrentPage] = useState(0);
  const [totalPages, setTotalPages] = useState(0);
  const [statusText, setStatusText] = useState("");
  const [html, setHtml] = useState("");
  const [fileName, setFileName] = useState("");
  const [pageCount, setPageCount] = useState(0);
  const [inputSize, setInputSize] = useState(0);
  const [outputSize, setOutputSize] = useState(0);
  const [errorMsg, setErrorMsg] = useState("");
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
    setHtml("");
    setFileName("");
    setPageCount(0);
    setInputSize(0);
    setOutputSize(0);
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

        const outBytes = new Blob([result.html], { type: "text/html" }).size;

        setHtml(result.html);
        setFileName(file.name);
        setPageCount(result.pageCount);
        setInputSize(file.size);
        setOutputSize(outBytes);
        setState("result");
        addToast(
          `${result.pageCount} page${result.pageCount !== 1 ? "s" : ""} converted successfully`,
        );
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

  /* ── Download handler ── */
  const handleDownload = useCallback(() => {
    const blob = new Blob([html], { type: "text/html;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = fileName.replace(/\.pdf$/i, ".html");
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(a.href);
    addToast("HTML file downloaded");
  }, [html, fileName, addToast]);

  /* ── Open in new tab ── */
  const handleOpenTab = useCallback(() => {
    const blob = new Blob([html], { type: "text/html;charset=utf-8" });
    window.open(URL.createObjectURL(blob), "_blank");
    addToast("Opened in new tab");
  }, [html, addToast]);

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

        {state === "result" && (
          <ResultView
            html={html}
            fileName={fileName}
            pageCount={pageCount}
            inputSize={inputSize}
            outputSize={outputSize}
            onDownload={handleDownload}
            onOpenTab={handleOpenTab}
            onNewFile={reset}
          />
        )}

        {state === "error" && <ErrorView message={errorMsg} onRetry={reset} />}
      </div>

      <ToastContainer toasts={toasts} onRemove={removeToast} />
    </>
  );
}
