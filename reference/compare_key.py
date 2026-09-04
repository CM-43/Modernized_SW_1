"""Exact comparison of derive.py output against SW 1 - Answer Key.docx (transcribed)."""
from derive import *

KEY = {
    1: dict(
        step2={"Site 1": {7, 79, 11, 51, 98}, "Site 2": {32, 13}, "Return": {92, 41, 53}},
        step3=[43, 75, 48, 19],
        step4_best=80,
        step4={(21,33,81),(21,33,43),(21,33,19),(21,88,43),(21,88,19),(21,43,75),(21,43,48),(21,43,19),
               (21,48,19),(33,9,43),(33,81,19),(33,88,43),(33,88,75),(33,88,48),(33,88,19),(33,43,75),
               (33,43,48),(33,43,19),(33,75,19),(9,43,75),(88,43,19),(43,48,19)},
        step5={"Site 2": {32}, "Return": {13}},
    ),
    2: dict(
        step2={"Site 2": {91, 30, 4, 58}, "Site 3": {69, 42, 99}, "Return": {2, 10, 72}},
        step3=[8, 15, 60, 44],
        step4_best=100,
        step4={(20,46,8),(20,8,15),(20,8,44),(46,16,8),(16,8,15)},
        step5={"Site 3": {69}, "Return": {42, 99}},
    ),
    3: dict(
        step2={"Site 3": {96, 80, 89, 39}, "Return": {73, 27, 6, 47, 1, 66}},
        step3=[84, 37, 70, 86],
        step4_best=80,
        step4={(36,97,34),(36,84,37),(36,84,70),(36,84,86),(36,37,70),(36,37,86),(36,70,86),(37,70,86)},
        step5=None,
    ),
}

def num(name):
    return int(name.replace("Microbe ", ""))

all_ok = True
for site in (1, 2, 3):
    k = KEY[site]
    s2 = step2(site)
    mine2 = {}
    for n, v in s2.items():
        mine2.setdefault(v, set()).add(num(n))
    ok2 = mine2 == k["step2"]
    s3 = [num(p[0]) for p in step3(site)]
    ok3 = s3 == k["step3"]
    best, combos, _ = step4(site, [f"Microbe {n}" for n in s3])
    mine4 = {frozenset(num(x) for x in c) for c in combos}
    key4 = {frozenset(c) for c in k["step4"]}
    ok4 = (best == k["step4_best"]) and (mine4 == key4)
    if site < 3:
        pushed = [n for n, v in s2.items() if v == f"Site {site+1}"]
        s5 = step5(site, pushed)
        mine5 = {}
        for n, v in s5.items():
            mine5.setdefault(v, set()).add(num(n))
        ok5 = mine5 == k["step5"]
    else:
        ok5 = True
    print(f"Site {site}: step2={'MATCH' if ok2 else 'DIFF'} step3={'MATCH' if ok3 else 'DIFF'} "
          f"step4={'MATCH' if ok4 else 'DIFF'} ({best}%, {len(combos)} combos; key {k['step4_best']}%, {len(key4)}) "
          f"step5={'MATCH' if ok5 else 'DIFF'}")
    if not ok4:
        print("   only in mine:", sorted(sorted(c) for c in mine4 - key4))
        print("   only in key :", sorted(sorted(c) for c in key4 - mine4))
    all_ok &= ok2 and ok3 and ok4 and ok5

print("\nALL ANSWERS MATCHED" if all_ok else "\nMISMATCHES FOUND")

# ---- Extra probes the plan should know about ----
print("\n--- Probe A: does Step 4's best score depend on which 4 microbes were picked at Step 3? ---")
for site in (1, 2, 3):
    rows = load(site, "3&4")
    sets = [[m["name"] for m in rows if m["cat"] == f"Set {s}"] for s in (1, 2, 3, 4)]
    results = {}
    for choice in itertools.product(*sets):
        best, combos, _ = step4(site, list(choice))
        results.setdefault(best, 0)
        results[best] += 1
    print(f"Site {site}: over all 81 possible Step-3 choices, best achievable Step-4 score distribution = {results}")

print("\n--- Probe B: would a *different* Step-2 choice change what Step 5 asks? ---")
print("Step 5 only shows the microbes the candidate actually pushed forward at Step 2 (page4.js reads 'site2Microbes').")
print("So the set of Step-5 questions is candidate-dependent; the key's Step-5 answers assume the key's Step-2 answer.")

print("\n--- Probe C: Site 3 target as printed on the FINAL-submission screen page11.html vs everywhere else ---")
print("page9/10/8 say Rigidity 2-4, Mobility 8-10, Size 6-8.  page11.html says Rigidity 6-8, Mobility 8-10, Size 8-10.")
SITES_ALT = dict(R=(6, 8), M=(8, 10), S=(8, 10), desired="Heat Resistant", undesired="Hydrophilic")
rows = load(3, "3&4")
pool = [m for m in rows if m["cat"] == "Existing"] + [m for m in rows if m["name"] in ("Microbe 84","Microbe 37","Microbe 70","Microbe 86")]
def score_alt(combo):
    pen = 0
    for a in ATTRS:
        avg = sum(m[a] for m in combo)/3
        if not (SITES_ALT[a][0] <= avg <= SITES_ALT[a][1]): pen += 20
    if any(m["trait"] == SITES_ALT["undesired"] for m in combo): pen += 20
    if not any(m["trait"] == SITES_ALT["desired"] for m in combo): pen += 20
    return 100 - pen
sc = {tuple(num(m["name"]) for m in c): score_alt(c) for c in itertools.combinations(pool, 3)}
b = max(sc.values())
print(f"If a candidate trusted page11's numbers, best = {b}% with combos {[c for c,s in sc.items() if s==b]}")
