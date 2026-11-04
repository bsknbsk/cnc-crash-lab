import type { Metadata } from "next";
import localFont from "next/font/local";
import "./globals.css";

// Self-hosted fonts (app/fonts): Google Fonts serves these families as
// variable woff2 files, so the build stays hermetic with no font CDN fetch.
const geistSans = localFont({
  src: "./fonts/geist.woff2",
  variable: "--font-geist-sans",
  weight: "100 900",
  display: "swap",
});

const geistMono = localFont({
  src: "./fonts/geist-mono.woff2",
  variable: "--font-geist-mono",
  weight: "100 900",
  display: "swap",
});

// Landing page fonts (Barlow Condensed headings, Plex body + mono).
const landingHead = localFont({
  src: [
    { path: "./fonts/barlow-condensed-600.woff2", weight: "600" },
    { path: "./fonts/barlow-condensed-700.woff2", weight: "700" },
  ],
  variable: "--font-landing-head",
  display: "swap",
});

const landingBody = localFont({
  src: "./fonts/plex-sans-latin.woff2",
  variable: "--font-landing-body",
  weight: "100 700",
  display: "swap",
});

const landingMono = localFont({
  src: [
    { path: "./fonts/plex-mono-400.woff2", weight: "400" },
    { path: "./fonts/plex-mono-500.woff2", weight: "500" },
  ],
  variable: "--font-landing-mono",
  display: "swap",
});

export const metadata: Metadata = {
  title: "CNC Crash Lab",
  description:
    "Browser-based CNC training simulator. Crash the virtual machine, see the repair cost, and learn the verified fix.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} ${landingHead.variable} ${landingBody.variable} ${landingMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
