# Sea Wolf — practice simulation

This folder is the whole product. Put it in a GitHub repository, switch on
GitHub Pages, and it is live. There is nothing to install, nothing to
compile and nothing to run on a server.

Written for WK to maintain alone. Every section below assumes no programming
knowledge.

---

## 1. What is in here

| File or folder | What it is | Do you ever edit it? |
|---|---|---|
| `index.html` | The simulation. The only page candidates ever open. | No |
| `config.js` | The login settings. | **Yes** — see section 3 |
| `css/app.css` | How everything looks. Colours are all at the top. | Only to change colours |
| `js/marking.js` | The rules of the game and all the marking. | No |
| `js/app.js` | The screens, the clock, and remembering answers. | No |
| `data/sites.json` | What each site wants: ranges, traits, the expected Step 1 answer. | **Yes** — for a new simulation |
| `data/site-*-step-*.json` | The microbes. Six files, straight from your spreadsheet. | **Yes** — for a new simulation |
| `img/` | Every microbe picture and the seven icons. | **Yes** — for a new simulation |
| `tests.html` | Checks the marking is correct. Green or red. | No — you *read* it |
| `tools/make-passcode.html` | Turns a password into the scrambled value for `config.js`. | No |
| `tools/answer-key.html` | Prints the answer key, worked out from the data. | No |
| `tools/embed-test.html` | Reports how a course lesson frames the simulation. | No |
| `reference/` | Two Python files used to double-check the marking during development. Not part of the product; never loaded by a browser. | No |

**One thing that matters more than it sounds.** The simulation does not save
anything in the browser. If a candidate refreshes the page, their run is
gone. That is on purpose: it matches the real test, and the old version's
habit of saving half-finished answers in the browser is the most likely
cause of the duplicated answers on the old review screen.

---

## 2. Putting it online

1. Create a new, empty repository on GitHub.
2. Upload everything in this folder — including the `css`, `js`, `data`,
   `img` and `tools` folders. Keep the folder structure exactly as it is.
3. In the repository, go to **Settings → Pages**, and under **Branch**
   choose `main` and `/ (root)`, then **Save**.
4. Wait a minute or two. Your simulation is then at:

   ```
   https://<your-github-username>.github.io/<repository-name>/
   ```

5. Put it in a course lesson with this, changing the address to yours:

   ```html
   <iframe src="https://<your-github-username>.github.io/<repository-name>/"
           allowfullscreen allow="fullscreen"
           style="width:100%;aspect-ratio:16/9;border:0"></iframe>
   ```

   The `allowfullscreen allow="fullscreen"` part is what lets the fullscreen
   button work. Without it the simulation simply hides that button.

**To change something later:** edit the file, upload it to the repository,
and wait a minute. There is no build step and nothing to rebuild.

**To undo a change:** put the old version of the file back. The simulation
is only ever the files you uploaded.

---

## 3. Changing the password

The simulation ships with a **temporary** password that must be changed:

```
username: CaseMentor9187
password: change-me-before-launch
```

To set a real one:

1. Open `tools/make-passcode.html` in your browser — either double-click it,
   or open `https://<your-username>.github.io/<repo>/tools/make-passcode.html`.
2. Type the password you want.
3. Press **Scramble it** and copy the long line of letters and numbers.
4. Open `config.js` and replace what is between the quote marks on the
   `passcodeHash:` line with what you copied.
5. Upload `config.js` to the repository.

Write the password down somewhere. Nothing here can recover it.

**Do not reuse the password from the old simulation.** It has been readable
in a public repository since the site was built.

### Being honest about what the login does

Anyone can read every file in a GitHub Pages repository, and the password
check runs inside the visitor's own browser. A determined technical person
can get past it. This was equally true of the old simulation. What the
scramble does is stop the password being *casually* readable. Properly
stopping sharing needs a small server issuing a token per customer, which
needs a developer — worth doing if you ever scale up, not now.

### To remove the login completely

In `config.js`, change:

```js
requireLogin: true,
```

to

```js
requireLogin: false,
```

---

## 4. The "open it from your course" check

`config.js` also has this:

```js
blockDirectAccess: false,
allowedEmbedDomains: [
  "app.casementor.com",
  "casementor.spayee.com"
],
```

With `blockDirectAccess: false` (how it ships) anyone with the web address
can open the simulation.

With `blockDirectAccess: true` it only opens inside a course lesson served
from one of the listed addresses.

**Do not switch this on until you have run `tools/embed-test.html`.** Put
that page in a hidden lesson, open the lesson, and read the line marked
"WRITE THIS DOWN" — it tells you the address your lessons actually run
under. Add that address to the list, *then* switch the check on.

The check is deliberately forgiving: it only blocks a visitor when it can
positively identify an address that is not on the list. If it cannot tell —
some browsers withhold that information — it lets them in. Locking out a
paying customer on a Sunday is worse than an occasional shared link.

---

## 5. Checking the marking is right

Open `tests.html` from your GitHub Pages address:

```
https://<your-username>.github.io/<repo>/tests.html
```

You will see one big banner:

* **ALL TEST GROUPS PASSED** — the marking is behaving.
* **FAILED: <name of a group>** — something is wrong. Every failing line is
  red and shows what was expected next to what actually happened.

Run this **every time you change a data file.** It takes a few seconds and
it is the difference between a wrong answer key and a correct one.

It cannot be run by double-clicking the file; it has to be opened from a web
address, because browsers stop a plain file from reading other files.

---

## 6. Building the next simulation

This is meant to be a copy-and-swap job with no programming:

1. Copy this whole folder into a new repository.
2. Replace the six microbe files in `data/` with the new ones from your
   spreadsheet. Keep the same file names, or change the names inside
   `data/sites.json` to match.
3. Replace the pictures in `img/`. Every microbe needs a picture named
   exactly after it, for example `Microbe 42.png`. Keep the seven icon files
   (`rigidity.png`, `mobility.png`, `size.png`, `pressure_risistant.png`,
   `hydrophilic.png`, `aerobic.png`, `heat_resistance.png`) as they are.
4. Edit `data/sites.json` with the new sites' ranges, traits, previews and
   expected Step 1 answers.
5. Open `tests.html`. Fix anything red — the messages name the file and the
   row.
6. Open `tools/answer-key.html` and print it for the course chapter.

**If a new simulation ever needs a change to `js/app.js` or `js/marking.js`,
that is a fault in the template, not a one-off.** Write down what you needed
and get it fixed properly, or the next one will need it too.

### What the fields in `data/sites.json` mean

```json
{
  "timeLimitMinutes": 30,        // the clock, for the whole game
  "sliderSpan": 3,               // the Step 1 slider always covers 3 values
  "sites": [
    {
      "id": 1,                   // 1, 2, 3 ... in order
      "label": "Site 1",         // must read "Site " followed by the id
      "ranges": { "Rigidity": [8, 10], "Mobility": [4, 6], "Size": [2, 4] },
      "desired": "Pressure Resistant",
      "undesired": "Aerobic",

      // what Step 2 shows of the NEXT site — one of these three:
      //   { "kind": "attribute", "name": "Rigidity", "range": [4, 6] }
      //   { "kind": "undesiredTrait", "trait": "Hydrophilic" }
      //   null   (on the last site only)
      "nextSitePreview": { "kind": "attribute", "name": "Rigidity", "range": [4, 6] },

      // the marked-correct Step 1 answer. The range must be exactly
      // sliderSpan values wide — so where a site's target is only two wide,
      // like Site 2's Size 1-2, the correct answer is the three-wide span
      // that contains it: 1-3.
      "step1Expected": { "trait": "Pressure Resistant",
                         "attribute": "Rigidity", "range": [8, 10] },

      "step2File": "site-1-step-2.json",
      "step34File": "site-1-step-3&4.json"
    }
  ]
}
```

The microbe files keep the shape your spreadsheet converter produces:

```json
{ "Sheet1": [
  { "Name": "Microbe 32", "Rigidity": 6, "Mobility": 6, "Size": 3, "Trait": "Aerobic" }
] }
```

The Step 3&4 files also carry a `"Category"` on every row: exactly six rows
of `"Existing"`, and exactly three rows each of `"Set 1"`, `"Set 2"`,
`"Set 3"` and `"Set 4"`. Row order does not matter anywhere.

The four trait names are fixed and spelled exactly like this:
`Pressure Resistant`, `Hydrophilic`, `Aerobic`, `Heat Resistant`.

---

## 7. Changing the colours

Open `css/app.css`. The first section is a list of every colour used:

```css
:root {
  --page-bg:     #1f2733;   /* behind everything */
  --box-bg:      #2b3545;   /* inside the main box */
  --header-bg:   #333f50;   /* the bar across the top */
  --accent:      #3b82f6;   /* buttons and selected things */
  ...
}
```

Change a value there and it changes everywhere. Do not go hunting for
colours further down the file.

Two rules to keep if you change them:

* **Microbe pictures must sit on a light background.** They are pale
  drawings on a see-through background; on a dark surface the faint ones
  vanish completely.
* **Keep the text readable.** Ordinary text should be at least 4.5 times as
  bright as what it sits on, headings at least 3 times. Any free online
  contrast checker will tell you the number.

---

## 8. If something goes wrong

**The simulation shows "There is a problem with the data files".**
It is refusing to start rather than mark people against faulty data. Each
line names the file and the row. Fix them and upload again.

**The simulation shows "The simulation could not start".**
A data file could not be loaded. Usually this means a file was not uploaded,
or its name in `data/sites.json` does not match the real file name — watch
for the `&` in `site-1-step-3&4.json`.

**A microbe has no picture.**
The card still works; the picture is just blank. Check the file is in `img/`
and named exactly after the microbe, including the space: `Microbe 42.png`.

**The login says "Login needs the page to be opened over https".**
The page is being opened straight from your computer rather than from a web
address. Open it from your GitHub Pages address.

**The fullscreen button is missing.**
The lesson did not allow fullscreen. Add `allowfullscreen allow="fullscreen"`
to the iframe tag.

**A candidate says they lost their answers.**
They refreshed or reopened the page. Nothing is saved anywhere, on purpose.
There is no way to recover a run.
