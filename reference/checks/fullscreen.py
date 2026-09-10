import asyncio
from playwright.async_api import async_playwright
async def run(kind):
    async with async_playwright() as p:
        b = await p.chromium.launch(); ctx = await b.new_context(viewport={"width":1200,"height":700}); page = await ctx.new_page()
        await page.goto(f"http://localhost:8766/parent/{kind}.html"); await page.wait_for_timeout(1200)
        fr = page.frames[1]
        await fr.fill("#u","CaseMentor9187"); await fr.fill("#p","change-me-before-launch"); await fr.click("#login-form button[type=submit]"); await fr.wait_for_timeout(400)
        # welcome popup is showing; is the header clickable?
        has = await fr.evaluate("() => !!document.querySelector('.btn-fullscreen')")
        popup = await fr.evaluate("() => !!document.querySelector('.modal-backdrop')")
        paused = await fr.evaluate("() => ({text: document.getElementById('timer-text').textContent, pausedVisible: getComputedStyle(document.getElementById('timer-paused')).visibility})")
        print(kind, "| button drawn:", has, "| welcome popup open:", popup, "| timer:", paused)
        if has:
            await fr.click(".btn-fullscreen", timeout=5000)  # while the popup is still open
            await fr.wait_for_timeout(500)
            print(kind, "| clicked during popup → fullscreenElement:", await fr.evaluate("() => !!document.fullscreenElement"),
                  "| button now:", await fr.evaluate("() => document.querySelector('.btn-fullscreen').textContent"),
                  "| popup still open:", await fr.evaluate("() => !!document.querySelector('.modal-backdrop')"))
            await page.keyboard.press("Escape"); await fr.wait_for_timeout(400)
            print(kind, "| after Escape → fullscreenElement:", await fr.evaluate("() => !!document.fullscreenElement"),
                  "| button now:", await fr.evaluate("() => document.querySelector('.btn-fullscreen').textContent"))
        await fr.click("[data-action=begin]"); await fr.wait_for_timeout(300)
        print(kind, "| after Begin timer:", await fr.evaluate("() => ({text: document.getElementById('timer-text').textContent, pausedVisible: getComputedStyle(document.getElementById('timer-paused')).visibility})"))
        await page.screenshot(path=f"fs2-{kind}.png")
        await b.close()
asyncio.run(run("with")); asyncio.run(run("without"))
