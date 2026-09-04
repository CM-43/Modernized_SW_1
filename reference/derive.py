"""
Independent re-derivation of the Sea Wolf (Simulation 1) rules.

Sources used (and ONLY these):
  - Solve guide 16th ed., pp.28-30 (scoring), pp.46-49 (strategy per step)
  - The six JSON data files in CM_SW_1-main
  - The site targets as printed in the simulation's own HTML
The answer key is used ONLY at the end, to compare.
"""
import json, itertools, os

DATA = "/mnt/user-data/uploads/CM_SW_1-main/CM_SW_1-main"

# Site targets, transcribed from the HTML right-hand box of each page
# (index.html / page5.html / page9.html for Step 1; page2/6/10 for Step 2).
SITES = {
    1: dict(R=(8, 10), M=(4, 6), S=(2, 4), desired="Pressure Resistant", undesired="Aerobic"),
    2: dict(R=(4, 6), M=(6, 8), S=(1, 2), desired="Aerobic", undesired="Hydrophilic"),
    3: dict(R=(2, 4), M=(8, 10), S=(6, 8), desired="Heat Resistant", undesired="Hydrophilic"),
}
# What the candidate can see of the NEXT site during Step 2 (from page2.html / page6.html)
NEXT_PEEK = {
    1: ("attr", "R", (4, 6)),            # page2.html:  "Site 2 / Attributes / Rigidity: 4-6"
    2: ("undesired", "Hydrophilic"),     # page6.html:  "Site 3 / Trait / Undesired: Hydrophilic"
}
ATTRS = ["R", "M", "S"]
KEYMAP = {"R": "Rigidity", "M": "Mobility", "S": "Size"}


def load(site, step):
    fn = f"site-{site}-step-{step}.json"
    with open(os.path.join(DATA, fn)) as f:
        rows = json.load(f)["Sheet1"]
    out = []
    for r in rows:
        out.append(dict(name=r["Name"], R=r["Rigidity"], M=r["Mobility"], S=r["Size"],
                        trait=r["Trait"], cat=r.get("Category")))
    return out


def in_range(v, rng):
    return rng[0] <= v <= rng[1]


def n_in_range(m, site):
    return sum(in_range(m[a], SITES[site][a]) for a in ATTRS)


def dist_out(m, site):
    """Total distance of out-of-range attributes from the nearest range edge."""
    d = 0
    for a in ATTRS:
        lo, hi = SITES[site][a]
        v = m[a]
        if v < lo:
            d += lo - v
        elif v > hi:
            d += v - hi
    return d


# ---------- Step 2 ----------
def step2(site):
    res = {}
    for m in load(site, 2):
        if m["trait"] != SITES[site]["undesired"] and n_in_range(m, site) >= 2:
            res[m["name"]] = f"Site {site}"
            continue
        peek = NEXT_PEEK.get(site)
        if peek is None:
            res[m["name"]] = "Return"
        elif peek[0] == "attr":
            res[m["name"]] = f"Site {site+1}" if in_range(m[peek[1]], peek[2]) else "Return"
        else:  # undesired trait of next site is what is visible
            res[m["name"]] = f"Site {site+1}" if m["trait"] != peek[1] else "Return"
    return res


# ---------- Step 3 ----------
def step3(site, verbose=False):
    rows = load(site, "3&4")
    picks = []
    for s in (1, 2, 3, 4):
        trio = [m for m in rows if m["cat"] == f"Set {s}"]
        cands = [m for m in trio if m["trait"] != SITES[site]["undesired"]]
        # rank: most in-range, then desired trait, then smallest out-of-range distance
        cands.sort(key=lambda m: (-n_in_range(m, site),
                                  0 if m["trait"] == SITES[site]["desired"] else 1,
                                  dist_out(m, site)))
        if verbose:
            print(f"  Set {s}:", [(m['name'], n_in_range(m, site), m['trait'], dist_out(m, site)) for m in cands])
        # detect true ties
        top = cands[0]
        ties = [m for m in cands[1:] if (n_in_range(m, site), m["trait"] == SITES[site]["desired"], dist_out(m, site))
                == (n_in_range(top, site), top["trait"] == SITES[site]["desired"], dist_out(top, site))]
        picks.append((top["name"], [t["name"] for t in ties]))
    return picks


# ---------- Step 4 scoring ----------
def score(combo, site):
    t = SITES[site]
    pen = 0
    for a in ATTRS:
        avg = sum(m[a] for m in combo) / 3
        if not (t[a][0] <= avg <= t[a][1]):
            pen += 20
    if any(m["trait"] == t["undesired"] for m in combo):
        pen += 20
    if not any(m["trait"] == t["desired"] for m in combo):
        pen += 20
    return 100 - pen


def step4(site, chosen4):
    rows = load(site, "3&4")
    existing = [m for m in rows if m["cat"] == "Existing"]
    pool = existing + [m for m in rows if m["name"] in chosen4]
    assert len(pool) == 10, len(pool)
    scored = {}
    for combo in itertools.combinations(pool, 3):
        scored[tuple(m["name"] for m in combo)] = score(combo, site)
    best = max(scored.values())
    best_combos = sorted([c for c, s in scored.items() if s == best])
    return best, best_combos, scored


# ---------- Step 5 ----------
def step5(site, pushed_names):
    """Re-judge microbes pushed to site+1 with full info about site+1."""
    nxt = site + 1
    res = {}
    for m in load(site, 2):
        if m["name"] in pushed_names:
            ok = m["trait"] != SITES[nxt]["undesired"] and n_in_range(m, nxt) >= 2
            res[m["name"]] = f"Site {nxt}" if ok else "Return"
    return res


if __name__ == "__main__":
    for site in (1, 2, 3):
        print(f"\n===== SITE {site} =====")
        s2 = step2(site)
        by = {}
        for k, v in s2.items():
            by.setdefault(v, []).append(k.replace("Microbe ", ""))
        print("Step 2:", by)
        print("Step 3 (with tie detection):")
        s3 = step3(site, verbose=True)
        print("  picks:", s3)
        chosen = [p[0] for p in s3]
        best, combos, scored = step4(site, chosen)
        print(f"Step 4: best achievable = {best}%  ({len(combos)} combinations)")
        for c in combos:
            print("   ", ", ".join(x.replace("Microbe ", "") for x in c))
        if site < 3:
            pushed = [k for k, v in s2.items() if v == f"Site {site+1}"]
            print("Step 5:", step5(site, pushed))
