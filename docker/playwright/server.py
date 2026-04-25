"""
Playwright MCP sidecar — sterowanie przeglądarką Chromium (headless).

Port 8003: MCP SSE

Narzędzia:
  browser_navigate   — otwiera URL w przeglądarce
  browser_click      — klika element (CSS selector lub Playwright text selector)
  browser_fill       — wypełnia pole formularza
  browser_screenshot — robi screenshot → /workspace/screenshots/ + base64
  browser_get_text   — pobiera tekst ze strony lub wskazanego elementu
  browser_get_url    — zwraca aktualny URL
  browser_close      — zamyka przeglądarkę / resetuje sesję
"""
import asyncio
import base64
import os
from datetime import datetime
from pathlib import Path

import uvicorn
from mcp.server.fastmcp import FastMCP
from playwright.async_api import Browser, Page, async_playwright
from starlette.applications import Starlette
from starlette.responses import JSONResponse
from starlette.routing import Mount, Route

SCREENSHOTS_DIR = Path("/workspace/screenshots")
MCP_PORT = int(os.getenv("MCP_PORT", "8003"))
APP_URL = os.getenv("APP_URL", "http://host.docker.internal:3000")

# ─── Browser singleton ─────────────────────────────────────────────────────────
_playwright_instance = None
_browser: Browser | None = None
_page: Page | None = None


async def get_page() -> Page:
    global _playwright_instance, _browser, _page
    if _playwright_instance is None:
        _playwright_instance = await async_playwright().start()
    if _browser is None or not _browser.is_connected():
        _browser = await _playwright_instance.chromium.launch(
            headless=True,
            args=["--no-sandbox", "--disable-dev-shm-usage"],
        )
    if _page is None or _page.is_closed():
        _page = await _browser.new_page(viewport={"width": 1280, "height": 800})
    return _page


# ─── FastMCP Server ────────────────────────────────────────────────────────────
mcp = FastMCP("playwright-mcp")


@mcp.tool()
async def browser_navigate(url: str, wait_until: str = "networkidle") -> str:
    """Otwiera podany URL w przeglądarce Chromium. Domyślnie czeka na networkidle przed zwróceniem wyniku."""
    page = await get_page()
    await page.goto(url, wait_until=wait_until, timeout=30000)
    return f"OK: Otwarto {page.url}"


@mcp.tool()
async def browser_click(selector: str) -> str:
    """Klika element wskazany CSS selectorem lub Playwright text selectorem."""
    page = await get_page()
    await page.click(selector, timeout=10000)
    return f"OK: Kliknięto '{selector}'"


@mcp.tool()
async def browser_fill(selector: str, value: str) -> str:
    """Wypełnia pole formularza wartością."""
    page = await get_page()
    await page.fill(selector, value, timeout=10000)
    return f"OK: Wypełniono '{selector}'"


@mcp.tool()
async def browser_screenshot(name: str = "screenshot", full_page: bool = False) -> str:
    """Robi screenshot aktualnej strony. Zapisuje plik do /workspace/screenshots/ i zwraca base64 obrazu."""
    page = await get_page()
    SCREENSHOTS_DIR.mkdir(parents=True, exist_ok=True)
    filename = f"{datetime.now().strftime('%Y%m%d_%H%M%S')}_{name}.png"
    filepath = SCREENSHOTS_DIR / filename
    await page.screenshot(path=str(filepath), full_page=full_page)
    b64_string = base64.b64encode(filepath.read_bytes()).decode("utf-8")
    return f"OK: /workspace/screenshots/{filename}\nbase64:{b64_string}"


@mcp.tool()
async def browser_get_text(selector: str = "") -> str:
    """Pobiera tekst ze strony. Bez selectora zwraca cały tekst body; z selectorem — tekst wskazanego elementu."""
    page = await get_page()
    if selector:
        return await page.locator(selector).first.inner_text(timeout=10000)
    return await page.inner_text("body", timeout=10000)


@mcp.tool()
async def browser_get_url() -> str:
    """Zwraca aktualny URL otwarty w przeglądarce."""
    page = await get_page()
    return page.url


@mcp.tool()
async def browser_close() -> str:
    """Zamyka przeglądarkę i resetuje sesję. Następne wywołanie otworzy nową instancję."""
    global _playwright_instance, _browser, _page
    if _page is not None:
        await _page.close()
        _page = None
    if _browser is not None:
        await _browser.close()
        _browser = None
    if _playwright_instance is not None:
        await _playwright_instance.stop()
        _playwright_instance = None
    return "OK: Przeglądarka zamknięta"


# ─── ASGI app z health + MCP SSE ──────────────────────────────────────────────
async def health(request):
    return JSONResponse({"status": "ok", "service": "playwright-mcp"})


app = Starlette(routes=[
    Route("/health", health),
    Mount("/", app=mcp.sse_app()),
])


async def main():
    config = uvicorn.Config(app, host="0.0.0.0", port=MCP_PORT, log_level="info")
    await uvicorn.Server(config).serve()


if __name__ == "__main__":
    asyncio.run(main())