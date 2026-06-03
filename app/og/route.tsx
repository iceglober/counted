import { ImageResponse } from "next/og";

// Dynamic per-page share image: /og?title=...&eyebrow=... renders a branded card
// with the page's own title. One generator, titles via query param — pages set
// it through buildArticleMetadata. The static app/opengraph-image.tsx stays the
// default for pages that don't pass a title.

export function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const title = (searchParams.get("title") ?? "Privacy-first analytics").slice(0, 120);
  const eyebrow = (searchParams.get("eyebrow") ?? "Counted").slice(0, 40);

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
          <div style={{ fontSize: 32, color: "#ECEEF4", letterSpacing: 1 }}>Counted</div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
          <div style={{ fontSize: 26, color: "#7C6CF7", letterSpacing: 3, textTransform: "uppercase" }}>
            {eyebrow}
          </div>
          <div style={{ fontSize: 68, color: "#ECEEF4", lineHeight: 1.08, fontWeight: 600 }}>{title}</div>
        </div>

        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            fontSize: 28,
            color: "#8A8F9C",
          }}
        >
          <div>No cookies · No fingerprinting · No PII</div>
          <div style={{ color: "#ECEEF4" }}>counted.dev</div>
        </div>
      </div>
    ),
    { width: 1200, height: 630 },
  );
}
