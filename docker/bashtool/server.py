"""
BashTool MCP sidecar — agent shell z dostępem do sieci writer-net.

Port 8002: MCP SSE

Narzędzia:
  run_bash        — uruchamia polecenie w izolowanym środowisku
  convert_doc     — proxy do markitdown sidecar (http://markitdown:8000)
  read_file       — odczytuje plik z /workspace
  write_file      — zapisuje plik do /workspace
  list_files      — listing plików w /workspace
  http_get        — GET do dowolnego URL w sieci writer-net
  http_post       — POST do dowolnego URL w sieci writer-net
"""
import asyncio
import json
import os
import subprocess
from pathlib import Path

import httpx
import uvicorn
from mcp.server.fastmcp import FastMCP
from starlette.applications import Starlette
from starlette.responses import JSONResponse
from starlette.routing import Mount, Route

WORKSPACE = Path("/workspace")
MARKITDOWN_URL = os.getenv("MARKITDOWN_URL", "http://markitdown:8000")
MCP_PORT = int(os.getenv("MCP_PORT", "8002"))

# ─── FastMCP Server ────────────────────────────────────────────────────────────
mcp = FastMCP("bashtool-mcp")


@mcp.tool()
async def run_bash(command: str, cwd: str = "/workspace", timeout: int = 30) -> str:
    """Uruchamia polecenie bash w kontenerze. Workspace projektu jest dostępny pod /workspace. Zwraca stdout, stderr i kod wyjścia."""
    try:
        result = subprocess.run(
            ["bash", "-c", command],
            capture_output=True,
            text=True,
            timeout=timeout,
            cwd=cwd,
        )
        return (
            f"exit_code: {result.returncode}\n"
            f"stdout:\n{result.stdout}\n"
            f"stderr:\n{result.stderr}"
        )
    except subprocess.TimeoutExpired:
        return f"TIMEOUT po {timeout}s"
    except Exception as e:
        return f"BŁĄD: {e}"


@mcp.tool()
async def convert_doc(url: str = "", content: str = "") -> str:
    """Konwertuje URL lub treść HTML/tekst do Markdown via markitdown sidecar."""
    async with httpx.AsyncClient() as client:
        resp = await client.post(
            f"{MARKITDOWN_URL}/convert",
            json={"url": url, "content": content},
            timeout=60.0,
        )
        resp.raise_for_status()
    return resp.json()["markdown"]


@mcp.tool()
async def read_file(path: str) -> str:
    """Odczytuje zawartość pliku z workspace projektu (/workspace)."""
    file_path = WORKSPACE / path.lstrip("/")
    if not file_path.exists():
        return f"Plik nie istnieje: {file_path}"
    return file_path.read_text(encoding="utf-8", errors="replace")


@mcp.tool()
async def write_file(path: str, content: str) -> str:
    """Zapisuje zawartość do pliku w workspace projektu (/workspace)."""
    file_path = WORKSPACE / path.lstrip("/")
    file_path.parent.mkdir(parents=True, exist_ok=True)
    file_path.write_text(content, encoding="utf-8")
    return f"Zapisano: {file_path}"


@mcp.tool()
async def list_files(path: str = ".", recursive: bool = False) -> str:
    """Listuje pliki i katalogi w workspace (/workspace)."""
    base = WORKSPACE / path.lstrip("/")
    if not base.exists():
        return f"Katalog nie istnieje: {base}"
    if recursive:
        files = [
            str(p.relative_to(WORKSPACE))
            for p in base.rglob("*")
            if not any(
                part.startswith(".") or part in ("node_modules", "__pycache__", ".next")
                for part in p.parts
            )
        ]
    else:
        files = [p.name + ("/" if p.is_dir() else "") for p in sorted(base.iterdir())]
    return "\n".join(files)


@mcp.tool()
async def http_get(url: str, headers: str = "{}") -> str:
    """Wysyła GET request do URL w sieci writer-net (inne sidecar/MCP/API). headers jako JSON string."""
    parsed_headers = json.loads(headers)
    async with httpx.AsyncClient() as client:
        resp = await client.get(url, headers=parsed_headers, timeout=30.0)
    return f"status: {resp.status_code}\n{resp.text}"


@mcp.tool()
async def http_post(url: str, body: str = "{}", headers: str = "{}") -> str:
    """Wysyła POST request do URL w sieci writer-net. body i headers jako JSON string."""
    parsed_body = json.loads(body)
    parsed_headers = json.loads(headers)
    async with httpx.AsyncClient() as client:
        resp = await client.post(url, json=parsed_body, headers=parsed_headers, timeout=30.0)
    return f"status: {resp.status_code}\n{resp.text}"


# ─── ASGI app z health + MCP SSE ──────────────────────────────────────────────
async def health(request):
    return JSONResponse({"status": "ok", "service": "bashtool-mcp"})


app = Starlette(routes=[
    Route("/health", health),
    Mount("/", app=mcp.sse_app()),
])


async def main():
    config = uvicorn.Config(app, host="0.0.0.0", port=MCP_PORT, log_level="info")
    await uvicorn.Server(config).serve()


if __name__ == "__main__":
    asyncio.run(main())
