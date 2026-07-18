import type { Metadata, Viewport } from "next";
import { Big_Shoulders, Instrument_Sans } from "next/font/google";
import { brand } from "@/lib/brand";
import "./globals.css";

// Display face (condensed poster type) + working grotesque, exposed as CSS
// variables consumed by globals.css with system-stack fallbacks — dropping
// either font degrades gracefully instead of breaking styles.
const displayFont = Big_Shoulders({
  subsets: ["latin"],
  variable: "--font-display",
  axes: ["opsz"],
});

const uiFont = Instrument_Sans({
  subsets: ["latin"],
  variable: "--font-ui",
});

export const metadata: Metadata = {
  title: brand.name,
  description: `${brand.name} — Season OS for competitive show choir.`,
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#ffffff" },
    { media: "(prefers-color-scheme: dark)", color: "#101014" },
  ],
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={`${displayFont.variable} ${uiFont.variable}`}>
      <body>{children}</body>
    </html>
  );
}
