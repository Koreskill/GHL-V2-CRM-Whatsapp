import type { Metadata } from "next";
import { Inter } from "next/font/google";
import { ThemeScript } from "@/components/theme-script";
import "./globals.css";

const inter = Inter({ variable: "--font-inter", subsets: ["latin"] });

export const metadata: Metadata = {
  title: "Setter CRM",
  description: "CRM multicanal: WhatsApp, Instagram y Messenger en una sola bandeja",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="es" suppressHydrationWarning className={`${inter.variable} h-full antialiased`}>
      <head>
        <ThemeScript />
      </head>
      <body className="h-full font-sans">{children}</body>
    </html>
  );
}
