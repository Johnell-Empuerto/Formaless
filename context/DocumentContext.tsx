"use client";

import { createContext, useContext, useState, useCallback, type ReactNode } from "react";

export interface DocumentState {
  pages: string[];
  fileName: string;
  pageCount: number;
}

interface DocumentContextValue {
  /** Current document — null when no document is loaded */
  doc: DocumentState | null;
  /** Currently visible page index (0-based) */
  currentPage: number;
  /** Zoom level as a multiplier (1.0 = 100%) */
  zoom: number;
  /** Replace the in-memory document */
  setDocument: (doc: DocumentState) => void;
  /** Clear the document from memory */
  clearDocument: () => void;
  /** Navigate to the previous page (clamps at 0) */
  prevPage: () => void;
  /** Navigate to the next page (clamps at pageCount - 1) */
  nextPage: () => void;
  /** Jump to a specific page index */
  setPage: (n: number) => void;
  /** Increase zoom by 0.1, capped at 3.0 */
  zoomIn: () => void;
  /** Decrease zoom by 0.1, floored at 0.25 */
  zoomOut: () => void;
  /** Set zoom to an exact value (clamped) */
  setZoom: (z: number) => void;
}

const DocumentContext = createContext<DocumentContextValue | null>(null);

const ZOOM_MIN = 0.25;
const ZOOM_MAX = 3.0;
const ZOOM_STEP = 0.1;

export function DocumentProvider({ children }: { children: ReactNode }) {
  const [doc, setDoc] = useState<DocumentState | null>(null);
  const [currentPage, setCurrentPage] = useState(0);
  const [zoom, setZoomState] = useState(1.0);

  const setDocument = useCallback((d: DocumentState) => {
    setDoc(d);
    setCurrentPage(0);
    setZoomState(1.0);
  }, []);

  const clearDocument = useCallback(() => {
    setDoc(null);
    setCurrentPage(0);
    setZoomState(1.0);
  }, []);

  const clampPage = useCallback(
    (n: number) => Math.max(0, Math.min(n, (doc?.pageCount ?? 1) - 1)),
    [doc?.pageCount],
  );

  const prevPage = useCallback(() => {
    setCurrentPage((p) => clampPage(p - 1));
  }, [clampPage]);

  const nextPage = useCallback(() => {
    setCurrentPage((p) => clampPage(p + 1));
  }, [clampPage]);

  const setPage = useCallback(
    (n: number) => {
      setCurrentPage(clampPage(n));
    },
    [clampPage],
  );

  const clampZoom = useCallback((z: number) => Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, z)), []);

  const zoomIn = useCallback(() => {
    setZoomState((z) => clampZoom(z + ZOOM_STEP));
  }, [clampZoom]);

  const zoomOut = useCallback(() => {
    setZoomState((z) => clampZoom(z - ZOOM_STEP));
  }, [clampZoom]);

  const setZoom = useCallback(
    (z: number) => {
      setZoomState(clampZoom(z));
    },
    [clampZoom],
  );

  return (
    <DocumentContext.Provider
      value={{
        doc,
        currentPage,
        zoom,
        setDocument,
        clearDocument,
        prevPage,
        nextPage,
        setPage,
        zoomIn,
        zoomOut,
        setZoom,
      }}
    >
      {children}
    </DocumentContext.Provider>
  );
}

export function useDocument(): DocumentContextValue {
  const ctx = useContext(DocumentContext);
  if (!ctx) throw new Error("useDocument must be used within <DocumentProvider>");
  return ctx;
}
