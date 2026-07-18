import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? "https://forgescript.mengstudystudio.cn";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const title = "ForgeScript — Minecraft AI 建筑工作台";
const description = "通过大模型生成受控 JavaScript，预览、校验并导出多版本 Minecraft Litematic 结构。";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title,
  description,
  icons: {
    icon: [
      { url: "/forgescript-favicon-32.png", type: "image/png", sizes: "32x32" },
      { url: "/forgescript-icon-512.png", type: "image/png", sizes: "512x512" },
    ],
    shortcut: "/forgescript-favicon-32.png",
    apple: [{ url: "/forgescript-apple-touch-icon.png", type: "image/png", sizes: "180x180" }],
  },
  openGraph: {
    title,
    description,
    type: "website",
    images: [{ url: "/og.png", width: 1743, height: 905, alt: "ForgeScript Minecraft AI 建筑工作台" }],
  },
  twitter: {
    card: "summary_large_image",
    title,
    description,
    images: ["/og.png"],
  },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-CN" className={`${geistSans.variable} ${geistMono.variable}`} suppressHydrationWarning>
      <body>
        {children}
      </body>
    </html>
  );
}
