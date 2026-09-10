import asyncio, sys, os
from playwright.async_api import async_playwright
async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch()
        pg = await b.new_page()
        errs=[]
        pg.on("pageerror", lambda e: errs.append(str(e)))
        pg.on("console", lambda m: errs.append("console:"+m.type+":"+m.text) if m.type in ("error","warning") else None)
        await pg.goto(os.environ.get("BASE", "http://localhost:8765/") + "tests.html")
        await pg.wait_for_timeout(4000)
        txt = await pg.inner_text("body")
        print(txt[:600]); print(txt[txt.find("6. Where"):][:3000])
        print("...")
        # count pass/fail
        import re
        print("banner lines:", [l for l in txt.splitlines() if "PASSED" in l or "FAILED" in l][:5])
        print("errors:", errs)
        await b.close()
asyncio.run(main())
