import type { Metadata, Viewport } from "next";
import { Exo_2, JetBrains_Mono, Open_Sans } from "next/font/google";
import "./globals.css";

// The design's three faces: Exo 2 for headings, Open Sans for body, a mono
// for every figure and date. next/font downloads them at build time and
// serves them from this app, so a LAN-only box never asks Google for a font
// at runtime. design.css reads the variables.
const exo = Exo_2({
  variable: "--font-exo",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
});

const openSans = Open_Sans({
  variable: "--font-open-sans",
  subsets: ["latin"],
  weight: ["400", "600", "700"],
});

const jetbrains = JetBrains_Mono({
  variable: "--font-jetbrains",
  subsets: ["latin"],
  weight: ["400", "500", "600"],
});

export const metadata: Metadata = {
  title: "Tommy's Money Book",
  description: "Personal and business bookkeeping, fed daily from Akahu.",
};

// `viewport-fit=cover` is what makes env(safe-area-inset-bottom) report a real
// value — without it the bottom tab bar sits under the home indicator on an
// iPhone. Both colour schemes are declared because the theme follows the OS
// (design.css), so form controls and scrollbars must be able to render either.
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  colorScheme: "light dark",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en-NZ"
      className={`${exo.variable} ${openSans.variable} ${jetbrains.variable}`}
    >
      {/* .mb is the design system's root: tokens, theme and the 768px
          container that every layout switch measures against. */}
      <body className="mb">{children}</body>
    </html>
  );
}
