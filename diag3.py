import asyncio
from playwright.async_api import async_playwright

async def main():
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True, args=['--no-sandbox', '--disable-dev-shm-usage'])
        page = await browser.new_page(viewport={'width': 1280, 'height': 800})
        
        await page.goto('http://host.docker.internal:3000', wait_until='networkidle', timeout=20000)
        
        # Pobierz reguly z inline stylesheet (href=None)
        inline_rules = await page.evaluate('''() => {
            const sheets = Array.from(document.styleSheets);
            const inline = sheets.find(s => !s.href);
            if (!inline) return null;
            try {
                return Array.from(inline.cssRules).map(r => r.cssText.substring(0, 200));
            } catch(e) {
                return "Error: " + e.message;
            }
        }''')
        print(f'Inline stylesheet rules: {inline_rules}')
        
        # Sprawdz reguly z zewnetrznego CSS
        ext_rules = await page.evaluate('''() => {
            const sheets = Array.from(document.styleSheets);
            const ext = sheets.find(s => s.href);
            if (!ext) return null;
            try {
                return Array.from(ext.cssRules).map(r => ({
                    type: r.type,
                    text: r.cssText.substring(0, 300)
                }));
            } catch(e) {
                return "Error: " + e.message;
            }
        }''')
        print(f'External CSS rules ({len(ext_rules)} total):')
        for i, r in enumerate(ext_rules):
            print(f'  [{i}] type={r["type"]}: {r["text"][:150]}')
        
        await browser.close()

asyncio.run(main())
