import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { headers } from "next/headers";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export async function generateMetadata(): Promise<Metadata> {
  const requestHeaders = await headers();
  const host = requestHeaders.get("x-forwarded-host") ?? requestHeaders.get("host") ?? "localhost:3000";
  const protocol = requestHeaders.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  const baseUrl = `${protocol}://${host}`;
  const imageUrl = `${baseUrl}/og.png`;
  const faviconUrl = `${baseUrl}/forgescript-favicon-32.png`;
  const appIconUrl = `${baseUrl}/forgescript-icon-512.png`;
  const appleIconUrl = `${baseUrl}/forgescript-apple-touch-icon.png`;
  const title = "ForgeScript — Minecraft AI 建筑工作台";
  const description = "通过大模型生成受控 JavaScript，预览、校验并导出多版本 Minecraft Litematic 结构。";
  return {
    title,
    description,
    icons: {
      icon: [
        { url: faviconUrl, type: "image/png", sizes: "32x32" },
        { url: appIconUrl, type: "image/png", sizes: "512x512" },
      ],
      shortcut: faviconUrl,
      apple: [{ url: appleIconUrl, type: "image/png", sizes: "180x180" }],
    },
    openGraph: {
      title,
      description,
      type: "website",
      images: [{ url: imageUrl, width: 1743, height: 905, alt: "ForgeScript Minecraft AI 建筑工作台" }],
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      images: [imageUrl],
    },
  };
}

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-CN" suppressHydrationWarning>
      <body className={`${geistSans.variable} ${geistMono.variable}`}>
        {children}
      </body>
    </html>
  );
}
