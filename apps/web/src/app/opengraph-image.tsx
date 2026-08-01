import { ImageResponse } from "next/og";

/**
 * The Open Graph card.
 *
 * There was none, while `twitter:card` claimed `summary_large_image` and
 * `organizationLd.logo` pointed at this exact path — so the card rendered
 * text-only and the logo URL 404'd. Every launch channel in the plan (Show HN,
 * Reddit, X) builds its preview from this.
 *
 * Generated rather than designed, on purpose. It uses the site's own plain
 * early-2000s vocabulary — white ground, black Verdana, the classic
 * `#0000cc` link blue — so it reads as the same product rather than as a
 * stock gradient. When a real dashboard screenshot exists it is worth
 * replacing this with one; until then a truthful typographic card beats a
 * missing image.
 */
export const runtime = "edge";
export const alt = "Counted — privacy-first product analytics without the bloat or the banner";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function Image() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          background: "#ffffff",
          padding: "72px 80px",
          fontFamily: "Verdana, Geneva, sans-serif",
          border: "16px solid #0000cc",
        }}
      >
        <div style={{ display: "flex", flexDirection: "column" }}>
          {/* The bar mark from the favicon, drawn rather than fetched. */}
          <div style={{ display: "flex", alignItems: "flex-end", gap: 10, marginBottom: 44 }}>
            {[46, 78, 116, 152].map((h) => (
              <div key={h} style={{ width: 26, height: h, background: "#0000cc" }} />
            ))}
          </div>

          <div style={{ display: "flex", fontSize: 68, color: "#000", lineHeight: 1.1 }}>
            Privacy-first product analytics
          </div>
          <div style={{ display: "flex", fontSize: 68, color: "#0000cc", lineHeight: 1.1 }}>
            without the bloat or the banner
          </div>
        </div>

        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end" }}>
          <div style={{ display: "flex", fontSize: 27, color: "#444" }}>
            Funnels · composable dashboards · no cookies
          </div>
          <div style={{ display: "flex", fontSize: 27, color: "#000" }}>counted.dev</div>
        </div>
      </div>
    ),
    size,
  );
}
