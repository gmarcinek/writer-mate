# Writer Mate

Narzędzie edytorskie dla autorów książek wspomagane przez LLM.

## Stack

- **Next.js 15** (App Router, Turbopack)
- **PostgreSQL 16 + pgvector** (Docker)
- **Drizzle ORM**
- **Vercel AI SDK** + OpenAI
- **Tailwind CSS v4**

## Uruchomienie (dev)

### 1. Zmienne środowiskowe

```bash
cp .env.example .env
# Uzupełnij DATABASE_URL i OPENAI_API_KEY
```

### 2. Kontenery Docker

```bash
# Pierwsze uruchomienie / po zmianach w docker/
docker compose up -d --build

# Tylko start (bez rebuild)
docker compose up -d

# Status kontenerów
docker compose ps

# Logi wszystkich serwisów
docker compose logs -f

# Logi konkretnego serwisu
docker compose logs -f playwright
docker compose logs -f bashtool
docker compose logs -f markitdown
```

### 3. Rebuild i restart konkretnego serwisu

```bash
# Rebuild + restart jednego serwisu
docker compose up -d --build playwright
docker compose up -d --build bashtool
docker compose up -d --build markitdown

# Pełny rebuild wszystkich (bez cache)
docker compose build --no-cache
docker compose up -d
```

### 4. Aplikacja Next.js

```bash
npm install
npm run dev        # http://localhost:3000
```

## Porty

| Serwis      | Port  | Protokół | Opis                          |
|-------------|-------|----------|-------------------------------|
| Next.js     | 3000  | HTTP     | Aplikacja (dev)               |
| PostgreSQL  | 5432  | PG       | pgvector/pgvector:pg16        |
| markitdown  | 8000  | HTTP     | POST /convert → { markdown }  |
| markitdown  | 8001  | MCP SSE  | tool: convert_to_markdown     |
| bashtool    | 8002  | MCP SSE  | shell access, /workspace      |
| playwright  | 8003  | MCP SSE  | browser: navigate, screenshot |

## MCP Sidecars (VS Code Copilot)

Wymagają aktywnego Docker Compose. Konfiguracja: `.vscode/mcp.json`.

| MCP         | URL                          | Narzędzia                                      |
|-------------|------------------------------|------------------------------------------------|
| markitdown  | http://localhost:8001/sse    | convert_to_markdown                            |
| bashtool    | http://localhost:8002/sse    | run_bash, read_file, write_file, http_get, ... |
| playwright  | http://localhost:8003/sse    | browser_navigate, browser_screenshot, ...      |

## Drizzle

```bash
# Generowanie migracji
npx drizzle-kit generate

# Push schematu do bazy (dev)
npx drizzle-kit push
```

## Zatrzymanie

```bash
docker compose down          # stop + usunięcie kontenerów
docker compose down -v       # stop + usunięcie kontenerów + wolumenów (!)
```
