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
import os
import subprocess
from pathlib import Path
from typing import Any

import httpx
import uvicorn
from fastapi.responses import JSONResponse
from mcp.server import Server
from mcp.server.sse import SseServerTransport
from mcp.types import TextContent, Tool
from starlette.applications import Starlette
from starlette.routing import Route

WORKSPACE = Path("/workspace")
MARKITDOWN_URL = os.getenv("MARKITDOWN_URL", "http://markitdown:8000")
MCP_PORT = int(os.getenv("MCP_PORT", "8002"))

# ─── MCP Server ────────────────────────────────────────────────────────────────
mcp_server = Server("bashtool-mcp")


@mcp_server.list_tools()
async def list_tools() -> list[Tool]:
    return [
        Tool(
            name="run_bash",
            description=(
                "Uruchamia polecenie bash w kontenerze. "
                "Workspace projektu jest dostępny pod /workspace. "
                "Zwraca stdout, stderr i kod wyjścia."
            ),
            inputSchema={
                "type": "object",
                "required": ["command"],
                "properties": {
                    "command": {"type": "string", "description": "Polecenie bash"},
                    "cwd": {
                        "type": "string",
                        "description": "Katalog roboczy (domyślnie /workspace)",
                        "default": "/workspace",
                    },
                    "timeout": {
                        "type": "integer",
                        "description": "Timeout w sekundach (domyślnie 30)",
                        "default": 30,
                    },
                },
            },
        ),
        Tool(
            name="convert_doc",
            description="Konwertuje URL lub treść HTML/tekst do Markdown via markitdown sidecar.",
            inputSchema={
                "type": "object",
                "properties": {
                    "url": {"type": "string"},
                    "content": {"type": "string"},
                },
            },
        ),
        Tool(
            name="read_file",
            description="Odczytuje zawartość pliku z workspace projektu (/workspace).",
            inputSchema={
                "type": "object",
                "required": ["path"],
                "properties": {
                    "path": {
                        "type": "string",
                        "description": "Ścieżka względem /workspace",
                    }
                },
            },
        ),
        Tool(
            name="write_file",
            description="Zapisuje zawartość do pliku w workspace projektu (/workspace).",
            inputSchema={
                "type": "object",
                "required": ["path", "content"],
                "properties": {
                    "path": {"type": "string", "description": "Ścieżka względem /workspace"},
                    "content": {"type": "string", "description": "Zawartość pliku"},
                },
            },
        ),
        Tool(
            name="list_files",
            description="Listuje pliki i katalogi w workspace (/workspace).",
            inputSchema={
                "type": "object",
                "properties": {
                    "path": {
                        "type": "string",
                        "description": "Ścieżka względem /workspace (domyślnie '.')",
                        "default": ".",
                    },
                    "recursive": {
                        "type": "boolean",
                        "default": False,
                    },
                },
            },
        ),
        Tool(
            name="http_get",
            description="Wysyła GET request do URL w sieci writer-net (inne sidecar/MCP/API).",
            inputSchema={
                "type": "object",
                "required": ["url"],
                "properties": {
                    "url": {"type": "string"},
                    "headers": {"type": "object", "default": {}},
                },
            },
        ),
        Tool(
            name="http_post",
            description="Wysyła POST request do URL w sieci writer-net.",
            inputSchema={
                "type": "object",
                "required": ["url"],
                "properties": {
                    "url": {"type": "string"},
                    "body": {"type": "object", "default": {}},
                    "headers": {"type": "object", "default": {}},
                },
            },
        ),
    ]


@mcp_server.call_tool()
async def call_tool(name: str, arguments: dict[str, Any]) -> list[TextContent]:
    match name:

        case "run_bash":
            command = arguments["command"]
            cwd = arguments.get("cwd", "/workspace")
            timeout = arguments.get("timeout", 30)
            try:
                result = subprocess.run(
                    ["bash", "-c", command],
                    capture_output=True,
                    text=True,
                    timeout=timeout,
                    cwd=cwd,
                )
                output = (
                    f"exit_code: {result.returncode}\n"
                    f"stdout:\n{result.stdout}\n"
                    f"stderr:\n{result.stderr}"
                )
            except subprocess.TimeoutExpired:
                output = f"TIMEOUT po {timeout}s"
            except Exception as e:
                output = f"BŁĄD: {e}"
            return [TextContent(type="text", text=output)]

        case "convert_doc":
            async with httpx.AsyncClient() as client:
                resp = await client.post(
                    f"{MARKITDOWN_URL}/convert",
                    json=arguments,
                    timeout=60.0,
                )
                resp.raise_for_status()
            return [TextContent(type="text", text=resp.json()["markdown"])]

        case "read_file":
            file_path = WORKSPACE / arguments["path"].lstrip("/")
            if not file_path.exists():
                return [TextContent(type="text", text=f"Plik nie istnieje: {file_path}")]
            return [TextContent(type="text", text=file_path.read_text(encoding="utf-8", errors="replace"))]

        case "write_file":
            file_path = WORKSPACE / arguments["path"].lstrip("/")
            file_path.parent.mkdir(parents=True, exist_ok=True)
            file_path.write_text(arguments["content"], encoding="utf-8")
            return [TextContent(type="text", text=f"Zapisano: {file_path}")]

        case "list_files":
            base = WORKSPACE / arguments.get("path", ".").lstrip("/")
            recursive = arguments.get("recursive", False)
            if not base.exists():
                return [TextContent(type="text", text=f"Katalog nie istnieje: {base}")]
            if recursive:
                files = [str(p.relative_to(WORKSPACE)) for p in base.rglob("*") if not any(
                    part.startswith(".") or part in ("node_modules", "__pycache__", ".next")
                    for part in p.parts
                )]
            else:
                files = [p.name + ("/" if p.is_dir() else "") for p in sorted(base.iterdir())]
            return [TextContent(type="text", text="\n".join(files))]

        case "http_get":
            async with httpx.AsyncClient() as client:
                resp = await client.get(
                    arguments["url"],
                    headers=arguments.get("headers", {}),
                    timeout=30.0,
                )
            return [TextContent(type="text", text=f"status: {resp.status_code}\n{resp.text}")]

        case "http_post":
            async with httpx.AsyncClient() as client:
                resp = await client.post(
                    arguments["url"],
                    json=arguments.get("body", {}),
                    headers=arguments.get("headers", {}),
                    timeout=30.0,
                )
            return [TextContent(type="text", text=f"status: {resp.status_code}\n{resp.text}")]

        case _:
            raise ValueError(f"Nieznane narzędzie: {name}")


# ─── MCP SSE app ───────────────────────────────────────────────────────────────
sse_transport = SseServerTransport("/messages/")


async def handle_sse(scope, receive, send):
    async with mcp_server.run_sse_async() as streams:
        await sse_transport.handle_sse(scope, receive, send, streams[0], streams[1])


mcp_app = Starlette(
    routes=[
        Route("/sse", endpoint=handle_sse),
        Route(
            "/messages/",
            endpoint=sse_transport.handle_post_message,
            methods=["POST"],
        ),
        Route(
            "/health",
            endpoint=lambda req: JSONResponse({"status": "ok", "service": "bashtool-mcp"}),
        ),
    ]
)


async def main():
    config = uvicorn.Config(
        mcp_app,
        host="0.0.0.0",
        port=MCP_PORT,
        log_level="info",
    )
    server = uvicorn.Server(config)
    await server.serve()


if __name__ == "__main__":
    asyncio.run(main())
