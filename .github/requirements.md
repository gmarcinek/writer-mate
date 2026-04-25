# Wymagania aplikacji Writer Mate

## Opis ogólny

Writer Mate to narzędzie dla autorów książek, umożliwiające wgrywanie tekstu książki, automatyczne dzielenie jej na rozdziały, akapity i zdania, wektoryzację treści oraz zaawansowaną analizę i edycję tekstu. Użytkownik może uruchamiać różne warstwy analizy (Analysis Layer), które – zgodnie z zadanym promptem – wykrywają określone cechy tekstu (np. figury retoryczne), oznaczają fragmenty i przypisują im statusy. Edycja fragmentów przez autora powoduje ponowną analizę i aktualizację oznaczeń. System wspiera iteracyjną pracę nad tekstem, umożliwiając śledzenie zmian i zatwierdzanie poprawek.

## Use case'y

- Użytkownik wgrywa plik z książką do aplikacji.
- System automatycznie dzieli tekst na rozdziały, akapity i zdania.
- Treść książki jest wektoryzowana i zapisywana w bazie.
- Użytkownik widzi podgląd książki z podziałem na fragmenty.
- Użytkownik uruchamia wybraną warstwę analizy (Analysis Layer) z określonym promptem.
- Analiza odbywa się poprzez Agentów AI (agent federation z orkiestracją, do rozważenia inne strategie dlatego użyj tego jako startegii).
- Warstwa analizy to abstrakcja ale ma moduł konfigurujacy analizą, obiekt który ustawia prompt dla LLM który przejdzie po tresci i wykona się na niej. 
- Warstwę analizy można uruchamiać.
- efekty widać na panelu encji oraz na heatmapie w tresci (on/off)
- System analizuje tekst pod kątem zadanym w warstwie, oznacza fragmenty i przypisuje im natężenie/problem.
- Użytkownik widzi heatmapę analizy oraz listę wykrytych encji (problemów/cech).
- Użytkownik klika w fragment, edytuje go i zatwierdza zmianę.
- Po zatwierdzeniu fragment jest ponownie analizowany przez wszystkie warstwy, które go dotyczą.
- Status encji zmienia się w zależności od wyniku ponownej analizy (np. „wykonany”, „zatwierdzony”).
- Użytkownik może przechodzić przez kolejne encje/problemowe fragmenty i poprawiać tekst aż do uzyskania pożądanego efektu.
- Możliwość uruchomienia wielu warstw analizy jednocześnie, każda z własnym promptem i kryteriami.

## System Designu

Aplikacja używa spójnego systemu designu opartego na tokenach CSS i motywie (theme).

### Tokeny designu
- Kolory: background, foreground, surface, surface-hover, border, accent, accent-dim, text-muted, oraz warianty semantyczne (success, warning, error, info)
- Typografia: rodziny fontów (serif dla treści, sans-serif dla UI), skala rozmiarów (xs → 4xl), wagi, line-height
- Spacing: skala 4px-based (0, 1, 2, 3, 4, 6, 8, 12, 16, 24, 32...)
- Promień: none, sm, md, lg, full
- Cienie: sm, md, lg
- Z-index: base, dropdown, modal, toast

### Motywy (themes)
- Obsługa jasnego (light) i ciemnego (dark) motywu
- Motyw zapisywany w cookie po stronie serwera (`theme` cookie)
- Przełącznik motywu dostępny w AppBar
- Domyślny motyw: light
- Implementacja przez `data-theme` attribute na `<html>` + klasy CSS

### Architektura
- Tokeny w `src/design-system/tokens.css` — importowane w `globals.css`
- Provider motywu: server-side (cookie) + client ThemeToggle
- `src/lib/theme.ts` — server helper do odczytu motywu z cookie
- `src/components/ThemeToggle/` — client component z przełącznikiem

## Internacjonalizacja (i18n)

### Obsługiwane języki
- Polski (pl) — domyślny
- Angielski (en)

### Architektura
- Biblioteka: `next-intl` (Next.js 15 App Router)
- Wiadomości w `/messages/pl.json` i `/messages/en.json`
- Locale w URL: `/pl/...` i `/en/...`
- Middleware do detekcji i przekierowania locale
- Typowany dostęp do tłumaczeń przez `useTranslations()` (client) i `getTranslations()` (server)

### Zakres tłumaczeń
- Elementy UI: AppBar, StatusBar, panele boczne, przyciski
- Komunikaty systemowe: stany puste, błędy, potwierdzenia
- Etykiety warstw analizy i encji