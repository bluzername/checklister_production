import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { AuthProvider } from "@/components/auth/AuthProvider";
import { MaintenanceBanner } from "@/components/MaintenanceBanner";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'),
  title: "SwingTrade Pro - 10-Point Swing Analysis",
  description: "Professional swing trading analysis with portfolio and watchlist management",
  openGraph: {
    title: "SwingTrade Pro - 10-Point Swing Analysis",
    description: "Professional swing trading analysis with portfolio and watchlist management",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "SwingTrade Pro - 10-Point Swing Analysis",
    description: "Professional swing trading analysis with portfolio and watchlist management",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        <AuthProvider>
          <MaintenanceBanner />
          {children}
        </AuthProvider>
      </body>
    </html>
  );
}
