import type { Metadata } from "next";
import "./globals.css";
import { DocumentProvider } from "@/context/DocumentContext";

export const metadata: Metadata = {
  title: "Formaless — Paperless Document System",
  description:
    "Convert PDF documents into standalone HTML files — 100% client-side, no uploads, no servers.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <head>
        <link
          href="https://fonts.googleapis.com/css2?family=DM+Sans:opsz,wght@9..40,300;9..40,400;9..40,500;9..40,600;9..40,700&family=Space+Grotesk:wght@500;600;700&display=swap"
          rel="stylesheet"
        />
        <link
          href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.1/css/all.min.css"
          rel="stylesheet"
        />
      </head>
      <body>
        <DocumentProvider>{children}</DocumentProvider>
      </body>
    </html>
  );
}
