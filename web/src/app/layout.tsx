import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import { Providers } from "./providers";
import { Header } from "@/components/layout/Header";
import { AudioPlayer } from "@/components/player/AudioPlayer";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin", "cyrillic"],
});

export const metadata: Metadata = {
  title: "near.fm — AI Music for NEAR",
  description:
    "Discover and share AI-generated music about NEAR Protocol. Listen, vote, tip artists with NEAR tokens.",
  openGraph: {
    title: "near.fm — AI Music for NEAR",
    description:
      "Discover and share AI-generated music about NEAR Protocol.",
    type: "website",
    siteName: "near.fm",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className={`${inter.variable} font-sans antialiased`}>
        <Providers>
          <div className="min-h-screen flex flex-col">
            <Header />
            <main className="flex-1 pb-24">{children}</main>
            <AudioPlayer />
          </div>
        </Providers>
      </body>
    </html>
  );
}
