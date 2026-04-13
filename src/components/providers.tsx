"use client";

import { ThemeProvider } from "next-themes";
import { DiagnosticsProvider } from "@/context/diagnostics-context";
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
        <DiagnosticsProvider>
          <PdfProvider>{children}</PdfProvider>
        </DiagnosticsProvider>
      </SettingsProvider>
    </ThemeProvider>
  );
}
