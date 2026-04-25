# Markitdown sidecar
# Wystawia dwa endpointy:
#   HTTP  → POST /convert   { "url"|"content"|"file" }  →  { "markdown": "..." }
#   MCP   → GET  /sse       (Server-Sent Events, MCP protocol)

FROM python:3.12-slim

WORKDIR /app

# System deps dla markitdown (obsługa PDF, DOCX, audio)
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
    ffmpeg \
    libmagic1 \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

EXPOSE 8000 8001

CMD ["python", "server.py"]
