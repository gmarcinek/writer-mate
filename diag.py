import asyncio
from playwright.async_api import async_playwright

async def main():
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True, args=['--no-sandbox', '--disable-dev-shm-usage'])
        page = await browser.new_page(viewport={'width': 1280, 'height': 800})
        
        errors = []
        page.on('console', lambda msg: errors.append(f'{msg.type}: {msg.text}') if msg.type == 'error' else None)
        
        await page.goto('http://host.docker.internal:3000', wait_until='networkidle', timeout=20000)
        
        style_count = await page.evaluate('document.styleSheets.length')
        body_bg = await page.evaluate('window.getComputedStyle(document.body).backgroundColor')
        data_theme = await page.evaluate('document.documentElement.dataset.theme')
        color_bg_var = await page.evaluate("getComputedStyle(document.documentElement).getPropertyValue('--color-background').trim()")
        
        print(f'Stylesheets count: {style_count}')
        print(f'Body background: {body_bg}')
        print(f'data-theme: {data_theme}')
        print(f'--color-background var: {color_bg_var}')
        print(f'Console errors: {errors}')
        
        await browser.close()

asyncio.run(main())
