import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import { Providers } from "./providers";
import { Header } from "@/components/layout/Header";
import { Footer } from "@/components/layout/Footer";
import { AudioPlayer } from "@/components/player/AudioPlayer";
import { SignInModal } from "@/components/layout/SignInModal";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin", "cyrillic"],
});

export const metadata: Metadata = {
  metadataBase: new URL("https://near.fm"),
  title: "near.fm — AI Music for NEAR",
  description:
    "Discover and share AI-generated music about NEAR Protocol. Listen, vote, tip artists with NEAR tokens.",
  icons: {
    icon: [
      { url: "/favicon-32x32.png", sizes: "32x32", type: "image/png" },
      { url: "/favicon-16x16.png", sizes: "16x16", type: "image/png" },
    ],
    apple: "/apple-touch-icon.png",
  },
  manifest: "/site.webmanifest",
  openGraph: {
    title: "near.fm — AI Music for NEAR",
    description:
      "NEAR FM - decentralized radio for AI-generated music about the NEAR ecosystem",
    type: "website",
    siteName: "near.fm",
    images: [
      {
        url: "/near-fm-hor.png",
        width: 1200,
        height: 630,
        alt: "NEAR FM",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "near.fm — AI Music for NEAR",
    description:
      "NEAR FM - decentralized radio for AI-generated music about the NEAR ecosystem",
    images: ["/near-fm-hor.png"],
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
        <script dangerouslySetInnerHTML={{ __html: `document.addEventListener('error',function(e){var t=e.target;if(t&&t.tagName==='IMG'){t.style.opacity='0';t.removeAttribute('src')}},true)` }} />
        <Providers>
          <div className="min-h-screen flex flex-col pb-24">
            <Header />
            <main className="flex-1">{children}</main>
            <Footer />
            <AudioPlayer />
            <SignInModal />
          </div>
        </Providers>
      </body>
    </html>
  );
}
