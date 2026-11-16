import type { Metadata, Viewport } from "next";
import { Barlow_Condensed, IBM_Plex_Mono, Plus_Jakarta_Sans } from "next/font/google";
import "./globals.css";

const fontDisplay = Barlow_Condensed({
  subsets: ["latin"],
  weight: ["700", "800"],
  variable: "--font-display",
  display: "swap",
});

const fontSans = Plus_Jakarta_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-sans",
  display: "swap",
});

const fontMono = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["500", "600", "700"],
  variable: "--font-mono",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Liminal Campervan Bar",
  description: "Liminal Campervan Bar - Coffee. Culture. Street.",
  manifest: "/manifest.webmanifest",
  icons: {
    icon: [
      { url: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
    shortcut: "/icon-192.png",
    apple: "/icon-192.png",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#143656",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="id"
      className={`${fontDisplay.variable} ${fontSans.variable} ${fontMono.variable}`}
    >
      <body className="antialiased">{children}</body>
    </html>
  );
}
