import type { Metadata } from "next";
import { Inter } from "next/font/google";
import { NextIntlClientProvider } from "next-intl";
import { getMessages } from "next-intl/server";
import { notFound } from "next/navigation";
import { routing } from "@/i18n/routing";
import { getTheme } from "@/lib/theme";
import EntitiesPanel from "@/modules/entities-panel";
import HintsPanel from "@/modules/hints-panel";
import BookList from "@/modules/books-list";
import WorkspaceShell from "@/modules/workspace-shell";

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
      <body className={inter.className}>
        <NextIntlClientProvider messages={messages}>
          <WorkspaceShell
            projectsContent={<BookList />}
            settingsContent={settingsContent}
            main={children}
            rightPanel={<EntitiesPanel />}
            hintsPanel={<HintsPanel />}
          />
        </NextIntlClientProvider>
      </body>
    </html>
  );
}