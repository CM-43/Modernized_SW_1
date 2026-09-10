# Behaviour checks (for whoever verifies a build — not for WK)

`tests.html` proves the *marking*. These scripts prove the *screens*: they
drive the real page in a headless (invisible) Chromium browser. WK never
needs them; they exist so that a verifier can re-run what was checked,
instead of taking a chat's word for it (SW-Master-Doc D51).

They need Python 3 and the free `playwright` package with its Chromium
(`pip install playwright && playwright install chromium`). Nothing here is
loaded by the simulation.

## Start two tiny local web servers first

From the repository root (the folder with `index.html`):

```
python3 -m http.server 8765
```

and, in a second terminal, from *this* folder (`reference/checks`):

```
python3 -m http.server 8766
```

The second one serves `parent/with.html` and `parent/without.html`, two
pages on a *different* address that embed the simulation in an iframe — the
same cross-origin situation as a real lesson.

## The checks

| Script | What it proves | Pass looks like |
|---|---|---|
| `tests_page.py` | Opens `tests.html` and reads the banner. | `ALL TEST GROUPS PASSED`, `0 failed` (123 checks) |
| `play_through.py W H OUTDIR` | Plays the published answer key through every screen at window size W × H, screenshots each screen into OUTDIR, measures that nothing overflows, reads the results page, tests that opened site blocks stay open when "Show reasons" is pressed, and prints the results page to `OUTDIR/results.pdf`. | `TILES: 80% / 100% / 80%`, `Decisions correct: 53 of 53`, `MARKS ok 53 bad 0`, no `OVERFLOW` lines (the results page is allowed to scroll), `ERRORS: []` |
| `play_through.py W H OUTDIR wrong` | The same with a deliberately wrong run. | `40% / 60% / 80%`, `48 of 54`, six ✗ |
| `play_through.py W H OUTDIR fast` | Runs the clock 250× faster so "Time's up" is reached; late answers must be tagged and counted. | `Answers after time ran out` greater than 0 |
| `names_fit.py W H` | Tries all 84 microbe names on every kind of card and measures, with fractional widths, that none is cut to "Microbe …", and that no trait label wraps on the candidate cards. | `RESULT: all names fit` |
| `fullscreen.py` | Inside a cross-origin iframe *with* `allowfullscreen`: the button is drawn, works while the Welcome popup is open (before the clock starts), and "Timer paused" shows under the time. *Without* it: no button is drawn. | `button drawn: True … fullscreenElement: True` then `button drawn: False` |

Run the size-dependent ones at least at **1000 × 562** (the supported
minimum), **1402 × 789** (what the real lesson gives the iframe) and
**1920 × 1080**; faults have appeared at both ends that were invisible in the
middle. Then *look at the screenshots* — several faults passed every number
and were obvious in a picture.

## Two lessons built into these scripts

- A check that finds nothing to measure must fail, not pass. `names_fit.py`
  reports an error if a selector matches no element.
- Measure fractional widths. A name 87.4 px wide in a box 87.0 px wide is
  drawn with an ellipsis, but `scrollWidth` and `clientWidth` are whole
  numbers and report 87 = 87. The first version of `names_fit.py` passed
  while every name on screen was truncated.
