/* ==========================================================================
   marking.js — the rules engine for the Sea Wolf simulation
   ==========================================================================

   WHAT THIS FILE IS FOR
   ---------------------
   This file is the ONLY place in the whole simulation where a rule of the
   game lives. Everything that decides "what is the right answer" or "what
   score does this deserve" is written here and nowhere else.

   `app.js` (the part that draws the screens) is not allowed to work out an
   average, count how many attributes are in range, or calculate a score. It
   must call one of the functions below and use the answer. That rule exists
   so that when the rules of the game change, there is exactly one file to
   edit and one file to re-test.

   WHAT THIS FILE MUST NEVER DO
   ----------------------------
   No screens, no buttons, no timers, no loading of files, no browser
   storage. Every function here takes plain data in and gives plain data
   back. That is what makes it testable: `tests.html` can call these
   functions thousands of times without a screen existing.

   HOW IT IS LOADED
   ----------------
   In the browser it is a plain <script> tag and it creates one global name,
   `MARKING`. Under Node (used only by the differential test in
   `reference/difftest.py`, never by the product) it also exports itself the
   Node way. There is no build step and no import syntax.

   THE VOCABULARY, IN PLAIN ENGLISH
   --------------------------------
   attribute   Rigidity, Mobility or Size. A whole number from 1 to 10.
   trait       One of four labels. A microbe has exactly one.
   range       A site's target for one attribute, e.g. [8, 10], inclusive.
   hits        How many of a microbe's three attributes fall inside the
               site's ranges. A number from 0 to 3.
   desired     The trait this site wants.
   undesired   The trait this site does not want.
   pool        The ten microbes a candidate may choose their final three
               from: the six "Existing" ones plus the four they picked at
               Step 3.
   ========================================================================== */

var MARKING = (function () {
  "use strict";

  /* The four trait names, spelled exactly as they appear in the data files.
     This is the one list of names that has to be hard-coded, because
     `validateData` needs something to check the data files against. It is
     not a site-specific fact — every Sea Wolf data set uses these four. */
  var TRAIT_NAMES = [
    "Pressure Resistant",
    "Hydrophilic",
    "Aerobic",
    "Heat Resistant"
  ];

  /* The five category labels a row in a Step 3&4 file may carry. */
  var EXISTING = "Existing";
  var SET_NAMES = ["Set 1", "Set 2", "Set 3", "Set 4"];

  /* ------------------------------------------------------------------
     Small helpers for reading the data files.

     These exist so that a harmless difference in how a file was produced
     (a lower-case key, a bare array instead of {"Sheet1": [...]}) does not
     stop the whole simulation. They are deliberately forgiving on SHAPE
     and completely strict on VALUES — `validateData` does the strictness.
     ------------------------------------------------------------------ */

  /* A microbe file looks like {"Sheet1": [ {...}, {...} ]}. WK produces
     these from Excel with an online converter, which is why the rows are
     wrapped in a sheet name. Accept a bare array too, and accept a sheet
     called something other than "Sheet1", so a re-export with a renamed
     tab does not break anything. */
  function rowsOf(file) {
    if (!file) return [];
    if (Array.isArray(file)) return file;
    if (Array.isArray(file.Sheet1)) return file.Sheet1;
    for (var key in file) {
      if (Object.prototype.hasOwnProperty.call(file, key) && Array.isArray(file[key])) {
        return file[key];
      }
    }
    return [];
  }

  /* The name of a microbe, e.g. "Microbe 32". */
  function mName(m) {
    if (!m) return null;
    return m.Name !== undefined ? m.Name : m.name;
  }

  /* The trait of a microbe, e.g. "Aerobic". */
  function mTrait(m) {
    if (!m) return null;
    return m.Trait !== undefined ? m.Trait : m.trait;
  }

  /* The category of a row in a Step 3&4 file: "Existing" or "Set 1".."Set 4". */
  function mCategory(m) {
    if (!m) return null;
    return m.Category !== undefined ? m.Category : m.category;
  }

  /* The value of one attribute of a microbe, e.g. attrOf(m, "Rigidity"). */
  function attrOf(m, attribute) {
    if (!m) return undefined;
    if (m[attribute] !== undefined) return m[attribute];
    /* Tolerate a lower-case column heading. */
    var lower = attribute.toLowerCase();
    return m[lower];
  }

  /* The three attribute names this site defines ranges for. Read from the
     data, never hard-coded, so that a future simulation could in principle
     use different attribute names without touching this file. */
  function attributeNames(site) {
    var names = [];
    for (var key in site.ranges) {
      if (Object.prototype.hasOwnProperty.call(site.ranges, key)) names.push(key);
    }
    return names;
  }

  /* The label a site is known by on screen and in the recorded answers,
     e.g. "Site 2". Taken from the data if the data supplies one, otherwise
     built from the site's id. */
  function siteLabel(site) {
    if (!site) return null;
    if (site.label) return site.label;
    if (site.name) return site.name;
    return "Site " + site.id;
  }

  /* The label of the site AFTER this one, e.g. "Site 3" when standing on
     Site 2. Used for the "send it forward" choice at Step 2. */
  function nextSiteLabel(site) {
    return "Site " + (Number(site.id) + 1);
  }

  /* The word recorded when a microbe is sent back rather than kept. */
  var RETURN = "Return";

  /* `data/sites.json` may reasonably be written either as an object with a
     "sites" list inside it, or as a bare list of sites. Accept both, and
     always hand the rest of this file the same tidy shape back. The
     game-wide settings (`timeLimitMinutes`, `sliderSpan`) sit at the top
     level of that file. */
  function asGame(sitesJson) {
    if (!sitesJson) return { timeLimitMinutes: null, sliderSpan: null, sites: [] };
    if (Array.isArray(sitesJson)) {
      return { timeLimitMinutes: null, sliderSpan: null, sites: sitesJson };
    }
    return {
      timeLimitMinutes: sitesJson.timeLimitMinutes,
      sliderSpan: sitesJson.sliderSpan,
      sites: Array.isArray(sitesJson.sites) ? sitesJson.sites : []
    };
  }

  /* ------------------------------------------------------------------
     The four measurements every rule is built from.
     ------------------------------------------------------------------ */

  /* Is a value inside a range? Ranges are inclusive at both ends, so
     inRange(8, [8,10]) and inRange(10, [8,10]) are both true. */
  function inRange(value, range) {
    return value >= range[0] && value <= range[1];
  }

  /* How many of this microbe's three attributes fall inside this site's
     ranges. A number from 0 to 3. */
  function hits(m, site) {
    var names = attributeNames(site);
    var count = 0;
    for (var i = 0; i < names.length; i++) {
      if (inRange(attrOf(m, names[i]), site.ranges[names[i]])) count++;
    }
    return count;
  }

  /* Which attributes are inside the ranges, by name. Used only to write
     the plain-English reason shown on the results screen. */
  function hitNames(m, site) {
    var names = attributeNames(site);
    var found = [];
    for (var i = 0; i < names.length; i++) {
      if (inRange(attrOf(m, names[i]), site.ranges[names[i]])) found.push(names[i]);
    }
    return found;
  }

  /* How far outside the ranges this microbe sits, added up across all three
     attributes. An attribute inside its range contributes nothing; one
     outside contributes the distance to the nearer edge of the range.
     Used only as the last tie-break at Step 3. */
  function outDistance(m, site) {
    var names = attributeNames(site);
    var total = 0;
    for (var i = 0; i < names.length; i++) {
      var range = site.ranges[names[i]];
      var value = attrOf(m, names[i]);
      if (value < range[0]) total += range[0] - value;
      else if (value > range[1]) total += value - range[1];
    }
    return total;
  }

  /* ------------------------------------------------------------------
     Formatting helpers used only to build the plain-English reasons.
     ------------------------------------------------------------------ */

  /* "8–10" — note the en dash, which is what the specification's examples
     use and what reads correctly in the results screen. */
  function rangeText(range) {
    return range[0] + "–" + range[1];
  }

  /* "Mobility 5, Size 4" */
  function attrValuesText(m, names) {
    var parts = [];
    for (var i = 0; i < names.length; i++) {
      parts.push(names[i] + " " + attrOf(m, names[i]));
    }
    return parts.join(", ");
  }

  /* Join a list into English: "a", "a and b", "a, b and c". */
  function andList(items) {
    if (items.length === 0) return "";
    if (items.length === 1) return items[0];
    return items.slice(0, -1).join(", ") + " and " + items[items.length - 1];
  }

  /* ==================================================================
     SECTION 1 — DATA VALIDATION

     Checks the data files before the simulation starts. If this fails,
     the app shows the errors on screen instead of the login, because a
     simulation running on broken data would silently mark people wrong.

     Returns { ok, errors, warnings }. Each error names the file, the row
     (where a row is involved) and the problem, so that WK can find it in
     the spreadsheet the file came from.
     ================================================================== */

  function validateData(sitesJson, filesByName, options) {
    var errors = [];
    var warnings = [];
    var opts = options || {};

    function fail(file, row, message) {
      errors.push({
        file: file,
        row: row,
        message: message,
        text: file + (row !== null && row !== undefined ? " row " + row : "") + ": " + message
      });
    }
    function warn(file, row, message) {
      warnings.push({
        file: file,
        row: row,
        message: message,
        text: file + (row !== null && row !== undefined ? " row " + row : "") + ": " + message
      });
    }

    var SITES_FILE = "data/sites.json";
    var game = asGame(sitesJson);
    var sites = game.sites;

    /* ---- the game-wide settings ---- */
    if (!(typeof game.timeLimitMinutes === "number" && game.timeLimitMinutes > 0)) {
      fail(SITES_FILE, null, "timeLimitMinutes must be a positive number");
    }
    if (!(typeof game.sliderSpan === "number" && game.sliderSpan >= 1 && game.sliderSpan <= 10)) {
      fail(SITES_FILE, null, "sliderSpan must be a whole number between 1 and 10");
    }

    /* ---- the list of sites ---- */
    if (sites.length < 1) {
      fail(SITES_FILE, null, "there must be at least one site");
      return { ok: false, errors: errors, warnings: warnings };
    }

    for (var i = 0; i < sites.length; i++) {
      var site = sites[i];
      var where = SITES_FILE + " (site " + (i + 1) + ")";
      var isLast = i === sites.length - 1;

      /* ids must be 1, 2, 3 ... in order, because the rest of the code
         works out "the next site" by adding one to the id. */
      if (Number(site.id) !== i + 1) {
        fail(where, null, "id must be " + (i + 1) + " but is " + site.id);
      }

      /* A site's label, when the data gives one, has to agree with its id.
         The recorded answers use the label ("Site 2") while several rules
         work out the next site by adding one to the id, so if the two ever
         disagreed a microbe sent forward could never be matched up again. */
      if (site.label !== undefined && site.label !== "Site " + site.id) {
        fail(where, null, "label \"" + site.label + "\" does not match its id; it must be \"Site " + site.id + "\"");
      }

      /* ranges */
      var names = attributeNames(site);
      if (names.length !== 3) {
        fail(where, null, "ranges must define exactly three attributes, but defines " + names.length);
      }
      for (var a = 0; a < names.length; a++) {
        var r = site.ranges[names[a]];
        if (!Array.isArray(r) || r.length !== 2) {
          fail(where, null, "range for " + names[a] + " must be a pair like [8, 10]");
        } else if (!(isWholeNumber(r[0]) && isWholeNumber(r[1]) && 1 <= r[0] && r[0] <= r[1] && r[1] <= 10)) {
          fail(where, null, "range for " + names[a] + " must be whole numbers with 1 ≤ low ≤ high ≤ 10, but is [" + r[0] + ", " + r[1] + "]");
        }
      }

      /* traits */
      if (TRAIT_NAMES.indexOf(site.desired) === -1) {
        fail(where, null, "desired trait \"" + site.desired + "\" is not one of: " + TRAIT_NAMES.join(", "));
      }
      if (TRAIT_NAMES.indexOf(site.undesired) === -1) {
        fail(where, null, "undesired trait \"" + site.undesired + "\" is not one of: " + TRAIT_NAMES.join(", "));
      }
      if (site.desired === site.undesired) {
        fail(where, null, "desired and undesired trait are both \"" + site.desired + "\"; they must differ");
      }

      /* the next-site preview: present on every site except the last */
      var preview = site.nextSitePreview;
      if (isLast) {
        if (preview !== null && preview !== undefined) {
          fail(where, null, "the last site must have nextSitePreview set to null");
        }
      } else if (!preview) {
        fail(where, null, "nextSitePreview must be set on every site except the last");
      } else if (preview.kind === "attribute") {
        if (names.indexOf(preview.name) === -1) {
          fail(where, null, "nextSitePreview names attribute \"" + preview.name + "\", which is not one of this simulation's attributes");
        }
        if (!Array.isArray(preview.range) || preview.range.length !== 2 ||
            !(isWholeNumber(preview.range[0]) && isWholeNumber(preview.range[1]) &&
              1 <= preview.range[0] && preview.range[0] <= preview.range[1] && preview.range[1] <= 10)) {
          fail(where, null, "nextSitePreview range must be whole numbers with 1 ≤ low ≤ high ≤ 10");
        }
      } else if (preview.kind === "undesiredTrait") {
        if (TRAIT_NAMES.indexOf(preview.trait) === -1) {
          fail(where, null, "nextSitePreview trait \"" + preview.trait + "\" is not one of: " + TRAIT_NAMES.join(", "));
        }
      } else {
        fail(where, null, "nextSitePreview kind must be \"attribute\" or \"undesiredTrait\", but is \"" + preview.kind + "\"");
      }

      /* the marked-correct Step 1 answer */
      var expected = site.step1Expected;
      if (!expected) {
        fail(where, null, "step1Expected is missing");
      } else {
        if (TRAIT_NAMES.indexOf(expected.trait) === -1) {
          fail(where, null, "step1Expected trait \"" + expected.trait + "\" is not one of: " + TRAIT_NAMES.join(", "));
        }
        if (names.indexOf(expected.attribute) === -1) {
          fail(where, null, "step1Expected attribute \"" + expected.attribute + "\" is not one of this simulation's attributes");
        }
        var er = expected.range;
        if (!Array.isArray(er) || er.length !== 2) {
          fail(where, null, "step1Expected range must be a pair like [8, 10]");
        } else {
          /* The slider always selects the same number of consecutive
             values (three, in this simulation), so the marked-correct
             answer has to be exactly that wide. A range of [8, 10] is
             three values wide: 8, 9 and 10. */
          var width = er[1] - er[0] + 1;
          if (typeof game.sliderSpan === "number" && width !== game.sliderSpan) {
            fail(where, null, "step1Expected range [" + er[0] + ", " + er[1] + "] is " + width + " values wide, but sliderSpan is " + game.sliderSpan);
          }
          if (!(isWholeNumber(er[0]) && isWholeNumber(er[1]) && 1 <= er[0] && er[0] <= er[1] && er[1] <= 10)) {
            fail(where, null, "step1Expected range must be whole numbers with 1 ≤ low ≤ high ≤ 10");
          }
        }
      }

      /* the two microbe files this site uses must actually have been loaded */
      if (!site.step2File) {
        fail(where, null, "step2File is missing");
      } else if (!filesByName || !filesByName[site.step2File]) {
        fail(where, null, "step2File \"" + site.step2File + "\" was not found in data/");
      }
      if (!site.step34File) {
        fail(where, null, "step34File is missing");
      } else if (!filesByName || !filesByName[site.step34File]) {
        fail(where, null, "step34File \"" + site.step34File + "\" was not found in data/");
      }
    }

    /* ---- the microbe files ---- */
    var checked = {};
    for (var s = 0; s < sites.length; s++) {
      checkMicrobeFile(sites[s].step2File, "step2");
      checkMicrobeFile(sites[s].step34File, "step34");
    }

    function checkMicrobeFile(fileName, kind) {
      if (!fileName || checked[fileName]) return;
      checked[fileName] = true;
      var file = filesByName ? filesByName[fileName] : null;
      if (!file) return; /* already reported above */
      var rows = rowsOf(file);

      /* Row numbers in messages are 1-based and count the rows in the
         file, so they line up with what WK sees in the spreadsheet. */
      var seenNames = {};
      var categoryCounts = {};

      for (var r = 0; r < rows.length; r++) {
        var row = rows[r];
        var rowNo = r + 1;
        var name = mName(row);

        if (!name || typeof name !== "string") {
          fail(fileName, rowNo, "Name is missing or is not text");
        } else if (seenNames[name]) {
          fail(fileName, rowNo, "Name \"" + name + "\" appears more than once in this file");
        } else {
          seenNames[name] = true;
        }

        var attrs = ["Rigidity", "Mobility", "Size"];
        for (var k = 0; k < attrs.length; k++) {
          var v = attrOf(row, attrs[k]);
          if (!isWholeNumber(v) || v < 1 || v > 10) {
            fail(fileName, rowNo, attrs[k] + " must be a whole number from 1 to 10, but is " + JSON.stringify(v));
          }
        }

        var trait = mTrait(row);
        if (TRAIT_NAMES.indexOf(trait) === -1) {
          fail(fileName, rowNo, "Trait \"" + trait + "\" is not one of: " + TRAIT_NAMES.join(", "));
        }

        if (kind === "step34") {
          var category = mCategory(row);
          if (category !== EXISTING && SET_NAMES.indexOf(category) === -1) {
            fail(fileName, rowNo, "Category \"" + category + "\" is not one of: " + EXISTING + ", " + SET_NAMES.join(", "));
          } else {
            categoryCounts[category] = (categoryCounts[category] || 0) + 1;
          }
        }

        /* Images are a warning, never an error: a missing picture is
           ugly, but the simulation can still be played and marked. The
           app shows a placeholder. This check only runs when the caller
           supplies a list of the images that exist, because this file is
           not allowed to look at the filesystem. */
        if (opts.availableImages && name && opts.availableImages.indexOf(name + ".png") === -1) {
          warn(fileName, rowNo, "no image found at img/" + name + ".png; a placeholder will be shown");
        }
      }

      if (kind === "step2") {
        if (rows.length !== 10) {
          fail(fileName, null, "a Step 2 file must have exactly 10 rows, but has " + rows.length);
        }
      } else {
        if ((categoryCounts[EXISTING] || 0) !== 6) {
          fail(fileName, null, "a Step 3&4 file must have exactly 6 \"" + EXISTING + "\" rows, but has " + (categoryCounts[EXISTING] || 0));
        }
        for (var t = 0; t < SET_NAMES.length; t++) {
          if ((categoryCounts[SET_NAMES[t]] || 0) !== 3) {
            fail(fileName, null, "a Step 3&4 file must have exactly 3 \"" + SET_NAMES[t] + "\" rows, but has " + (categoryCounts[SET_NAMES[t]] || 0));
          }
        }
      }
    }

    return { ok: errors.length === 0, errors: errors, warnings: warnings };
  }

  function isWholeNumber(v) {
    return typeof v === "number" && isFinite(v) && Math.floor(v) === v;
  }

  /* ==================================================================
     SECTION 2 — STEP 2: sorting the ten microbes

     For each microbe, in the order the file lists them:

       1. Keep it at THIS site if it does not carry this site's undesired
          trait AND at least 2 of its 3 attributes are in range.
       2. Otherwise send it to the NEXT site if it satisfies whatever
          little the candidate has been shown about the next site — either
          the previewed attribute is in the previewed range, or the
          microbe does not carry the previewed undesired trait.
       3. Otherwise send it back (Return).
     ================================================================== */

  /* The full working, used inside this file to build reasons. */
  function step2Decisions(site, microbes) {
    var here = siteLabel(site);
    var next = nextSiteLabel(site);
    var preview = site.nextSitePreview;
    var out = [];

    for (var i = 0; i < microbes.length; i++) {
      var m = microbes[i];
      var trait = mTrait(m);
      var hasUndesired = trait === site.undesired;
      var k = hits(m, site);
      var inNames = hitNames(m, site);
      var choice, reason;

      if (!hasUndesired && k >= 2) {
        choice = here;
        reason = "No undesired trait; " + k + " of 3 attributes in range (" +
                 attrValuesText(m, inNames) + ") → " + here + ".";
      } else {
        /* First, say plainly why it cannot stay here. */
        var whyNotHere;
        if (hasUndesired) {
          whyNotHere = "Carries " + trait + ", which " + here + " does not want → not " + here + ".";
        } else {
          whyNotHere = "Only " + k + " of 3 attributes in range" +
                       (inNames.length ? " (" + attrValuesText(m, inNames) + ")" : "") +
                       " → not " + here + ".";
        }

        if (!preview) {
          choice = RETURN;
          reason = whyNotHere + " There is no next site → Return.";
        } else if (preview.kind === "attribute") {
          var value = attrOf(m, preview.name);
          var fits = inRange(value, preview.range);
          choice = fits ? next : RETURN;
          reason = whyNotHere + " " + next + "'s visible attribute is " + preview.name + " " +
                   rangeText(preview.range) + "; this microbe has " + preview.name + " " + value +
                   " → " + (fits ? next : "Return") + ".";
        } else {
          /* preview.kind === "undesiredTrait" */
          var ok = trait !== preview.trait;
          choice = ok ? next : RETURN;
          reason = whyNotHere + " " + next + "'s visible undesired trait is " + preview.trait +
                   "; this microbe carries " + trait + " → " + (ok ? next : "Return") + ".";
        }
      }

      out.push({ microbe: mName(m), choice: choice, reason: reason });
    }
    return out;
  }

  /* The published shape: just the name-to-choice map. */
  function expectedStep2(site, microbes) {
    var decisions = step2Decisions(site, microbes);
    var map = {};
    for (var i = 0; i < decisions.length; i++) map[decisions[i].microbe] = decisions[i].choice;
    return map;
  }

  /* ==================================================================
     SECTION 3 — STEP 3: picking one microbe from each set of three

     Within a set, rank the three microbes by four things in order. The
     first item in the list wins; anything that ties with it on all four
     is also accepted as correct.

       1. Does it carry the undesired trait? (not carrying it is better)
       2. How many attributes are in range? (more is better)
       3. Does it carry the desired trait?   (carrying it is better)
       4. How far outside the ranges is it?  (less is better)
     ================================================================== */

  /* The four numbers a microbe is ranked by, smallest-first on every one. */
  function step3Tuple(m, site) {
    return [
      mTrait(m) === site.undesired ? 1 : 0,
      -hits(m, site),
      mTrait(m) === site.desired ? 0 : 1,
      outDistance(m, site)
    ];
  }

  function sameTuple(a, b) {
    for (var i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
    return true;
  }

  function compareTuples(a, b) {
    for (var i = 0; i < a.length; i++) {
      if (a[i] !== b[i]) return a[i] - b[i];
    }
    return 0;
  }

  /* A plain-English description of why a microbe ranks where it does. */
  function step3Description(m, site) {
    var parts = [];
    var trait = mTrait(m);
    if (trait === site.undesired) {
      parts.push("carries " + trait + ", the undesired trait");
    }
    var k = hits(m, site);
    var inNames = hitNames(m, site);
    parts.push(k + " of 3 attributes in range" + (inNames.length ? " (" + inNames.join(", ") + ")" : ""));
    if (trait === site.desired) {
      parts.push("carries " + trait + ", the desired trait");
    } else if (trait !== site.undesired) {
      parts.push("does not carry " + site.desired + ", the desired trait");
    }
    var d = outDistance(m, site);
    if (d > 0) parts.push("out of range by " + d + " in total");
    return parts.join("; ");
  }

  /* Group the rows of a Step 3&4 file by their Category column. Row order
     inside the file is never used as a rule; it is only kept so that the
     screens show the microbes in the same order every time. */
  function groupByCategory(pool) {
    var groups = {};
    for (var i = 0; i < pool.length; i++) {
      var c = mCategory(pool[i]);
      if (!groups[c]) groups[c] = [];
      groups[c].push(pool[i]);
    }
    return groups;
  }

  function expectedStep3(site, pool) {
    var groups = groupByCategory(pool);
    var result = [];

    for (var s = 0; s < SET_NAMES.length; s++) {
      var setName = SET_NAMES[s];
      var members = (groups[setName] || []).slice();

      /* Rank them. The sort is stable in both JavaScript and Python, so
         when two microbes tie completely the one listed first in the file
         comes first here. That only affects which name is shown first in
         the answer key; both tied names are marked correct. */
      var ranked = members.map(function (m) {
        return { microbe: m, tuple: step3Tuple(m, site) };
      });
      ranked.sort(function (a, b) { return compareTuples(a.tuple, b.tuple); });

      var expected = [];
      var reason = "";
      if (ranked.length > 0) {
        var bestTuple = ranked[0].tuple;
        for (var r = 0; r < ranked.length; r++) {
          if (sameTuple(ranked[r].tuple, bestTuple)) expected.push(mName(ranked[r].microbe));
        }
        reason = step3Description(ranked[0].microbe, site);
        if (expected.length > 1) {
          reason += ". " + andList(expected) + " rank equally, so any of them is accepted.";
        }
      }

      result.push({
        set: setName,
        expected: expected,
        reason: reason,
        /* The full ranking, for the answer-key page. */
        ranking: ranked.map(function (r) {
          return { microbe: mName(r.microbe), why: step3Description(r.microbe, site) };
        })
      });
    }
    return result;
  }

  /* ==================================================================
     SECTION 4 — STEP 4: scoring the final three

     Start at 100%. Take off 20 percentage points for each of:

       * each attribute whose average across the three microbes falls
         outside the site's range (so up to 60% from this rule alone);
       * any one of the three carrying the undesired trait (20% once,
         however many of them do);
       * none of the three carrying the desired trait.

     The average is compared in WHOLE NUMBERS — the total of the three
     values against three times the range — so that a rounded 7.67 can
     never be treated as though it were inside a range starting at 8.
     ================================================================== */

  function scoreStep4(site, trio) {
    var names = attributeNames(site);
    var penalties = [];
    var averages = {};
    /* Whether each attribute's average landed inside its target, reported
       as a plain true/false so that the results screen never has to work it
       out again — or, worse, guess it by reading the penalty wording. */
    var withinRange = {};
    var score = 100;

    for (var i = 0; i < names.length; i++) {
      var name = names[i];
      var range = site.ranges[name];
      var sum = 0;
      for (var t = 0; t < trio.length; t++) sum += attrOf(trio[t], name);

      /* Two decimal places, for display only. Never used in the test. */
      var average = Math.round((sum / trio.length) * 100) / 100;
      averages[name] = average;

      var count = trio.length;
      var insideRange = (range[0] * count <= sum) && (sum <= range[1] * count);
      withinRange[name] = insideRange;
      if (!insideRange) {
        score -= 20;
        penalties.push(name + " average " + average.toFixed(2) + " is outside " +
                       rangeText(range) + " (−20%)");
      }
    }

    /* The undesired trait: charged once, whichever of the three carry it. */
    var carriers = [];
    for (var u = 0; u < trio.length; u++) {
      if (mTrait(trio[u]) === site.undesired) carriers.push(mName(trio[u]));
    }
    var hasUndesired = carriers.length > 0;
    if (hasUndesired) {
      score -= 20;
      penalties.push(andList(carriers) + (carriers.length === 1 ? " carries " : " carry ") +
                     site.undesired + ", the undesired trait (−20%)");
    }

    /* The desired trait: charged once if none of the three carries it. */
    var hasDesired = false;
    for (var d = 0; d < trio.length; d++) {
      if (mTrait(trio[d]) === site.desired) { hasDesired = true; break; }
    }
    if (!hasDesired) {
      score -= 20;
      penalties.push("None of the three carries " + site.desired +
                     ", the desired trait (−20%)");
    }

    if (score < 0) score = 0;

    return {
      score: score,
      averages: averages,
      withinRange: withinRange,
      penalties: penalties,
      hasUndesired: hasUndesired,
      hasDesired: hasDesired
    };
  }

  /* Score every possible group of three from a pool of ten (there are 120
     of them) and report the best score and every group that reaches it. */
  function bestStep4(site, pool) {
    if (!pool || pool.length < 3) return { best: null, combos: [] };

    var best = -1;
    var combos = [];
    for (var a = 0; a < pool.length - 2; a++) {
      for (var b = a + 1; b < pool.length - 1; b++) {
        for (var c = b + 1; c < pool.length; c++) {
          var result = scoreStep4(site, [pool[a], pool[b], pool[c]]);
          if (result.score > best) {
            best = result.score;
            combos = [];
          }
          if (result.score === best) {
            combos.push([mName(pool[a]), mName(pool[b]), mName(pool[c])]);
          }
        }
      }
    }
    return { best: best, combos: combos };
  }

  /* ==================================================================
     SECTION 5 — STEP 5: confirming the microbes sent forward

     At the start of the next site, the candidate sees each microbe they
     sent forward again, this time with the new site's full information.
     The test is the same one Step 2 used to decide "keep it here":
     no undesired trait, and at least 2 of 3 attributes in range.
     ================================================================== */

  function step5Decisions(nextSite, pushedMicrobes) {
    var label = siteLabel(nextSite);
    var out = [];
    for (var i = 0; i < pushedMicrobes.length; i++) {
      var m = pushedMicrobes[i];
      var trait = mTrait(m);
      var hasUndesired = trait === nextSite.undesired;
      var k = hits(m, nextSite);
      var inNames = hitNames(m, nextSite);
      var keep = !hasUndesired && k >= 2;
      var reason;

      if (keep) {
        reason = "No undesired trait; " + k + " of 3 attributes in range for " + label +
                 " (" + attrValuesText(m, inNames) + ") → " + label + ".";
      } else if (hasUndesired) {
        reason = "Carries " + trait + ", which " + label + " does not want → Return.";
      } else {
        reason = "Only " + k + " of 3 attributes in range for " + label +
                 (inNames.length ? " (" + attrValuesText(m, inNames) + ")" : "") + " → Return.";
      }

      out.push({ microbe: mName(m), choice: keep ? label : RETURN, reason: reason });
    }
    return out;
  }

  function expectedStep5(nextSite, pushedMicrobes) {
    var decisions = step5Decisions(nextSite, pushedMicrobes);
    var map = {};
    for (var i = 0; i < decisions.length; i++) map[decisions[i].microbe] = decisions[i].choice;
    return map;
  }

  /* ==================================================================
     SECTION 6 — MARKING A WHOLE GAME

     Takes the answers the candidate built up while playing and returns
     the object the results screen draws itself from. Nothing here decides
     anything new: it calls the rules above and arranges the outcome.
     ================================================================== */

  /* Was this answer given after the clock reached zero? A missing reading
     is treated as "not late", which is the kinder of the two readings and
     only ever happens if an answer was recorded without a timer. */
  function isLate(secondsLeft) {
    return typeof secondsLeft === "number" && secondsLeft <= 0;
  }

  /* Find a microbe row by name inside a list of rows. */
  function findByName(rows, name) {
    for (var i = 0; i < rows.length; i++) {
      if (mName(rows[i]) === name) return rows[i];
    }
    return null;
  }

  function sameRange(a, b) {
    return Array.isArray(a) && Array.isArray(b) && a[0] === b[0] && a[1] === b[1];
  }

  function markGame(sitesJson, filesByName, answers) {
    var game = asGame(sitesJson);
    var sites = game.sites;
    var answersBySite = (answers && answers.sites) || {};

    var result = { sites: {}, summary: null };
    var step4Scores = [];
    var bestOverallScores = [];
    var decisionsCorrect = 0;
    var decisionsOf = 0;
    var lateAnswers = 0;
    var finished = true;

    for (var i = 0; i < sites.length; i++) {
      var site = sites[i];
      var nextSite = sites[i + 1] || null;
      var given = answersBySite[String(site.id)] || {};
      var step2Rows = rowsOf(filesByName[site.step2File]);
      var step34Rows = rowsOf(filesByName[site.step34File]);
      var groups = groupByCategory(step34Rows);
      var existing = groups[EXISTING] || [];

      var siteResult = {};

      /* ---------------- Step 1 ---------------- */
      siteResult.step1 = markStep1(site, given.step1);
      decisionsCorrect += siteResult.step1.correct;
      decisionsOf += siteResult.step1.of;
      if (siteResult.step1.answered && isLate(given.step1.secondsLeft)) lateAnswers++;

      /* ---------------- Step 2 ---------------- */
      siteResult.step2 = markStep2(site, step2Rows, given.step2);
      decisionsCorrect += siteResult.step2.correct;
      decisionsOf += siteResult.step2.of;
      lateAnswers += siteResult.step2.lateCount;

      /* ---------------- Step 3 ---------------- */
      siteResult.step3 = markStep3(site, step34Rows, given.step3);
      decisionsCorrect += siteResult.step3.correct;
      decisionsOf += siteResult.step3.of;
      lateAnswers += siteResult.step3.lateCount;

      /* ---------------- Step 4 ----------------
         The candidate's pool is the six Existing microbes plus whichever
         of their four Step 3 picks actually exist. The "best overall"
         figure uses the answer key's pool instead, so that a candidate
         who made poor Step 3 picks can see both what was the best they
         could still have done, and what was possible from the start. */
      var candidatePicks = [];
      if (Array.isArray(given.step3)) {
        for (var p = 0; p < given.step3.length; p++) {
          var picked = findByName(step34Rows, given.step3[p].microbe);
          if (picked) candidatePicks.push(picked);
        }
      }
      var candidatePool = existing.concat(candidatePicks);

      var keyStep3 = expectedStep3(site, step34Rows);
      var keyPicks = [];
      for (var q = 0; q < keyStep3.length; q++) {
        var keyPick = findByName(step34Rows, keyStep3[q].expected[0]);
        if (keyPick) keyPicks.push(keyPick);
      }
      var keyPool = existing.concat(keyPicks);

      siteResult.step4 = markStep4(site, step34Rows, given.step4, candidatePool, keyPool);
      step4Scores.push(siteResult.step4.score);
      bestOverallScores.push(siteResult.step4.bestOverall);
      if (siteResult.step4.answered && isLate(given.step4.secondsLeft)) lateAnswers++;
      if (!siteResult.step4.answered) finished = false;

      /* ---------------- Step 5 ----------------
         Step 5 belongs to THIS site (it re-judges what this site sent
         forward) but is asked on the NEXT site's screens. It does not
         happen at all if there is no next site, or if nothing was sent. */
      siteResult.step5 = markStep5(site, nextSite, step2Rows, given.step2, given.step5);
      if (siteResult.step5.applicable) {
        decisionsCorrect += siteResult.step5.correct;
        decisionsOf += siteResult.step5.of;
        lateAnswers += siteResult.step5.lateCount;
      }

      result.sites[String(site.id)] = siteResult;
    }

    result.summary = {
      step4Scores: step4Scores,
      bestOverall: bestOverallScores,
      decisionsCorrect: decisionsCorrect,
      decisionsOf: decisionsOf,
      lateAnswers: lateAnswers,
      finished: finished
    };

    return result;
  }

  /* ---- Step 1 ----
     Marked as two separate items, so getting one of the two right scores
     1 out of 2. The order the candidate switched them on in is irrelevant. */
  function markStep1(site, given) {
    var expected = site.step1Expected;
    var expectedTraitItem = { trait: expected.trait };
    var expectedAttrItem = { attribute: expected.attribute, range: expected.range };

    if (!given || !Array.isArray(given.items)) {
      return {
        answered: false,
        late: false,
        items: [
          { candidate: null, expected: expectedTraitItem, correct: false,
            reason: "Not answered. " + site.desired + " is " + siteLabel(site) + "'s desired trait." },
          { candidate: null, expected: expectedAttrItem, correct: false,
            reason: "Not answered. The expected attribute is " + expected.attribute + " " + rangeText(expected.range) + "." }
        ],
        correct: 0,
        of: 2
      };
    }

    var traitEntries = given.items.filter(function (e) { return e && e.trait !== undefined; });
    var attrEntries = given.items.filter(function (e) { return e && e.attribute !== undefined; });
    var late = isLate(given.secondsLeft);

    /* The trait half. */
    var traitMatch = null;
    for (var i = 0; i < traitEntries.length; i++) {
      if (traitEntries[i].trait === expected.trait) { traitMatch = traitEntries[i]; break; }
    }
    var traitItem = {
      candidate: traitMatch || traitEntries[0] || null,
      expected: expectedTraitItem,
      correct: traitMatch !== null,
      late: late,
      reason: traitMatch
        ? expected.trait + " is " + siteLabel(site) + "'s desired trait."
        : siteLabel(site) + "'s desired trait is " + expected.trait + "."
    };

    /* The attribute half: the right attribute AND the right range. */
    var attrMatch = null;
    var sameNameEntry = null;
    for (var j = 0; j < attrEntries.length; j++) {
      if (attrEntries[j].attribute === expected.attribute) {
        if (!sameNameEntry) sameNameEntry = attrEntries[j];
        if (sameRange(attrEntries[j].range, expected.range)) { attrMatch = attrEntries[j]; break; }
      }
    }
    var attrCandidate = attrMatch || sameNameEntry || attrEntries[0] || null;
    var attrReason;
    if (attrMatch) {
      attrReason = expected.attribute + " " + rangeText(expected.range) +
                   " is the range closest to the extremes of the 1–10 scale.";
    } else if (sameNameEntry) {
      attrReason = expected.attribute + " is the right attribute, but the expected range is " +
                   rangeText(expected.range) + ".";
    } else {
      attrReason = "The expected attribute is " + expected.attribute + " " +
                   rangeText(expected.range) + ".";
    }
    var attrItem = {
      candidate: attrCandidate,
      expected: expectedAttrItem,
      correct: attrMatch !== null,
      late: late,
      reason: attrReason
    };

    var correct = (traitItem.correct ? 1 : 0) + (attrItem.correct ? 1 : 0);
    return { answered: true, late: late, items: [traitItem, attrItem], correct: correct, of: 2 };
  }

  /* ---- Step 2 ---- */
  function markStep2(site, step2Rows, given) {
    var expectedDecisions = step2Decisions(site, step2Rows);
    var items = [];
    var correct = 0;
    var lateCount = 0;
    var answeredAny = false;

    for (var i = 0; i < expectedDecisions.length; i++) {
      var d = expectedDecisions[i];
      var answer = given ? given[d.microbe] : null;
      var candidate = answer ? answer.choice : null;
      var late = answer ? isLate(answer.secondsLeft) : false;
      if (answer) answeredAny = true;
      if (late) lateCount++;
      var isCorrect = candidate === d.choice;
      if (isCorrect) correct++;
      items.push({
        microbe: d.microbe,
        candidate: candidate,
        expected: d.choice,
        correct: isCorrect,
        late: late,
        reason: d.reason
      });
    }

    return { answered: answeredAny, items: items, correct: correct, of: expectedDecisions.length, lateCount: lateCount };
  }

  /* ---- Step 3 ---- */
  function markStep3(site, step34Rows, given) {
    var expectedPicks = expectedStep3(site, step34Rows);
    var items = [];
    var correct = 0;
    var lateCount = 0;
    var answeredAny = Array.isArray(given) && given.length > 0;

    for (var i = 0; i < expectedPicks.length; i++) {
      var e = expectedPicks[i];
      var answer = (Array.isArray(given) && given[i]) ? given[i] : null;
      var candidate = answer ? answer.microbe : null;
      var late = answer ? isLate(answer.secondsLeft) : false;
      if (late) lateCount++;
      var isCorrect = candidate !== null && e.expected.indexOf(candidate) !== -1;
      if (isCorrect) correct++;

      var reason;
      if (isCorrect) {
        reason = e.reason;
      } else if (candidate === null) {
        reason = "Not answered. " + e.expected[0] + " was the best of the three: " + e.reason;
      } else {
        var chosen = findByName(step34Rows, candidate);
        reason = "You picked " + candidate +
                 (chosen ? " (" + step3Description(chosen, site) + ")" : "") +
                 ". " + e.expected[0] + " ranks higher: " + e.reason;
      }

      items.push({
        set: e.set,
        candidate: candidate,
        expected: e.expected,
        correct: isCorrect,
        late: late,
        reason: reason
      });
    }

    return { answered: answeredAny, items: items, correct: correct, of: expectedPicks.length, lateCount: lateCount };
  }

  /* ---- Step 4 ---- */
  function markStep4(site, step34Rows, given, candidatePool, keyPool) {
    var bestYours = bestStep4(site, candidatePool);
    var bestKey = bestStep4(site, keyPool);

    if (!given || !Array.isArray(given.microbes) || given.microbes.length === 0) {
      return {
        answered: false,
        late: false,
        candidate: [],
        averages: {},
        withinRange: {},
        penalties: [],
        score: 0,
        bestForYourPool: bestYours.best,
        bestOverall: bestKey.best,
        optimal: false,
        bestCombosForYourPool: bestYours.combos,
        bestCombosOverall: bestKey.combos
      };
    }

    var trio = [];
    for (var i = 0; i < given.microbes.length; i++) {
      var row = findByName(step34Rows, given.microbes[i]);
      if (row) trio.push(row);
    }

    /* A submission that is not three microbes cannot be scored by the
       rules, which are written for three. Score it 0 and say so, rather
       than inventing a rule for a case the game does not allow. */
    if (trio.length !== 3) {
      return {
        answered: true,
        late: isLate(given.secondsLeft),
        candidate: given.microbes.slice(),
        averages: {},
        withinRange: {},
        penalties: ["The submission does not contain three known microbes, so it cannot be scored (0%)."],
        score: 0,
        bestForYourPool: bestYours.best,
        bestOverall: bestKey.best,
        optimal: false,
        bestCombosForYourPool: bestYours.combos,
        bestCombosOverall: bestKey.combos
      };
    }

    var scored = scoreStep4(site, trio);
    return {
      answered: true,
      late: isLate(given.secondsLeft),
      candidate: given.microbes.slice(),
      averages: scored.averages,
      withinRange: scored.withinRange,
      penalties: scored.penalties,
      score: scored.score,
      bestForYourPool: bestYours.best,
      bestOverall: bestKey.best,
      optimal: bestYours.best !== null && scored.score === bestYours.best,
      bestCombosForYourPool: bestYours.combos,
      bestCombosOverall: bestKey.combos
    };
  }

  /* ---- Step 5 ----
     The microbes asked about are exactly the ones the CANDIDATE sent
     forward at Step 2 — not the ones the answer key would have sent.
     That is what makes Step 5 a rules question rather than a lookup. */
  function markStep5(site, nextSite, step2Rows, givenStep2, givenStep5) {
    if (!nextSite) return { applicable: false, answered: false, items: [], correct: 0, of: 0, lateCount: 0 };

    var forwardLabel = nextSiteLabel(site);
    var pushed = [];
    for (var i = 0; i < step2Rows.length; i++) {
      var name = mName(step2Rows[i]);
      var answer = givenStep2 ? givenStep2[name] : null;
      if (answer && answer.choice === forwardLabel) pushed.push(step2Rows[i]);
    }

    if (pushed.length === 0) {
      return { applicable: false, answered: false, items: [], correct: 0, of: 0, lateCount: 0 };
    }

    var expectedDecisions = step5Decisions(nextSite, pushed);
    var items = [];
    var correct = 0;
    var lateCount = 0;
    var answeredAny = false;

    for (var j = 0; j < expectedDecisions.length; j++) {
      var d = expectedDecisions[j];
      var a = givenStep5 ? givenStep5[d.microbe] : null;
      var candidate = a ? a.choice : null;
      var late = a ? isLate(a.secondsLeft) : false;
      if (a) answeredAny = true;
      if (late) lateCount++;
      var isCorrect = candidate === d.choice;
      if (isCorrect) correct++;
      items.push({
        microbe: d.microbe,
        candidate: candidate,
        expected: d.choice,
        correct: isCorrect,
        late: late,
        reason: d.reason
      });
    }

    return {
      applicable: true,
      answered: answeredAny,
      items: items,
      correct: correct,
      of: expectedDecisions.length,
      lateCount: lateCount
    };
  }

  /* ==================================================================
     SECTION 7 — THE ANSWER KEY

     Everything `tools/answer-key.html` prints. This is the answer key
     worked out from the data files, rather than typed up by hand, so it
     can never drift away from what the simulation actually marks.
     ================================================================== */

  function answerKey(sitesJson, filesByName) {
    var game = asGame(sitesJson);
    var sites = game.sites;
    var out = { sites: [] };

    for (var i = 0; i < sites.length; i++) {
      var site = sites[i];
      var nextSite = sites[i + 1] || null;
      var step2Rows = rowsOf(filesByName[site.step2File]);
      var step34Rows = rowsOf(filesByName[site.step34File]);
      var groups = groupByCategory(step34Rows);
      var existing = groups[EXISTING] || [];

      /* Step 2, grouped the way the customer-facing key groups it. */
      var decisions = step2Decisions(site, step2Rows);
      var step2Groups = {};
      for (var d = 0; d < decisions.length; d++) {
        var key = decisions[d].choice;
        if (!step2Groups[key]) step2Groups[key] = [];
        step2Groups[key].push(decisions[d].microbe);
      }

      /* Step 3 and the pool it produces. */
      var step3 = expectedStep3(site, step34Rows);
      var keyPicks = [];
      for (var p = 0; p < step3.length; p++) {
        var row = findByName(step34Rows, step3[p].expected[0]);
        if (row) keyPicks.push(row);
      }
      var keyPool = existing.concat(keyPicks);
      var best = bestStep4(site, keyPool);

      /* Step 5, applied to whatever the key sent forward. */
      var step5 = null;
      if (nextSite) {
        var forwardLabel = nextSiteLabel(site);
        var pushed = [];
        for (var s = 0; s < decisions.length; s++) {
          if (decisions[s].choice === forwardLabel) {
            var pushedRow = findByName(step2Rows, decisions[s].microbe);
            if (pushedRow) pushed.push(pushedRow);
          }
        }
        if (pushed.length > 0) {
          var step5Decision = step5Decisions(nextSite, pushed);
          var step5Groups = {};
          for (var t = 0; t < step5Decision.length; t++) {
            var k5 = step5Decision[t].choice;
            if (!step5Groups[k5]) step5Groups[k5] = [];
            step5Groups[k5].push(step5Decision[t].microbe);
          }
          step5 = { groups: step5Groups, items: step5Decision };
        }
      }

      out.sites.push({
        id: site.id,
        label: siteLabel(site),
        ranges: site.ranges,
        desired: site.desired,
        undesired: site.undesired,
        nextSitePreview: site.nextSitePreview,
        step1: site.step1Expected,
        step2: { groups: step2Groups, items: decisions },
        step3: step3,
        step4: {
          pool: keyPool.map(mName),
          best: best.best,
          combos: best.combos
        },
        step5: step5
      });
    }
    return out;
  }

  /* ------------------------------------------------------------------
     What this file makes available to the rest of the simulation.
     ------------------------------------------------------------------ */
  return {
    /* the published rules interface */
    validateData: validateData,
    expectedStep2: expectedStep2,
    expectedStep3: expectedStep3,
    scoreStep4: scoreStep4,
    bestStep4: bestStep4,
    expectedStep5: expectedStep5,
    markGame: markGame,
    answerKey: answerKey,

    /* small read-only helpers the screens are allowed to use, so that
       app.js never has to work anything out for itself */
    rowsOf: rowsOf,
    microbeName: mName,
    microbeTrait: mTrait,
    microbeCategory: mCategory,
    microbeAttribute: attrOf,
    attributeNames: attributeNames,
    groupByCategory: groupByCategory,
    siteLabel: siteLabel,
    nextSiteLabel: nextSiteLabel,
    asGame: asGame,
    RETURN: RETURN,
    TRAIT_NAMES: TRAIT_NAMES,
    EXISTING: EXISTING,
    SET_NAMES: SET_NAMES
  };
})();

/* Make the engine usable from Node as well as from a browser. Node is used
   only by `reference/difftest.py`, which runs during development. The
   simulation itself never needs Node, npm, or any build step. */
if (typeof module !== "undefined" && module.exports) {
  module.exports = MARKING;
}
