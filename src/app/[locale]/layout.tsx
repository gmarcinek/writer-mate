import type { Metadata } from "next";
import { NextIntlClientProvider } from "next-intl";
import { getMessages } from "next-intl/server";
import { notFound } from "next/navigation";
import { routing } from "@/i18n/routing";
import { getTheme } from "@/lib/theme";
import AppBar from "@/components/AppBar";
import StatusBar from "@/components/StatusBar";
import ToolsPanel from "@/modules/tools-panel";
import LayersPanel from "@/modules/layers-panel";
import EntitiesPanel from "@/modules/entities-panel";
import BookList from "@/modules/books-list";

export const metadata: Metadata = {
  title: "Writer Mate",
  description: "Narzędzie edytorskie dla pisarzy wspomagane przez LLM",
};

export function generateStaticParams() {
  return routing.locales.map((locale) => ({ locale }));
}

export default async function LocaleLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!routing.locales.includes(locale as "pl" | "en")) notFound();

  const [messages, theme] = await Promise.all([getMessages(), getTheme()]);

  return (
    <html lang={locale} data-theme={theme}>
      <body className="app-shell">
        <NextIntlClientProvider messages={messages}>
          <header className="app-shell-header border-b border-[var(--color-border)] flex items-center justify-between px-4">
            <AppBar />
          </header>
          <aside className="app-shell-left flex flex-col gap-4 p-3 overflow-y-auto border-r border-[var(--color-border)] bg-[var(--color-surface)]">
            <ToolsPanel />
            <LayersPanel />
            <BookList />
          </aside>
          <main className="app-shell-main">
            {children}
          </main>
          <aside className="app-shell-right p-3 overflow-y-auto border-l border-[var(--color-border)] bg-[var(--color-surface)]">
            <EntitiesPanel />
          </aside>
          <footer className="app-shell-footer border-t border-[var(--color-border)] bg-[var(--color-surface)] flex items-center px-4">
            <StatusBar />
          </footer>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}