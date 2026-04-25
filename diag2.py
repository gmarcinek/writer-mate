import asyncio
from playwright.async_api import async_playwright
import base64

async def main():
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True, args=['--no-sandbox', '--disable-dev-shm-usage'])
        page = await browser.new_page(viewport={'width': 1280, 'height': 800})
        
        await page.goto('http://host.docker.internal:3000', wait_until='networkidle', timeout=20000)
        
        # URL strony po redirectach
        print(f'Final URL: {page.url}')
        
        # Wszystkie zaladowane stylesheets z URL
        sheets = await page.evaluate('''() => {
            return Array.from(document.styleSheets).map(s => ({
                href: s.href,
                rules: (() => { try { return s.cssRules.length; } catch(e) { return "BLOCKED: " + e.message; } })()
            }));
        }''')
        print(f'Stylesheets: {sheets}')
        
        # Sprawdz selektor root[data-theme]
        root_check = await page.evaluate('''() => {
            const html = document.documentElement;
            return {
                tagName: html.tagName,
                dataTheme: html.getAttribute("data-theme"),
                isRoot: html === document.querySelector(":root"),
            };
        }''')
        print(f'Root check: {root_check}')
        
        # Sprawdz kilka zmiennych CSS
        vars_check = await page.evaluate('''() => {
            const s = getComputedStyle(document.documentElement);
            return {
                colorBg: s.getPropertyValue("--color-background"),
                colorFg: s.getPropertyValue("--color-foreground"),
                fontSerif: s.getPropertyValue("--font-serif"),
                spaceBase: s.getPropertyValue("--space-4"),
            };
        }''')
        print(f'CSS vars: {vars_check}')
        
        # Screenshot
        screenshot = await page.screenshot(full_page=True)
        with open('/tmp/screenshot.png', 'wb') as f:
            f.write(screenshot)
        print('Screenshot saved to /tmp/screenshot.png')
        
        await browser.close()

asyncio.run(main())
