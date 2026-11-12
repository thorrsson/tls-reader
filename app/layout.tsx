import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "TLS Library",
  description: "Brand-customized Thorium Web reader pilot",
  icons: {
    icon: "/branding/tls-library/favicon.png",
    shortcut: "/branding/tls-library/favicon.png",
    apple: "/branding/tls-library/favicon.png",
  },
};

// Lets the iOS/Android shells draw edge to edge; layout pads by the safe area.
export const viewport: Viewport = {
  viewportFit: "cover",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
