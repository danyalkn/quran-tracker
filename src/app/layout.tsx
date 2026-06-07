import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import { ServiceWorkerRegister } from "@/components/ServiceWorkerRegister";

/**
 * Inter is self-hosted by next/font (served from our own domain at build
 * time). It is used ONLY as the fallback for non-Apple platforms — the font
 * stack in globals.css leads with -apple-system so SF renders on iOS/macOS
 * and Inter takes over on Android/Windows.
 */
const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Iqra",
  description: "Private Quran-study accountability for you and your circle.",
  applicationName: "Iqra",
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    title: "Iqra",
    statusBarStyle: "default",
  },
  icons: {
    icon: [
      { url: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
    apple: "/icons/apple-touch-icon.png",
  },
  // Never index this private app.
  robots: { index: false, follow: false, nocache: true },
  formatDetection: { telephone: false },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  // Extend under the notch / home indicator; CSS uses env(safe-area-inset-*).
  viewportFit: "cover",
  // When the soft keyboard opens, shrink the *layout* viewport (not just the
  // visual one) so h-dvh reflows above the keyboard instead of the page being
  // scrolled up with dead space left below.
  interactiveWidget: "resizes-content",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#FAFAF8" },
    { media: "(prefers-color-scheme: dark)", color: "#0B0B0C" },
  ],
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`${inter.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col">
        <ServiceWorkerRegister />
        {children}
      </body>
    </html>
  );
}
