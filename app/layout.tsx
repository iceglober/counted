import type { Metadata } from "next";
import { Instrument_Serif, Outfit, JetBrains_Mono } from "next/font/google";
import "./globals.css";

const instrumentSerif = Instrument_Serif({
  weight: "400",
  subsets: ["latin"],
  variable: "--font-instrument",
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
    "Privacy-first analytics with composable dashboards. No cookies, no PII, ~2KB SDK.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html
      lang="en"
      className={`${instrumentSerif.variable} ${outfit.variable} ${jetbrainsMono.variable}`}
    >
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: `try{if(localStorage.getItem("theme")==="light")document.documentElement.classList.add("light")}catch(e){}`,
          }}
        />
      </head>
      <body className="font-sans">{children}</body>
    </html>
  );
}
