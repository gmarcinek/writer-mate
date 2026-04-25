# BashTool MCP sidecar
# MCP server wystawiający agentom:
#   - run_bash        — shell w izolowanym kontenerze
#   - convert_doc     — proxy do markitdown sidecar
#   - read_file       — odczyt z /workspace
#   - write_file      — zapis do /workspace
#   - list_files      — listing /workspace
#   - http_get/post   — requesty do sieci writer-net (inne MCP, API)

FROM python:3.12-slim

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
    git \
    jq \
    ripgrep \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

EXPOSE 8002

CMD ["python", "server.py"]
