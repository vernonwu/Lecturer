import type { Metadata } from "next";
import { AppProviders } from "@/components/providers";
import "katex/dist/katex.min.css";
import "./globals.css";

export const metadata: Metadata = {
  title: "Lecturer",
  description:
    "Convert academic PDFs into interactive, synced Markdown lecture notes.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html suppressHydrationWarning lang="en" className="h-full">
      <body
        suppressHydrationWarning
        className="min-h-screen flex flex-col bg-fixed bg-no-repeat bg-slate-50 bg-gradient-to-br from-slate-100 via-blue-50 to-sky-100 antialiased text-slate-900 dark:bg-slate-950 dark:bg-gradient-to-b dark:from-slate-900 dark:via-slate-950 dark:to-slate-950 dark:text-slate-100"
      >
        <AppProviders>{children}</AppProviders>
      </body>
    </html>
  );
}
