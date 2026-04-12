"use client";

import { ThemeProvider } from "next-themes";
import { PdfProvider } from "@/context/pdf-context";
import { SettingsProvider } from "@/context/settings-context";

export function AppProviders({ children }: { children: React.ReactNode }) {
  return (
    <ThemeProvider
      attribute="class"
      defaultTheme="system"
      enableSystem
      disableTransitionOnChange
    >
      <SettingsProvider>
        <PdfProvider>{children}</PdfProvider>
      </SettingsProvider>
    </ThemeProvider>
  );
}
