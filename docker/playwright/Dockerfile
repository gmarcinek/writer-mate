# Playwright MCP sidecar
# MCP server wystawiaj�cy agentom sterowanie przegl�dark�:
#   - browser_navigate  � otwiera URL
#   - browser_click     � klika element (CSS selector)
#   - browser_fill      � wype�nia pole formularza
#   - browser_screenshot � robi screenshot � /workspace/screenshots/ + base64
#   - browser_get_text  � pobiera tekst ze strony lub elementu
#   - browser_get_url   � zwraca aktualny URL
#   - browser_close     � zamyka przegl�dark� / resetuje sesj�

FROM python:3.12-slim

WORKDIR /app

# System deps dla Chromium (headless)
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
    libnss3 \
    libnspr4 \
    libdbus-1-3 \
    libatk1.0-0 \
    libatk-bridge2.0-0 \
    libcups2 \
    libdrm2 \
    libxkbcommon0 \
    libxcomposite1 \
    libxdamage1 \
    libxfixes3 \
    libxrandr2 \
    libgbm1 \
    libasound2 \
    libx11-6 \
    libx11-xcb1 \
    libxcb1 \
    libxext6 \
    fonts-liberation \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Instalacja przegl�darki Chromium przez playwright
RUN playwright install chromium

COPY . .

EXPOSE 8003

CMD ["python", "server.py"]
