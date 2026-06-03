import type { Metadata } from "next";
import { Azeret_Mono, Outfit, JetBrains_Mono } from "next/font/google";
import { CountedAnalytics } from "@/components/analytics";
import "./globals.css";

const azeretMono = Azeret_Mono({
  weight: ["500"],
  subsets: ["latin"],
  variable: "--font-brand",
  display: "swap",
});

const outfit = Outfit({
  subsets: ["latin"],
  variable: "--font-outfit",
  display: "swap",
});

const jetbrainsMono = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-jetbrains",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Counted — Privacy-focused app analytics",
  description:
    "Privacy-first analytics with composable dashboards. No cookies, no fingerprinting, no PII. Under 3KB.",
  metadataBase: new URL("https://counted.dev"),
  alternates: {
    types: { "application/rss+xml": [{ url: "/feed.xml", title: "Counted Blog" }] },
  },
  openGraph: {
    title: "Counted — Privacy-focused app analytics",
    description:
      "Composable dashboards, agent-native SDKs, and self-hosting in 60 seconds. No cookies, no fingerprinting, no PII.",
    url: "https://counted.dev",
    siteName: "Counted",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "Counted — Privacy-focused app analytics",
    description:
      "Composable dashboards, agent-native SDKs, and self-hosting in 60 seconds. No cookies, no fingerprinting, no PII.",
  },
  robots: {
    index: true,
    follow: true,
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={`${azeretMono.variable} ${outfit.variable} ${jetbrainsMono.variable}`}
    >
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: `try{var t=localStorage.getItem("theme"),a=localStorage.getItem("accent"),l=false;if(t==="light")l=true;else if(t==="auto"&&matchMedia("(prefers-color-scheme:light)").matches)l=true;if(l)document.documentElement.classList.add("light");if(a){var c=JSON.parse(a);document.documentElement.style.setProperty("--color-accent",l?c.lightColor:c.color);document.documentElement.style.setProperty("--color-accent-hover",l?c.lightHover:c.hover)}}catch(e){}`,
          }}
        />
      </head>
      <body className="font-sans">
        <CountedAnalytics />
        {children}
      </body>
    </html>
  );
}
