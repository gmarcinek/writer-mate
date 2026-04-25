"""
Markitdown sidecar — dwa serwery w jednym procesie:

Port 8000: FastAPI HTTP  →  /health, /convert
Port 8001: MCP SSE       →  tool: convert_to_markdown
"""
import asyncio
import os
import tempfile

import httpx
import uvicorn
from fastapi import FastAPI, File, HTTPException, UploadFile
from markitdown import MarkItDown
from mcp.server.fastmcp import FastMCP
from pydantic import BaseModel
from starlette.applications import Starlette
from starlette.responses import JSONResponse
from starlette.routing import Mount, Route

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


# ─── FastMCP Server ────────────────────────────────────────────────────────────
mcp = FastMCP("markitdown-mcp")


@mcp.tool()
async def convert_to_markdown(url: str = "", content: str = "") -> str:
    """Konwertuje dokument (URL, plik PDF/DOCX/XLSX/PPTX/HTML/obraz/audio) do czystego Markdown. Podaj url lub content (raw HTML/tekst)."""
    async with httpx.AsyncClient() as client:
        resp = await client.post(
            "http://localhost:8000/convert",
            json={"url": url, "content": content},
            timeout=60.0,
        )
        resp.raise_for_status()
    return resp.json()["markdown"]


# ─── Uruchomienie obu serwerów ─────────────────────────────────────────────────
async def mcp_health(request):
    return JSONResponse({"status": "ok", "service": "markitdown-mcp"})


mcp_app = Starlette(routes=[
    Route("/health", mcp_health),
    Mount("/", app=mcp.sse_app()),
])


async def main():
    http_server = uvicorn.Server(uvicorn.Config(http_app, host="0.0.0.0", port=8000, log_level="info"))
    mcp_server = uvicorn.Server(uvicorn.Config(mcp_app, host="0.0.0.0", port=8001, log_level="info"))
    await asyncio.gather(http_server.serve(), mcp_server.serve())


if __name__ == "__main__":
    asyncio.run(main())
