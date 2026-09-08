"use client";

import type { AnyApiReferenceConfiguration } from "@scalar/api-reference-react";
import dynamic from "next/dynamic";
const ApiReference = dynamic(
  () =>
    import("@scalar/api-reference-react").then(
      (module) => module.ApiReferenceReact,
    ),
  {
    ssr: false,
    loading: () => (
      <div className="mx-auto max-w-4xl px-6 py-20">
        <h1 className="font-heading text-3xl">Counted API</h1>
        <p className="mt-4 text-sm text-muted-foreground" role="status">
          Loading the API reference…
        </p>
      </div>
    ),
  },
);

// Scalar renders the same generated document the app uses to build its forms.
// Bundle assets locally; no CDN fonts, telemetry, key persistence, or AI agent.
const configuration: AnyApiReferenceConfiguration = {
  url: "/openapi.json",
  theme: "none" as const,
  layout: "modern" as const,
  darkMode: false,
  forceDarkModeState: "light" as const,
  hideDarkModeToggle: true,
  withDefaultFonts: false,
  telemetry: false,
  agent: { disabled: true },
  mcp: { disabled: true },
  persistAuth: false,
  authentication: { preferredSecurityScheme: "serviceKey" },
  hideTestRequestButton: true,
  hideClientButton: true,
  hideDownloadButton: true,
  showDeveloperTools: "never" as const,
  documentDownloadType: "json" as const,
  defaultHttpClient: { targetKey: "shell", clientKey: "curl" },
  customCss: `
    .light-mode {
      --scalar-color-1: #17171b; --scalar-color-2: #55545e; --scalar-color-3: #686773;
      --scalar-color-accent: #0000cc; --scalar-background-1: #fcfcfa;
      --scalar-background-2: #f4f3ee; --scalar-background-3: #ecebe5;
      --scalar-background-accent: #ececf7; --scalar-border-color: #c5c4bb;
      --scalar-button-1: #000082; --scalar-button-1-color: #fcfcfa;
      --scalar-button-1-hover: #000066;
    }
    .scalar-app {
      --scalar-font: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      --scalar-font-code: "SFMono-Regular", Consolas, "Liberation Mono", monospace;
      --scalar-radius: 0; --scalar-radius-lg: 0; --scalar-radius-xl: 0;
      --scalar-sidebar-width: 248px; --scalar-custom-header-height: 73px;
    }
    .section-header, .section-header-label, .introduction-section .section-header {
      font-family: Charter, "Bitstream Charter", "Iowan Old Style", "Palatino Linotype", serif;
      font-weight: 400;
    }
    .sidebar { --scalar-sidebar-background-1: #f4f3ee; --scalar-sidebar-color-1: #17171b; --scalar-sidebar-color-active: #0000cc; --scalar-sidebar-item-active-background: #ececf7; }
  `,
};
export function Reference() {
  return <ApiReference configuration={configuration} />;
}
