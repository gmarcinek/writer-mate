"""
Markitdown sidecar — dwa serwery w jednym procesie:

Port 8000: FastAPI HTTP  →  /health, /convert
Port 8001: MCP SSE       →  tool: convert_to_markdown
"""
import asyncio
import os
import tempfile
from contextlib import asynccontextmanager
from typing import Any

import httpx
import uvicorn
from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.responses import JSONResponse
from markitdown import MarkItDown
from mcp.server import Server
from mcp.server.sse import SseServerTransport
from mcp.types import TextContent, Tool
from pydantic import BaseModel
from starlette.routing import Route

# ─── MarkItDown instance ───────────────────────────────────────────────────────
md = MarkItDown()

# ─── FastAPI HTTP app ──────────────────────────────────────────────────────────
http_app = FastAPI(title="Markitdown Sidecar", version="0.1.0")


class ConvertUrlRequest(BaseModel):
    url: str | None = None
    content: str | None = None  # raw text/html


@http_app.get("/health")
async def health():
    return {"status": "ok", "service": "markitdown"}


@http_app.post("/convert")
async def convert(req: ConvertUrlRequest):
    """Konwertuj URL lub raw content do Markdown."""
    try:
        if req.url:
            result = md.convert_url(req.url)
        elif req.content:
            with tempfile.NamedTemporaryFile(
                suffix=".html", mode="w", delete=False, encoding="utf-8"
            ) as f:
                f.write(req.content)
                tmp_path = f.name
            result = md.convert(tmp_path)
        else:
            raise HTTPException(status_code=400, detail="Podaj url lub content")
        return {"markdown": result.text_content}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@http_app.post("/convert/file")
async def convert_file(file: UploadFile = File(...)):
    """Konwertuj wgrany plik do Markdown."""
    suffix = os.path.splitext(file.filename or "")[1] or ".bin"
    with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as f:
        f.write(await file.read())
        tmp_path = f.name
    try:
        result = md.convert(tmp_path)
        return {"markdown": result.text_content, "filename": file.filename}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        os.unlink(tmp_path)


# ─── MCP Server ────────────────────────────────────────────────────────────────
mcp_server = Server("markitdown-mcp")


@mcp_server.list_tools()
async def list_tools() -> list[Tool]:
    return [
        Tool(
            name="convert_to_markdown",
            description=(
                "Konwertuje dokument (URL, plik PDF/DOCX/XLSX/PPTX/HTML/obraz/audio) "
                "do czystego Markdown. Podaj 'url' lub 'content' (raw HTML/tekst)."
            ),
            inputSchema={
                "type": "object",
                "properties": {
                    "url": {"type": "string", "description": "URL do skonwertowania"},
                    "content": {
                        "type": "string",
                        "description": "Surowy HTML lub tekst",
                    },
                },
            },
        )
    ]


@mcp_server.call_tool()
async def call_tool(name: str, arguments: dict[str, Any]) -> list[TextContent]:
    if name != "convert_to_markdown":
        raise ValueError(f"Nieznane narzędzie: {name}")

    async with httpx.AsyncClient() as client:
        resp = await client.post(
            "http://localhost:8000/convert",
            json=arguments,
            timeout=60.0,
        )
        resp.raise_for_status()
        data = resp.json()

    return [TextContent(type="text", text=data["markdown"])]


# ─── MCP SSE app (Starlette) ───────────────────────────────────────────────────
sse_transport = SseServerTransport("/messages/")


async def handle_sse(scope, receive, send):
    async with mcp_server.run_sse_async() as streams:
        await sse_transport.handle_sse(
            scope, receive, send, streams[0], streams[1]
        )


from starlette.applications import Starlette

mcp_app = Starlette(
    routes=[
        Route("/sse", endpoint=handle_sse),
        Route("/messages/", endpoint=sse_transport.handle_post_message, methods=["POST"]),
        Route("/health", endpoint=lambda req: JSONResponse({"status": "ok", "service": "markitdown-mcp"})),
    ]
)


# ─── Uruchomienie obu serwerów ─────────────────────────────────────────────────
async def main():
    config_http = uvicorn.Config(
        http_app,
        host=os.getenv("HOST", "0.0.0.0"),
        port=int(os.getenv("PORT", "8000")),
        log_level="info",
    )
    config_mcp = uvicorn.Config(
        mcp_app,
        host=os.getenv("HOST", "0.0.0.0"),
        port=8001,
        log_level="info",
    )
    server_http = uvicorn.Server(config_http)
    server_mcp = uvicorn.Server(config_mcp)
    await asyncio.gather(server_http.serve(), server_mcp.serve())


if __name__ == "__main__":
    asyncio.run(main())
