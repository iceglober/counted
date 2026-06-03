import { ImageResponse } from "next/og";

// Branded default share image for every page (Next auto-wires og:image from
// this file). Rendered from JSX — no design asset to maintain. Per-page images
// (e.g. blog post titles) can override by adding opengraph-image in a segment.

export const alt = "Counted — Privacy-first analytics for products that respect users";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function OpengraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          height: "100%",
          width: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          background: "#08090D",
          padding: "80px",
          fontFamily: "sans-serif",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 18 }}>
          <div style={{ width: 30, height: 30, borderRadius: 9, background: "#7C6CF7" }} />
          <div style={{ fontSize: 36, color: "#ECEEF4", letterSpacing: 1 }}>Counted</div>
        </div>

        <div style={{ display: "flex", flexDirection: "column" }}>
          <div style={{ fontSize: 78, color: "#ECEEF4", lineHeight: 1.05, fontWeight: 600 }}>
            Privacy-first analytics
          </div>
          <div style={{ fontSize: 78, color: "#7C6CF7", lineHeight: 1.05, fontWeight: 600 }}>
            for products that respect users
          </div>
        </div>

        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            fontSize: 30,
            color: "#8A8F9C",
          }}
        >
          <div>No cookies · No fingerprinting · No PII</div>
          <div style={{ color: "#ECEEF4" }}>counted.dev</div>
        </div>
      </div>
    ),
    { ...size },
  );
}
