import type { Metadata } from "next";
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
