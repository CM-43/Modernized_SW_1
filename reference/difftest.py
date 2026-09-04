"""
difftest.py — the differential test for the Sea Wolf marking engine.

WHAT THIS IS FOR
----------------
There are two completely separate programs that work out the right answers
to this game:

  * js/marking.js   — the one the simulation actually uses, written for the
                      rebuild.
  * reference/derive.py — written earlier, separately, by a different model,
                      from the game's rules and the data files.

Neither one was written by looking at the other. This script feeds thousands
of randomly invented answer sets through both of them and compares every
answer they produce. If two programs written independently agree on five
thousand random games, it is very unlikely that they share a mistake.

Zero differences is the pass condition.

WHO NEEDS TO RUN THIS
---------------------
Not WK. This is a development check, run from a terminal by whoever is
building or verifying the simulation. WK's view of correctness is
`tests.html`, which opens in a browser and needs nothing installed.

HOW TO RUN IT
-------------
    python3 reference/difftest.py

It needs Python 3 and Node (only to execute marking.js outside a browser).
The simulation itself needs neither: it is plain files in a browser.

    python3 reference/difftest.py --runs 20000 --seed 7

WHERE THE TWO ENGINES ARE KNOWN TO DIFFER
-----------------------------------------
One place, and it cannot arise with this data. At Step 3, derive.py first
throws away any microbe carrying the undesired trait and then ranks what is
left; marking.js instead ranks all three with "carries the undesired trait"
as the first thing it sorts on. The two give the same answer whenever at
least one microbe in the set is clean, which is true of every set in every
Sea Wolf file. If a future data set ever had a set of three where all three
carried the undesired trait, derive.py would stop with an error and
marking.js would still pick one — which is what SW-BUILD-SPEC section 5.2
says must happen. The specification wins, so marking.js is right and this
note exists so nobody "fixes" it later.
"""

import argparse
import itertools
import json
import os
import random
import subprocess
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
DATA_DIR = os.path.join(ROOT, "data")
MARKING_JS = os.path.join(ROOT, "js", "marking.js")

sys.path.insert(0, HERE)
import derive  # noqa: E402  (Fable's independent engine)

# derive.py was written with the data files in a fixed place. Point it at
# this repository's data/ folder instead. We change the setting from the
# outside rather than editing derive.py, because derive.py must stay exactly
# as it was written for the comparison to mean anything.
derive.DATA = DATA_DIR

ATTR_SHORT = {"Rigidity": "R", "Mobility": "M", "Size": "S"}
TRAITS = ["Pressure Resistant", "Hydrophilic", "Aerobic", "Heat Resistant"]


# ----------------------------------------------------------------------
# Loading
# ----------------------------------------------------------------------

def load_data():
    with open(os.path.join(DATA_DIR, "sites.json"), encoding="utf-8") as f:
        sites_json = json.load(f)
    files = {}
    for name in os.listdir(DATA_DIR):
        if name == "sites.json" or not name.endswith(".json"):
            continue
        with open(os.path.join(DATA_DIR, name), encoding="utf-8") as f:
            files[name] = json.load(f)
    return sites_json, files


def rows_of(file_obj):
    if isinstance(file_obj, list):
        return file_obj
    if "Sheet1" in file_obj:
        return file_obj["Sheet1"]
    for value in file_obj.values():
        if isinstance(value, list):
            return value
    return []


# ----------------------------------------------------------------------
# Making up random games
# ----------------------------------------------------------------------

def random_range(rng, span):
    """A slider selection: `span` consecutive values somewhere in 1..10."""
    low = rng.randint(1, 10 - span + 1)
    return [low, low + span - 1]


def random_seconds(rng):
    """A timer reading. About one in eight is negative, i.e. after time."""
    if rng.random() < 0.125:
        return -rng.randint(0, 300)
    return rng.randint(1, 1800)


def random_answers(rng, sites_json, files):
    """Invent one complete (or deliberately incomplete) set of answers."""
    span = sites_json["sliderSpan"]
    answers = {"startedAt": "2026-09-04T00:00:00Z", "sites": {}}

    for index, site in enumerate(sites_json["sites"]):
        site_id = str(site["id"])
        is_last = index == len(sites_json["sites"]) - 1
        here = site.get("label") or ("Site " + str(site["id"]))
        forward = "Site " + str(site["id"] + 1)

        # Every so often a whole site is missing, as if time ran out.
        if rng.random() < 0.04:
            answers["sites"][site_id] = {}
            continue

        given = {}
        step2_rows = rows_of(files[site["step2File"]])
        step34_rows = rows_of(files[site["step34File"]])

        # ---- Step 1: switch on two of the seven characteristics ----
        if rng.random() > 0.05:
            attribute_names = list(site["ranges"].keys())
            choices = [{"trait": t} for t in TRAITS] + \
                      [{"attribute": a} for a in attribute_names]
            picked = rng.sample(choices, 2)
            items = []
            for choice in picked:
                if "trait" in choice:
                    items.append({"trait": choice["trait"]})
                else:
                    items.append({"attribute": choice["attribute"],
                                  "range": random_range(rng, span)})
            given["step1"] = {"items": items, "secondsLeft": random_seconds(rng)}

        # ---- Step 2: sort the ten microbes ----
        pushed_forward = []
        if rng.random() > 0.05:
            options = [here, "Return"] if is_last else [here, forward, "Return"]
            step2 = {}
            for row in step2_rows:
                # Occasionally leave one microbe unanswered.
                if rng.random() < 0.03:
                    continue
                choice = rng.choice(options)
                step2[row["Name"]] = {"choice": choice,
                                      "secondsLeft": random_seconds(rng)}
                if choice == forward:
                    pushed_forward.append(row["Name"])
            given["step2"] = step2

        # ---- Step 3: one microbe from each of the four sets ----
        picks = []
        if rng.random() > 0.05:
            step3 = []
            for set_name in ["Set 1", "Set 2", "Set 3", "Set 4"]:
                members = [r for r in step34_rows if r.get("Category") == set_name]
                # Occasionally the candidate runs out of time part-way.
                if rng.random() < 0.05:
                    break
                chosen = rng.choice(members)
                step3.append({"microbe": chosen["Name"],
                              "secondsLeft": random_seconds(rng)})
                picks.append(chosen["Name"])
            given["step3"] = step3

        # ---- Step 4: three from the resulting pool of ten ----
        existing = [r for r in step34_rows if r.get("Category") == "Existing"]
        pool = [r["Name"] for r in existing] + picks
        if len(pool) >= 3 and rng.random() > 0.05:
            given["step4"] = {"microbes": rng.sample(pool, 3),
                              "secondsLeft": random_seconds(rng)}

        # ---- Step 5: re-judge whatever was sent forward ----
        if pushed_forward and not is_last and rng.random() > 0.05:
            step5 = {}
            for name in pushed_forward:
                if rng.random() < 0.03:
                    continue
                step5[name] = {"choice": rng.choice([forward, "Return"]),
                               "secondsLeft": random_seconds(rng)}
            given["step5"] = step5

        answers["sites"][site_id] = given

    return answers


# ----------------------------------------------------------------------
# Running marking.js (the JavaScript engine) through Node
# ----------------------------------------------------------------------

RUNNER_JS = r"""
/* Written to a temporary file by difftest.py. Loads marking.js exactly as a
   browser would, marks every supplied answer set, and prints the results as
   JSON. Nothing here decides anything; it is only a way to call the engine
   from outside a browser. */
const fs = require("fs");
const MARKING = require(process.argv[2]);
const input = JSON.parse(fs.readFileSync(process.argv[3], "utf8"));
const out = input.answerSets.map(a => MARKING.markGame(input.sites, input.files, a));
fs.writeFileSync(process.argv[4], JSON.stringify(out));
"""


def run_marking_js(sites_json, files, answer_sets):
    with tempfile.TemporaryDirectory() as tmp:
        runner = os.path.join(tmp, "runner.js")
        payload = os.path.join(tmp, "in.json")
        result_path = os.path.join(tmp, "out.json")
        with open(runner, "w", encoding="utf-8") as f:
            f.write(RUNNER_JS)
        with open(payload, "w", encoding="utf-8") as f:
            json.dump({"sites": sites_json, "files": files,
                       "answerSets": answer_sets}, f)
        completed = subprocess.run(
            ["node", runner, MARKING_JS, payload, result_path],
            capture_output=True, text=True)
        if completed.returncode != 0:
            print("Node failed while running marking.js:")
            print(completed.stderr)
            sys.exit(2)
        with open(result_path, encoding="utf-8") as f:
            return json.load(f)


# ----------------------------------------------------------------------
# Working out the same answers with derive.py
# ----------------------------------------------------------------------

def derive_expectations(sites_json, files):
    """The parts that do not depend on the candidate: Step 2 and Step 3."""
    per_site = {}
    for site in sites_json["sites"]:
        site_id = site["id"]
        step2 = derive.step2(site_id)
        step3 = derive.step3(site_id)
        step3_expected = [set([top] + ties) for (top, ties) in step3]
        key_picks = [top for (top, _ties) in step3]
        best_overall, _combos, _scored = derive.step4(site_id, key_picks)
        per_site[site_id] = {
            "step2": step2,
            "step3": step3_expected,
            "bestOverall": best_overall,
        }
    return per_site


def derive_score(site_id, names, by_name):
    """Score one trio using derive.py's own scoring formula."""
    combo = [by_name[n] for n in names]
    return derive.score(combo, site_id)


def derive_best_for_pool(site_id, pool_names, by_name):
    """The best score reachable from an arbitrary pool, using derive.py's
    scoring. derive.step4 insists on a pool of exactly ten, so the
    enumeration is done here and only the scoring — the part that is a rule —
    comes from derive.py."""
    if len(pool_names) < 3:
        return None
    best = -1
    for combo in itertools.combinations(pool_names, 3):
        s = derive_score(site_id, combo, by_name)
        if s > best:
            best = s
    return best


# ----------------------------------------------------------------------
# The comparison
# ----------------------------------------------------------------------

def compare(sites_json, files, answers, marked, fixed):
    """Return a list of plain-English differences for one answer set."""
    problems = []

    for index, site in enumerate(sites_json["sites"]):
        site_id = site["id"]
        key = str(site_id)
        is_last = index == len(sites_json["sites"]) - 1
        here = site.get("label") or ("Site " + str(site_id))
        forward = "Site " + str(site_id + 1)
        given = answers["sites"].get(key, {})
        got = marked["sites"][key]

        step2_rows = rows_of(files[site["step2File"]])
        step34_rows = rows_of(files[site["step34File"]])
        by_name = {r["Name"]: dict(name=r["Name"], R=r["Rigidity"],
                                   M=r["Mobility"], S=r["Size"],
                                   trait=r["Trait"], cat=r.get("Category"))
                   for r in step34_rows}

        # ---- Step 2: expected destination and the correct/incorrect mark ----
        for item in got["step2"]["items"]:
            want = fixed[site_id]["step2"][item["microbe"]]
            if item["expected"] != want:
                problems.append(f"Site {site_id} Step 2 {item['microbe']}: "
                                f"marking.js expects {item['expected']!r}, "
                                f"derive.py expects {want!r}")
            given2 = given.get("step2", {}).get(item["microbe"])
            want_correct = bool(given2) and given2["choice"] == want
            if item["correct"] != want_correct:
                problems.append(f"Site {site_id} Step 2 {item['microbe']}: "
                                f"correct={item['correct']}, expected {want_correct}")

        # ---- Step 3: expected pick(s) and the mark ----
        for position, item in enumerate(got["step3"]["items"]):
            want_set = fixed[site_id]["step3"][position]
            if set(item["expected"]) != want_set:
                problems.append(f"Site {site_id} Step 3 {item['set']}: "
                                f"marking.js expects {sorted(item['expected'])}, "
                                f"derive.py expects {sorted(want_set)}")
            given3 = given.get("step3") or []
            chosen = given3[position]["microbe"] if position < len(given3) else None
            want_correct = chosen is not None and chosen in want_set
            if item["correct"] != want_correct:
                problems.append(f"Site {site_id} Step 3 {item['set']}: "
                                f"correct={item['correct']}, expected {want_correct}")

        # ---- Step 4: the score, and both "best possible" figures ----
        picks = [p["microbe"] for p in (given.get("step3") or [])]
        existing = [r["Name"] for r in step34_rows if r.get("Category") == "Existing"]
        candidate_pool = existing + [p for p in picks if p in by_name]

        want_best_pool = derive_best_for_pool(site_id, candidate_pool, by_name)
        if got["step4"]["bestForYourPool"] != want_best_pool:
            problems.append(f"Site {site_id} Step 4 bestForYourPool: "
                            f"marking.js {got['step4']['bestForYourPool']}, "
                            f"derive.py {want_best_pool}")

        if got["step4"]["bestOverall"] != fixed[site_id]["bestOverall"]:
            problems.append(f"Site {site_id} Step 4 bestOverall: "
                            f"marking.js {got['step4']['bestOverall']}, "
                            f"derive.py {fixed[site_id]['bestOverall']}")

        given4 = given.get("step4")
        if given4 and all(n in by_name for n in given4["microbes"]) \
                and len(given4["microbes"]) == 3:
            want_score = derive_score(site_id, given4["microbes"], by_name)
            if got["step4"]["score"] != want_score:
                problems.append(f"Site {site_id} Step 4 score: "
                                f"marking.js {got['step4']['score']}, "
                                f"derive.py {want_score} "
                                f"for {given4['microbes']}")
        elif got["step4"]["score"] != 0:
            problems.append(f"Site {site_id} Step 4 score: expected 0 for an "
                            f"unanswered or unscoreable submission, got "
                            f"{got['step4']['score']}")

        # ---- Step 5: expected destination and the mark ----
        pushed = [r["Name"] for r in step2_rows
                  if given.get("step2", {}).get(r["Name"], {}).get("choice") == forward]
        if is_last or not pushed:
            if got["step5"]["applicable"]:
                problems.append(f"Site {site_id} Step 5 should not apply "
                                f"(pushed={pushed}, last={is_last})")
        else:
            want5 = derive.step5(site_id, set(pushed))
            if not got["step5"]["applicable"]:
                problems.append(f"Site {site_id} Step 5 should apply for {pushed}")
            else:
                for item in got["step5"]["items"]:
                    want = want5[item["microbe"]]
                    if item["expected"] != want:
                        problems.append(f"Site {site_id} Step 5 {item['microbe']}: "
                                        f"marking.js expects {item['expected']!r}, "
                                        f"derive.py expects {want!r}")
                    given5 = given.get("step5", {}).get(item["microbe"])
                    want_correct = bool(given5) and given5["choice"] == want
                    if item["correct"] != want_correct:
                        problems.append(f"Site {site_id} Step 5 {item['microbe']}: "
                                        f"correct={item['correct']}, "
                                        f"expected {want_correct}")

    return problems


# ----------------------------------------------------------------------

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--runs", type=int, default=5000,
                        help="how many random answer sets to try (default 5000)")
    parser.add_argument("--seed", type=int, default=20260904,
                        help="random seed, so a run can be repeated exactly")
    args = parser.parse_args()

    sites_json, files = load_data()
    rng = random.Random(args.seed)

    print(f"Differential test: js/marking.js against reference/derive.py")
    print(f"  random answer sets : {args.runs}")
    print(f"  seed               : {args.seed}")
    print()

    fixed = derive_expectations(sites_json, files)

    print("  generating answer sets ...")
    answer_sets = [random_answers(rng, sites_json, files) for _ in range(args.runs)]

    print("  running marking.js through Node ...")
    marked_all = run_marking_js(sites_json, files, answer_sets)

    print("  comparing ...")
    differing = 0
    first_ten = []
    for i, (answers, marked) in enumerate(zip(answer_sets, marked_all)):
        problems = compare(sites_json, files, answers, marked, fixed)
        if problems:
            differing += 1
            if len(first_ten) < 10:
                first_ten.append((i, problems, answers))

    print()
    print(f"  answer sets compared : {args.runs}")
    print(f"  answer sets differing: {differing}")
    print()

    if differing == 0:
        print("RESULT: 0 differences. The two engines agree on every answer set.")
        return 0

    print("RESULT: FAILED. The first differing answer sets:")
    for index, problems, answers in first_ten:
        print(f"\n--- answer set #{index} ---")
        for p in problems:
            print("   " + p)
        print("   input: " + json.dumps(answers))
    return 1


if __name__ == "__main__":
    sys.exit(main())
