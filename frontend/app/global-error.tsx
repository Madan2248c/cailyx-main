"use client";

import { useEffect } from "react";

/**
 * Last-resort boundary for errors in the root layout itself. It replaces
 * the whole document, so it can't rely on the app's CSS or providers.
 */
export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: 12,
          padding: 16,
          textAlign: "center",
          fontFamily: "system-ui, sans-serif",
          color: "#313337",
          background: "#fcfcfc",
        }}
      >
        <h1 style={{ fontSize: 20, fontWeight: 600, margin: 0 }}>Cailyx couldn&apos;t load</h1>
        <p style={{ fontSize: 14, color: "#6b6c70", maxWidth: 360, margin: 0 }}>
          Please try again in a moment.
          {error.digest ? ` If it keeps happening, share this reference with your Rothenhall lead: ${error.digest}` : ""}
        </p>
        <button
          type="button"
          onClick={() => reset()}
          style={{ marginTop: 8, padding: "8px 16px", borderRadius: 8, border: "1px solid #d7d6d8", background: "#fff", cursor: "pointer", fontSize: 14 }}
        >
          Try again
        </button>
      </body>
    </html>
  );
}
