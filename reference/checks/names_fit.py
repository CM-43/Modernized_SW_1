"""Do all 84 microbe names fit, un-truncated, on every kind of card at this size?
usage: python3 names_fit.py WIDTH HEIGHT
Walks to Step 2 (compact cards), Steps 3&4 phase 3 (candidate cards, mini cards)
and phase 4 (slot cards), and for each card type tries every name in the data
files, measuring the name element's scrollWidth against its clientWidth.
"""
import asyncio, sys, json, glob, os
from playwright.async_api import async_playwright

W, H = int(sys.argv[1]), int(sys.argv[2])
BASE = os.environ.get("BASE", "http://localhost:8765/")
HERE = os.path.dirname(os.path.abspath(__file__))
names = set()
for f in glob.glob(os.path.join(HERE, "..", "..", "data", "site-*.json")):
    for r in json.load(open(f))["Sheet1"]:
        names.add(r["Name"])
names = sorted(names, key=lambda n: int(n.split()[1]))

MEASURE = """([selector, names]) => {
  const els = Array.from(document.querySelectorAll(selector));
  if (!els.length) return {error: 'no elements for ' + selector};
  const el = els[0];
  const original = el.textContent;
  const bad = [];
  let worst = 0;
  const range = document.createRange();
  for (const n of names) {
    el.textContent = n;
    /* Fractional widths on purpose. scrollWidth and clientWidth are whole
       numbers, and a name 87.4px wide in an 87.0px box reports 87 = 87 and
       looks fine while the browser is drawing an ellipsis. */
    range.selectNodeContents(el);
    const need = range.getBoundingClientRect().width;
    const have = el.getBoundingClientRect().width
      - parseFloat(getComputedStyle(el).paddingLeft) - parseFloat(getComputedStyle(el).paddingRight);
    const over = need - have;
    if (over > 0.01) { bad.push(n + ' (+' + over.toFixed(1) + 'px)'); worst = Math.max(worst, over); }
  }
  el.textContent = original;
  return {count: els.length, width: Math.round(el.getBoundingClientRect().width * 10) / 10, bad, worst: Math.round(worst * 10) / 10};
}"""

WRAP = """([selector, texts]) => {
  const el = document.querySelector(selector);
  if (!el) return {error: 'no elements for ' + selector};
  const original = el.textContent; const bad = [];
  const line = parseFloat(getComputedStyle(el).lineHeight) || parseFloat(getComputedStyle(el).fontSize) * 1.45;
  for (const t of texts) { el.textContent = t; const h = el.getBoundingClientRect().height; if (h > line * 1.5) bad.push(t + ' wraps (' + Math.round(h) + 'px tall)'); }
  el.textContent = original;
  return {count: 1, width: Math.round(el.getBoundingClientRect().width), bad, worst: 0};
}"""

async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch()
        ctx = await b.new_context(viewport={"width": W, "height": H})
        pg = await ctx.new_page()
        await pg.goto(BASE); await pg.wait_for_timeout(800)
        await pg.fill("#u", "CaseMentor9187"); await pg.fill("#p", "change-me-before-launch")
        await pg.click("#login-form button[type=submit]"); await pg.wait_for_timeout(400)
        await pg.click("[data-action=begin]"); await pg.wait_for_timeout(200)
        await pg.click('label.switch:has(input[data-char="Pressure Resistant"])')
        await pg.click('label.switch:has(input[data-char="Rigidity"])')
        await pg.click("[data-action=step1-continue]"); await pg.wait_for_timeout(200)
        results = {}
        # Step 2: big card name, then place three microbes and measure compact names
        results["step2 big card"] = await pg.evaluate(MEASURE, [".big-card .card-name", names])
        for i in range(3):
            await pg.click('label.choice:has(input[value="Site 1"])'); await pg.click("[data-action=step2-continue]")
        await pg.wait_for_timeout(150)
        results["step2 compact card"] = await pg.evaluate(MEASURE, [".compact-name-row .name", names])
        for i in range(7):
            await pg.click('label.choice:has(input[value="Return"])'); await pg.click("[data-action=step2-continue]")
        await pg.click("[data-action=step2-complete]"); await pg.wait_for_timeout(200)
        await pg.click("[data-action=step2done-continue]"); await pg.wait_for_timeout(200)
        results["step3 candidate card"] = await pg.evaluate(MEASURE, [".cand-card .card-name", names])
        results["step3 mini card"] = await pg.evaluate(MEASURE, [".mini-card .mini-name", names])
        results["step3 trait label (no wrapping)"] = await pg.evaluate(WRAP, [".cand-card .stat-row:last-child .label", ["Pressure Resistant", "Heat Resistant", "Hydrophilic", "Aerobic"]])
        for i in range(4):
            await pg.click("button[data-action=pick] >> nth=0"); await pg.wait_for_timeout(80)
        await pg.click("button[data-action=slot] >> nth=0"); await pg.wait_for_timeout(120)
        results["step4 slot card"] = await pg.evaluate(MEASURE, [".cand-card .card-name", names])
        results["step4 mini card (with button)"] = await pg.evaluate(MEASURE, [".mini-card:has(.round-btn) .mini-name", names])
        # site panel and results are not name-bearing; done
        await pg.screenshot(path=f"names-{W}.png")
        await b.close()
    allok = True
    for k, v in results.items():
        if "error" in v: print(f"{W}x{H}  {k}: ERROR {v['error']}"); allok = False; continue
        status = "OK" if not v["bad"] else f"TRUNCATED worst +{v['worst']}px: " + ", ".join(v["bad"][:6]) + (" …" if len(v["bad"]) > 6 else "")
        if v["bad"]: allok = False
        print(f"{W}x{H}  {k:34s} width {v['width']:6.1f}px  {status}")
    print("RESULT:", "all names fit" if allok else "SOME NAMES TRUNCATED")
asyncio.run(main())
