"""Play the answer key (or a wrong run) through the Sea Wolf build headless.
usage: python3 play.py WIDTH HEIGHT OUTDIR [wrong] [iframe]
"""
import asyncio, sys, json, os
from playwright.async_api import async_playwright

W, H, OUT = int(sys.argv[1]), int(sys.argv[2]), sys.argv[3]
WRONG = "wrong" in sys.argv
IFRAME = "iframe" in sys.argv
os.makedirs(OUT, exist_ok=True)
BASE = os.environ.get("BASE", "http://localhost:8765/")

KEY = {
  1: dict(step1=("Pressure Resistant", "Rigidity", 8),
          step2={"Site 1": [7,79,11,51,98], "Site 2": [32,13], "Return": [92,41,53]},
          step3=[43,75,48,19], step4=[21,33,43],
          step5={"Site 2": [32], "Return": [13]}),
  2: dict(step1=("Aerobic", "Size", 1),
          step2={"Site 2": [91,30,4,58], "Site 3": [69,42,99], "Return": [2,10,72]},
          step3=[8,15,60,44], step4=[20,46,8],
          step5={"Site 3": [69], "Return": [42,99]}),
  3: dict(step1=("Heat Resistant", "Mobility", 8),
          step2={"Site 3": [96,80,89,39], "Return": [73,27,6,47,1,66]},
          step3=[84,37,70,86], step4=[36,97,34], step5=None),
}
# A deliberately wrong run: wrong Step 1 attribute on Site 1, three Step 2 microbes
# sent the wrong way on Site 1, a wrong Step 3 pick on Site 2 (set 1: pick a
# non-expected), Step 4 with undesired trait on Site 1, Step 5 wrong on site 1.
if WRONG:
    KEY[1]["step1"] = ("Pressure Resistant", "Mobility", 4)       # wrong attribute
    KEY[1]["step2"] = {"Site 1": [7,79,11,51,92], "Site 2": [32,13,98], "Return": [41,53]}
    KEY[1]["step4"] = [21, 9, 88]                                   # 9 carries Aerobic (undesired)
    KEY[1]["step5"] = {"Site 2": [32, 13, 98], "Return": []}        # 13 should be Return; 98 depends
    KEY[2]["step3"] = [25,15,60,44]; KEY[2]["step4"] = [20,46,25]   # wrong Set 1 pick (25 not 8); trio without desired trait? 46 is Aerobic so has desired; 25 avg shifts
    KEY[3]["step4"] = [36, 84, 37]

log = []
def note(s):
    log.append(s); print(s)

async def shot(pg, name):
    await pg.wait_for_timeout(250)
    await pg.screenshot(path=f"{OUT}/{name}.png")
    # overflow measurement on the game frame
    m = await pg.evaluate("""() => {
      const d = document.documentElement;
      const mb = document.querySelector('.main-box');
      const st = document.querySelector('.stage');
      return {doc:[d.scrollWidth,d.clientWidth,d.scrollHeight,d.clientHeight],
              body:[document.body.scrollWidth, document.body.clientWidth, document.body.scrollHeight, document.body.clientHeight],
              mainbox: mb ? [mb.scrollWidth, mb.clientWidth, mb.scrollHeight, mb.clientHeight] : null,
              stage: st ? [st.scrollWidth, st.clientWidth, st.scrollHeight, st.clientHeight] : null,
              phaseText: document.getElementById('timer-text') ? document.getElementById('timer-text').textContent : null};
    }""")
    flag = ""
    if m["doc"][0] > m["doc"][1] or m["doc"][2] > m["doc"][3]: flag += " DOC-OVERFLOW"
    if m["mainbox"] and (m["mainbox"][0] > m["mainbox"][1]+1 or m["mainbox"][2] > m["mainbox"][3]+1): flag += " MAINBOX-OVERFLOW"
    note(f"[{name}] doc={m['doc']} mainbox={m['mainbox']} timer={m['phaseText']}{flag}")

async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch()
        ctx = await b.new_context(viewport={"width": W, "height": H})
        page = await ctx.new_page()
        if "fast" in sys.argv:
            await page.add_init_script("(() => { const o = window.setInterval; window.setInterval = (fn, ms) => o(fn, ms === 1000 ? 4 : ms); })()")
        errs = []
        page.on("pageerror", lambda e: errs.append(str(e)))
        page.on("console", lambda m: errs.append(m.type+": "+m.text) if m.type in ("error","warning") else None)
        if IFRAME:
            await page.set_content(f'<body style="margin:0"><iframe id="f" src="{BASE}" allowfullscreen allow="fullscreen" style="width:{W}px;height:{H}px;border:0;display:block"></iframe></body>')
            await page.wait_for_timeout(1500)
            pg = page.frame(name=None, url=BASE) or page.frames[1]
            # measurements below use pg.evaluate on the frame's document
        else:
            await page.goto(BASE)
            pg = page
        await page.wait_for_timeout(1200)
        await shot(page if not IFRAME else page, "00-login")
        await pg.fill("#u", "CaseMentor9187")
        await pg.fill("#p", "change-me-before-launch")
        await pg.click("#login-form button[type=submit]")
        await page.wait_for_timeout(600)
        await shot(page, "01-welcome-site1")

        for sid in (1, 2, 3):
            k = KEY[sid]
            await pg.click("[data-action=begin]")
            await page.wait_for_timeout(300)
            # Step 5 first (sites 2 and 3)
            if sid > 1 and KEY[sid-1]["step5"]:
                await shot(page, f"s{sid}-step5-start")
                # loop through pushed microbes
                while True:
                    cnt = await pg.evaluate("() => document.querySelectorAll('.big-card').length")
                    if cnt == 0: break
                    name = await pg.inner_text(".big-card .card-name")
                    num = int(name.replace("Microbe ", ""))
                    s5 = KEY[sid-1]["step5"]
                    choice = None
                    for dest, lst in s5.items():
                        if num in lst: choice = dest
                    if choice is None: choice = "Return"
                    await pg.click(f'label.choice:has(input[value="{choice}"])')
                    await page.wait_for_timeout(120)
                    await pg.click("[data-action=step5-continue]")
                    await page.wait_for_timeout(120)
                await shot(page, f"s{sid}-step5-done")
                await pg.click("[data-action=step5-complete]")
                await page.wait_for_timeout(300)
            # Step 1
            await shot(page, f"s{sid}-step1-start")
            trait, attr, lo = k["step1"]
            await pg.click(f'label.switch:has(input[data-char="{trait}"])')
            await page.wait_for_timeout(100)
            await pg.click(f'label.switch:has(input[data-char="{attr}"])')
            await page.wait_for_timeout(100)
            await pg.evaluate("""([attr, lo]) => {
              const el = document.querySelector(`input[data-handle="from"][data-attr="${attr}"]`);
              el.value = lo; el.dispatchEvent(new Event('input', {bubbles:true}));
            }""", [attr, lo])
            await page.wait_for_timeout(150)
            await shot(page, f"s{sid}-step1-chosen")
            await pg.click("[data-action=step1-continue]")
            await page.wait_for_timeout(300)
            # Step 2
            await shot(page, f"s{sid}-step2-start")
            for i in range(10):
                name = await pg.inner_text(".big-card .card-name")
                num = int(name.replace("Microbe ", ""))
                choice = None
                for dest, lst in k["step2"].items():
                    if num in lst: choice = dest
                assert choice, f"no plan for {name} at site {sid}"
                await pg.click(f'label.choice:has(input[value="{choice}"])')
                await page.wait_for_timeout(80)
                await pg.click("[data-action=step2-continue]")
                await page.wait_for_timeout(80)
                if i == 4: await shot(page, f"s{sid}-step2-mid")
            await shot(page, f"s{sid}-step2-done")
            await pg.click("[data-action=step2-complete]")
            await page.wait_for_timeout(300)
            await shot(page, f"s{sid}-step2-popup")
            await pg.click("[data-action=step2done-continue]")
            await page.wait_for_timeout(300)
            # Step 3
            await shot(page, f"s{sid}-step3-start")
            for r in range(4):
                if k["step3"] is None:
                    await pg.click("button[data-action=pick] >> nth=0")
                else:
                    await pg.click(f'button[data-action=pick][data-name="Microbe {k["step3"][r]}"]')
                await page.wait_for_timeout(120)
            await shot(page, f"s{sid}-step4-start")
            for n in k["step4"]:
                await pg.click(f'button[data-action=slot][data-name="Microbe {n}"]')
                await page.wait_for_timeout(100)
            await shot(page, f"s{sid}-step4-filled")
            await pg.click("[data-action=step34-submit]")
            await page.wait_for_timeout(300)
            await shot(page, f"s{sid}-sitedone-popup")
            await pg.click("[data-action=sitedone-continue]")
            await page.wait_for_timeout(400)
            if sid < 3:
                await shot(page, f"s{sid+1}-welcome")

        # Results
        await page.wait_for_timeout(500)
        await shot(page, "results-top")
        await page.screenshot(path=f"{OUT}/results-full.png", full_page=True)
        txt = await pg.inner_text(".results")
        tiles = await pg.evaluate("() => Array.from(document.querySelectorAll('.tile')).map(t => t.innerText.replace(/\\n/g,' | '))")
        summary = await pg.inner_text(".summary-line")
        note("TILES: " + json.dumps(tiles))
        note("SUMMARY: " + summary)
        marks = await pg.evaluate("() => ({ok: document.querySelectorAll('td.c-mark.ok').length, bad: document.querySelectorAll('td.c-mark.bad').length})")
        note("MARKS: " + json.dumps(marks))
        # dump result object via CSV build? Not exposed. Save results text.
        open(f"{OUT}/results.txt", "w").write(txt)
        # Known bug 3: open all details then press reveal
        arrival = await pg.evaluate("() => Array.from(document.querySelectorAll('details.site-block')).map(d=>d.open)")
        note(f"ARRIVAL open={arrival}")
        await pg.click("details.site-block[data-site='2'] > summary, details.site-block:nth-of-type(2) > summary")
        await pg.click("details.site-block[data-site='3'] > summary, details.site-block:nth-of-type(3) > summary")
        await page.wait_for_timeout(200)
        before = await pg.evaluate("() => Array.from(document.querySelectorAll('details.site-block')).map(d=>d.open)")
        await pg.click("button.reveal[data-site='2']")
        await page.wait_for_timeout(200)
        after = await pg.evaluate("() => Array.from(document.querySelectorAll('details.site-block')).map(d=>d.open)")
        note(f"REVEAL-BUG: open before={before} after={after}")
        await pg.click("button.reveal[data-site='1']"); await page.wait_for_timeout(200)
        after2 = await pg.evaluate("() => Array.from(document.querySelectorAll('details.site-block')).map(d=>d.open)")
        note(f"REVEAL-BUG second press (site 1): after={after2}")
        # close site 1 by clicking, then reveal again
        await pg.click("details.site-block:nth-of-type(1) > summary"); await page.wait_for_timeout(100)
        await pg.click("button.reveal[data-site='3']"); await page.wait_for_timeout(200)
        after3 = await pg.evaluate("() => Array.from(document.querySelectorAll('details.site-block')).map(d=>d.open)")
        note(f"REVEAL-BUG after closing site 1 and pressing reveal on 3: {after3} (expect [False, True, True])")
        # print view
        try:
            async with page.expect_download() as dl:
                await pg.click("[data-action=csv]")
            d = await dl.value; path = f"{OUT}/answers.csv"; await d.save_as(path); note("CSV-NAME: " + d.suggested_filename)
            lines = open(path, encoding="utf-8-sig").read().splitlines()
            note("CSV-TAIL: " + " | ".join(lines[-3:]) + f"  ({len(lines)} lines)")
        except Exception as e:
            note("CSV failed: " + str(e))
        try:
            await page.pdf(path=f"{OUT}/results.pdf", print_background=True)
            note("PDF written")
        except Exception as e:
            note("PDF failed: " + str(e))
        await page.emulate_media(media="print")
        await page.screenshot(path=f"{OUT}/results-print.png", full_page=True)
        await page.emulate_media(media="screen")
        note("ERRORS: " + json.dumps(errs))
        await b.close()
    open(f"{OUT}/log.txt", "w").write("\n".join(log))

asyncio.run(main())
