import type { Metadata } from "next";
import { Inter } from "next/font/google";
import { NextIntlClientProvider } from "next-intl";
import { getMessages } from "next-intl/server";
import { notFound } from "next/navigation";
import { routing } from "@/i18n/routing";
import { getTheme } from "@/lib/theme";
import StatusBar from "@/components/StatusBar";
import EntitiesPanel from "@/modules/entities-panel";
import BookList from "@/modules/books-list";
import Sidebar from "@/modules/sidebar";

const inter = Inter({
  subsets: ["latin", "latin-ext"],
  variable: "--font-inter",
  display: "swap",
});

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

  const settingsContent = (
    <p className="text-sm text-[var(--color-text-muted)]">Ustawienia — wkrótce</p>
  );

  return (
    <html lang={locale} data-theme={theme} className={inter.variable}>
      <body className={`app-shell ${inter.className}`}>
        <NextIntlClientProvider messages={messages}>
          <aside className="app-shell-left border-r border-[var(--color-border)] bg-[var(--color-surface)] overflow-hidden">
            <Sidebar
              projectsContent={<BookList />}
              settingsContent={settingsContent}
            />
          </aside>
          <main className="app-shell-main">
            {children}
          </main>
          <aside className="app-shell-right border-l border-[var(--color-border)] bg-[var(--color-surface)] overflow-y-auto p-4">
            <EntitiesPanel />
          </aside>
          <footer className="app-shell-footer overflow-hidden">
            <StatusBar />
          </footer>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}