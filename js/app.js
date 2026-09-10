/* ==========================================================================
   app.js — the screens, the clock and the candidate's answers.

   WHAT THIS FILE IS AND IS NOT
   ----------------------------
   This file draws the game and remembers what the candidate clicked. It
   does NOT know any of the rules. It never works out an average, never
   counts how many attributes are in range, never calculates a score. Every
   one of those lives in js/marking.js and this file asks for the answer.

   That separation is the point: when a rule changes there is one file to
   change and one page of tests to re-run.

   HOW IT WORKS, IN ONE PARAGRAPH
   ------------------------------
   There is a single object called `state` holding everything: which screen
   we are on, which site, how many seconds are left, and every answer given
   so far. Whenever something changes, `render()` redraws the screen from
   `state`. Nothing is written to the browser's storage, so a refresh loses
   the run — the same as the real test, and the reason the old version's
   duplicated-answers fault cannot happen here.

   WHERE TO LOOK FOR THINGS
   ------------------------
     1. Settings and small helpers
     2. The state object
     3. Starting up: window size, embed check, loading the data
     4. The clock
     5. Recording answers
     6. Drawing: shared pieces (header, site panel, cards)
     7. Drawing: each screen
     8. The results screen, printing and the CSV file
     9. Clicks, changes and keyboard-free interaction
   ========================================================================== */

(function () {
  "use strict";

  /* NOTE ON VERSION NUMBERS
     There is deliberately no version number or build date anywhere in this
     application, on screen or in the browser console. A candidate who sees
     a date thinks the tool is out of date, so we show neither.

     To check which version a web address is actually serving, look at the
     commit date in the code repository, or search the files for a phrase
     you know you changed. */

  /* ======================================================================
     1. SETTINGS AND SMALL HELPERS
     ====================================================================== */

  /* Where each icon picture lives. The names of the files are not tidy —
     "pressure_risistant.png" is misspelled in the original artwork — so
     they are listed here rather than worked out. If you ever rename an
     icon file, change it here.

     These are the seven characteristics of the Sea Wolf game as a whole,
     not facts about any one site, so they are not in the data files. */
  var ICONS = {
    "Rigidity": "img/rigidity.png",
    "Mobility": "img/mobility.png",
    "Size": "img/size.png",
    "Pressure Resistant": "img/pressure_risistant.png",
    "Hydrophilic": "img/hydrophilic.png",
    "Aerobic": "img/aerobic.png",
    "Heat Resistant": "img/heat_resistance.png"
  };

  /* The smallest window the game is usable in. Below this the candidate
     gets a message instead, and gets the game back when they enlarge it. */
  var MIN_WIDTH = 1000;
  var MIN_HEIGHT = 562;

  var app = document.getElementById("app");
  var tooSmall = document.getElementById("too-small");

  function esc(text) {
    return String(text === null || text === undefined ? "" : text)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function iconFor(name) { return ICONS[name] || ""; }

  /* An <img> for one icon. Icons are black squares with white symbols, so
     they only ever sit on the light cards, never on the dark background. */
  function iconTag(name, cls) {
    var src = iconFor(name);
    if (!src) return "";
    return '<img class="' + (cls || "icon") + '" src="' + esc(src) +
           '" alt="' + esc(name) + '">';
  }

  /* An <img> for a microbe's picture. If the picture file is missing the
     browser shows nothing rather than a broken-image symbol; the card is
     still perfectly usable, which is why a missing picture is only ever a
     warning and never stops the simulation. */
  function microbeImg(name) {
    return '<img src="img/' + esc(name) + '.png" alt="' + esc(name) +
           '" onerror="this.style.visibility=\'hidden\'">';
  }

  function rangeText(range) { return range[0] + "–" + range[1]; }

  /* ======================================================================
     2. THE STATE
     ====================================================================== */

  var state = {
    phase: "loading",     /* which screen: see render() for the full list   */
    siteIndex: 0,         /* 0, 1, 2 — which site we are on                 */
    data: null,           /* the parsed sites.json                          */
    files: null,          /* the six microbe files, by file name            */
    dataErrors: null,     /* filled in only if the data files are broken    */
    loadError: null,

    answers: { startedAt: null, sites: {} },

    timer: { total: 0, secondsLeft: 0, running: false, everStarted: false },

    ui: {
      step1: null,        /* which characteristics are on, and their ranges */
      step2: null,        /* which microbe we are on, and the choice made   */
      step34: null,       /* phase 3 or 4, the picks and the three slots    */
      step5: null,
      legendOpen: false,
      /* Which placed microbes the candidate has opened up. Kept here rather
         than in the page itself, because the screen is completely redrawn
         every time a microbe is assigned — so anything held only in the
         page would snap shut, which is what used to happen. Cleared when a
         site starts, since the cards are gone by then anyway. */
      openCards: {},
      confirmRestart: false,
      loginError: "",
      revealReasons: {},  /* per site, on the results screen                */
      /* Which site blocks on the results screen are open. Kept here for the
         same reason as openCards: the screen is redrawn from scratch when
         "Show reasons" is pressed, so anything the page alone remembered
         (which <details> were open) snapped back to Site 1 only. */
      openSites: {}
    },

    result: null          /* the marked game, once the results are shown    */
  };

  /* Can this page go fullscreen at all? False inside a lesson iframe that
     lacks `allowfullscreen`, and on browsers without the feature (iPad
     Safari). When false the button is simply not drawn (SW-BUILD-SPEC
     §6.5, D46) — a button that cannot do what it says is worse than none. */
  function fullscreenAvailable() {
    try {
      return !!(document.fullscreenEnabled && document.documentElement.requestFullscreen);
    } catch (e) { return false; }
  }

  /* Customer-facing wording that lives in data/sites.json under "labels",
     with a fallback so a missing label never breaks a screen. */
  function label(key, fallback) {
    var labels = state.data && state.data.labels;
    return labels && typeof labels[key] === "string" ? labels[key] : fallback;
  }

  function sites() { return state.data ? state.data.sites : []; }
  function site() { return sites()[state.siteIndex]; }
  function nextSite() { return sites()[state.siteIndex + 1] || null; }
  function isLastSite() { return state.siteIndex === sites().length - 1; }

  function answersFor(theSite) {
    var key = String(theSite.id);
    if (!state.answers.sites[key]) state.answers.sites[key] = {};
    return state.answers.sites[key];
  }

  function step2RowsFor(theSite) { return MARKING.rowsOf(state.files[theSite.step2File]); }
  function step34RowsFor(theSite) { return MARKING.rowsOf(state.files[theSite.step34File]); }

  /* ======================================================================
     3. STARTING UP
     ====================================================================== */

  function checkWindowSize() {
    var ok = window.innerWidth >= MIN_WIDTH && window.innerHeight >= MIN_HEIGHT;
    tooSmall.hidden = ok;
  }
  window.addEventListener("resize", checkWindowSize);

  /* The slider bubbles are positioned in pixels against the real track
     width, so they have to be redrawn whenever that width changes. */
  window.addEventListener("resize", function () {
    if (state.phase === "step1" && state.ui.step1) paintAllSliders();
  });

  /* The embed check. It only ever blocks when it can positively identify a
     parent page on an address that is not allowed. If it cannot tell —
     no referrer, an unreadable one, anything unexpected — the simulation
     loads normally. Being too strict would lock a paying customer out of
     something they bought, with nobody available to fix it. */
  function embedCheckBlocks() {
    try {
      if (!CONFIG.blockDirectAccess) return false;
      if (window.self === window.top) return true;          /* not in a lesson at all */
      var referrer = document.referrer;
      if (!referrer) return false;                          /* cannot tell → let them in */
      var host = new URL(referrer).hostname;
      if (!host) return false;
      return CONFIG.allowedEmbedDomains.indexOf(host) === -1;
    } catch (e) {
      return false;                                          /* cannot tell → let them in */
    }
  }

  function loadJSON(path) {
    return fetch(path, { cache: "no-store" }).then(function (response) {
      if (!response.ok) throw new Error(path + " (" + response.status + ")");
      return response.json();
    });
  }

  function boot() {
    checkWindowSize();

    if (embedCheckBlocks()) {
      state.phase = "blocked";
      render();
      return;
    }

    state.phase = "loading";
    render();

    loadJSON("data/sites.json").then(function (data) {
      state.data = data;
      var names = [];
      data.sites.forEach(function (s) {
        if (names.indexOf(s.step2File) === -1) names.push(s.step2File);
        if (names.indexOf(s.step34File) === -1) names.push(s.step34File);
      });
      return Promise.all(names.map(function (name) {
        return loadJSON("data/" + name).then(function (file) {
          state.files = state.files || {};
          state.files[name] = file;
        });
      }));
    }).then(function () {
      /* The data is checked before anybody can play. A simulation running
         on broken data would quietly mark people wrong, which is worse
         than refusing to start. */
      var check = MARKING.validateData(state.data, state.files);
      if (!check.ok) {
        state.dataErrors = check.errors;
        state.phase = "dataerror";
        render();
        return;
      }
      state.timer.total = state.data.timeLimitMinutes * 60;
      state.timer.secondsLeft = state.timer.total;
      state.phase = CONFIG.requireLogin ? "login" : "welcome";
      render();
    }).catch(function (err) {
      state.loadError = err.message;
      state.phase = "loaderror";
      render();
    });
  }

  /* ---- the login ---- */

  function checkPasscode(username, password) {
    if (username !== CONFIG.username) return Promise.resolve(false);
    if (!window.crypto || !window.crypto.subtle) {
      return Promise.reject(new Error("no-crypto"));
    }
    var bytes = new TextEncoder().encode(password);
    return window.crypto.subtle.digest("SHA-256", bytes).then(function (buffer) {
      var hex = Array.prototype.map.call(new Uint8Array(buffer), function (b) {
        return ("0" + b.toString(16)).slice(-2);
      }).join("");
      return hex === CONFIG.passcodeHash;
    });
  }

  /* ======================================================================
     4. THE CLOCK

     One number — how many seconds are left — counted down once a second,
     and ONLY while the clock is running. The old version worked out the
     time left from a fixed finishing time, which is why pausing only ever
     paused the display while the real clock kept going.
     ====================================================================== */

  setInterval(function () {
    if (!state.timer.running) return;
    state.timer.secondsLeft -= 1;
    paintTimer();
  }, 1000);

  function startClock() {
    state.timer.everStarted = true;
    state.timer.running = true;
  }
  function pauseClock() { state.timer.running = false; }
  function resumeClock() { if (state.timer.everStarted) state.timer.running = true; }

  function timerText() {
    if (state.timer.everStarted && state.timer.secondsLeft <= 0) return "Time's up";
    return Math.round(state.timer.secondsLeft / 60) + " min left";
  }
  function timerPaused() {
    return !state.timer.running;
  }

  /* Only the timer is redrawn each second, not the whole screen — redrawing
     everything would interrupt a slider being dragged. */
  function paintTimer() {
    var textEl = document.getElementById("timer-text");
    var fillEl = document.getElementById("time-bar-fill");
    if (!textEl || !fillEl) return;
    textEl.textContent = timerText();
    textEl.className = "timer-text" + (state.timer.secondsLeft <= 0 && state.timer.everStarted ? " is-up" : "");
    var pausedEl = document.getElementById("timer-paused");
    if (pausedEl) pausedEl.classList.toggle("is-visible", timerPaused());
    var left = Math.max(0, state.timer.secondsLeft);
    fillEl.style.width = (state.timer.total ? (left / state.timer.total) * 100 : 100) + "%";
  }

  /* The clock reading stamped on every answer. Marking uses it to work out
     which answers were given after time ran out. */
  function secondsLeft() { return state.timer.secondsLeft; }

  /* ======================================================================
     5. RECORDING ANSWERS
     ====================================================================== */

  function recordStep1(items) {
    answersFor(site()).step1 = { items: items, secondsLeft: secondsLeft() };
  }
  function recordStep2(microbeName, choice) {
    var given = answersFor(site());
    if (!given.step2) given.step2 = {};
    given.step2[microbeName] = { choice: choice, secondsLeft: secondsLeft() };
  }
  function recordStep3(microbeName) {
    var given = answersFor(site());
    if (!given.step3) given.step3 = [];
    given.step3.push({ microbe: microbeName, secondsLeft: secondsLeft() });
  }
  function recordStep4(names) {
    answersFor(site()).step4 = { microbes: names.slice(), secondsLeft: secondsLeft() };
  }
  /* Step 5 is asked on this site's screens but belongs to the PREVIOUS
     site — it re-judges what that site sent forward. It is stored under the
     previous site so that the marked result reads the way the answer key
     is laid out. */
  function recordStep5(microbeName, choice) {
    var previous = sites()[state.siteIndex - 1];
    var given = answersFor(previous);
    if (!given.step5) given.step5 = {};
    given.step5[microbeName] = { choice: choice, secondsLeft: secondsLeft() };
  }

  /* ======================================================================
     6. DRAWING: THE SHARED PIECES
     ====================================================================== */

  function headerHTML() {
    /* The button shows a cross when we are already fullscreen and the
       expand arrows otherwise, so it always says what pressing it will do.
       The browser's own Escape key is handled too — see the
       fullscreenchange listener near the bottom of this file. It is not
       drawn at all where fullscreen is impossible. */
    var isBig = !!(typeof document !== "undefined" && document.fullscreenElement);
    var fullscreenButton = fullscreenAvailable()
      ? '<button class="btn-fullscreen" data-action="fullscreen" title="' +
        (isBig ? "Exit full screen" : "Full screen") + '">' +
        (isBig ? "\u2715" : "\u26F6") + '</button>'
      : "";
    /* The clock keeps showing the time while paused; "Timer paused" is
       printed beneath it, as the real game does (D49). The label is always
       in the page and only made visible, so the header never changes height. */
    return '' +
      '<div class="header-bar">' +
        '<div class="header-left">' +
          '<button class="btn-restart" data-action="restart">Restart</button>' +
        '</div>' +
        '<div class="header-centre">' +
          '<span class="timer-stack">' +
            '<span class="timer-text" id="timer-text">' + esc(timerText()) + '</span>' +
            '<span class="timer-paused" id="timer-paused">' + esc(label("timer_paused", "Timer paused")) + '</span>' +
          '</span>' +
          '<div class="time-bar"><div class="time-bar-fill" id="time-bar-fill"></div></div>' +
        '</div>' +
        '<div class="header-right">' + fullscreenButton + '</div>' +
      '</div>';
  }

  /* The right-hand panel: what this site is looking for. Every value comes
     from data/sites.json, which is why the old version's bug — one Site 3
     screen showing different ranges from all the others — cannot happen
     here. There is only one place the numbers can come from. */
  function sitePanelHTML(theSite, previewSite) {
    var html = '<div class="site-panel">';
    html += '<h3>' + esc(MARKING.siteLabel(theSite)) + '</h3>';
    html += '<div class="group-title">Attributes</div>';
    MARKING.attributeNames(theSite).forEach(function (name) {
      html += '<div class="line">' + esc(name) + ': ' + esc(rangeText(theSite.ranges[name])) + '</div>';
    });
    html += '<div class="group-title">Trait</div>';
    html += '<div class="line">Desired: ' + esc(theSite.desired) + '</div>';
    html += '<div class="line">Undesired: ' + esc(theSite.undesired) + '</div>';

    /* During Step 2 the candidate is also shown the one thing they know
       about the next site — sometimes an attribute, sometimes a trait. */
    if (previewSite && theSite.nextSitePreview) {
      var preview = theSite.nextSitePreview;
      html += '<div class="preview">';
      html += '<h3>' + esc(MARKING.nextSiteLabel(theSite)) + '</h3>';
      if (preview.kind === "attribute") {
        html += '<div class="group-title">Attributes</div>';
        html += '<div class="line">' + esc(preview.name) + ': ' + esc(rangeText(preview.range)) + '</div>';
      } else {
        html += '<div class="group-title">Trait</div>';
        html += '<div class="line">Undesired: ' + esc(preview.trait) + '</div>';
      }
      html += '</div>';
    }
    html += '</div>';
    return html;
  }

  /* The right-hand column: the site panel at the top and the one primary
     button pinned to the bottom-right corner of the main box. */
  function sideHTML(theSite, options) {
    options = options || {};
    var bottom = "";
    if (options.button) {
      bottom = '<div class="side-action"><button class="btn" data-action="' +
        esc(options.button.action) + '"' + (options.button.disabled ? " disabled" : "") + '>' +
        esc(options.button.label) + '</button></div>';
    } else if (options.bottom) {
      /* Steps 3 and 4 have no primary button here — Submit is at the
         top-left — so the Legend takes this corner instead, which is
         where the current version puts it too. */
      bottom = '<div class="side-action">' + options.bottom + '</div>';
    }
    return '<div class="side">' +
      sitePanelHTML(theSite, options.preview) +
      '<div class="side-spacer"></div>' +
      bottom +
      '</div>';
  }

  /* Three rows of numbers plus the trait row — the block that appears on
     every kind of card. */
  function statsHTML(microbe, theSite) {
    var html = "";
    MARKING.attributeNames(theSite).forEach(function (name) {
      html += '<div class="stat-row">' + iconTag(name) +
        '<span class="label">' + esc(name) + '</span>' +
        '<span class="value">' + esc(MARKING.microbeAttribute(microbe, name)) + '</span></div>';
    });
    var trait = MARKING.microbeTrait(microbe);
    html += '<div class="stat-row">' + iconTag(trait) +
      '<span class="label">' + esc(trait) + '</span></div>';
    return html;
  }

  function bigCardHTML(microbe, theSite) {
    return '<div class="big-card">' +
      '<div class="card-name">' + esc(MARKING.microbeName(microbe)) + '</div>' +
      '<div class="picture">' + microbeImg(MARKING.microbeName(microbe)) + '</div>' +
      statsHTML(microbe, theSite) +
      '</div>';
  }

  /* A placed microbe: a small strip that opens up when clicked. */
  function compactCardHTML(microbe, theSite, carried) {
    var name = MARKING.microbeName(microbe);
    var isOpen = !!state.ui.openCards[name];
    return '<div class="compact' + (carried ? " carried" : "") + (isOpen ? " open" : "") +
      '" data-compact="' + esc(name) + '">' +
      '<div class="compact-head" data-action="toggle-compact" data-name="' + esc(name) + '">' +
        '<div class="compact-thumb">' +
          '<img src="img/' + esc(name) + '.png" alt="" onerror="this.style.visibility=\'hidden\'">' +
        '</div>' +
        '<div class="compact-name-row">' +
          '<span class="name">' + esc(name) + '</span>' +
          '<span class="chev">▼</span>' +
        '</div>' +
      '</div>' +
      (carried ? '<span class="carried-tag">carried over</span>' : "") +
      '<div class="compact-body"' + (isOpen ? "" : " hidden") + '>' +
      statsHTML(microbe, theSite) + '</div>' +
      '</div>';
  }

  /* ======================================================================
     7. DRAWING: THE SCREENS
     ====================================================================== */

  function render() {
    checkWindowSize();
    document.body.classList.toggle("scrolls", state.phase === "results");

    switch (state.phase) {
      case "loading":    app.innerHTML = simpleMessage("Loading…", ""); break;
      case "loaderror":  app.innerHTML = loadErrorHTML(); break;
      case "dataerror":  app.innerHTML = dataErrorHTML(); break;
      case "blocked":    app.innerHTML = simpleMessage("Please open the simulation from your course",
                            "This page only runs inside a CaseMentor course lesson."); break;
      case "login":      app.innerHTML = loginHTML(); break;
      case "welcome":    app.innerHTML = gameFrame(step5OrStep1Preview()) + welcomePopupHTML(); break;
      case "step5":      app.innerHTML = gameFrame(step5HTML()); break;
      case "step1":      app.innerHTML = gameFrame(step1HTML()); break;
      case "step2":      app.innerHTML = gameFrame(step2HTML()); break;
      case "step2done":  app.innerHTML = gameFrame(step2HTML(), true) + popupHTML(
                            "Click Continue to move to the next step", "step2done-continue", "Continue"); break;
      case "step34":     app.innerHTML = gameFrame(step34HTML()); break;
      case "sitedone":   app.innerHTML = gameFrame(step34HTML(), true) + popupHTML(
                            isLastSite() ? "Congratulations!<br>You have completed the game"
                                         : MARKING.siteLabel(site()) + " Completed",
                            "sitedone-continue", "Continue"); break;
      case "results":    app.innerHTML = resultsHTML(); break;
    }

    if (state.ui.confirmRestart) app.innerHTML += restartConfirmHTML();
    paintTimer();
    if (state.phase === "step1") paintAllSliders();
  }

  function simpleMessage(title, body) {
    return '<div class="centre-screen"><div class="panel">' +
      '<h1>' + title + '</h1>' +
      (body ? '<p class="lede">' + esc(body) + '</p>' : "") +
      '</div></div>';
  }

  function loadErrorHTML() {
    return '<div class="centre-screen"><div class="panel">' +
      '<h1>The simulation could not start</h1>' +
      '<p class="lede">One of the data files could not be loaded. If you are opening this ' +
      'from your own computer, it needs to be served by a web address rather than opened ' +
      'as a file.</p><p class="lede">Details: ' + esc(state.loadError) + '</p></div></div>';
  }

  function dataErrorHTML() {
    var list = state.dataErrors.map(function (e) {
      return '<li>' + esc(e.text) + '</li>';
    }).join("");
    return '<div class="centre-screen"><div class="panel wide">' +
      '<h1>There is a problem with the data files</h1>' +
      '<p class="lede">The simulation will not start until these are fixed, because it would ' +
      'otherwise mark candidates against faulty information. Each line says which file and ' +
      'which row.</p><ul class="error-list">' + list + '</ul></div></div>';
  }

  function loginHTML() {
    return '<div class="centre-screen"><div class="panel">' +
      '<h1>Sea Wolf Simulation</h1>' +
      '<p class="lede">Please sign in to begin.</p>' +
      '<form id="login-form">' +
      '<div class="field"><label for="u">Username</label>' +
      '<input id="u" type="text" autocomplete="username" autocapitalize="off" spellcheck="false"></div>' +
      '<div class="field"><label for="p">Password</label>' +
      '<input id="p" type="password" autocomplete="current-password"></div>' +
      '<div class="form-error">' + esc(state.ui.loginError) + '</div>' +
      '<button class="btn" type="submit" style="width:100%">Log in</button>' +
      '</form>' +
      /* A quiet version line, bottom-right of the login card. It is the
         fastest way to confirm an upload actually landed. */
      '</div></div>';
  }

  /* The frame every game screen shares: the header on top, then the main
     box with the workspace on the left and the site panel on the right. */
  function gameFrame(inner, blurred) {
    return headerHTML() +
      '<div class="stage"><div class="main-box' + (blurred ? " is-blurred" : "") + '">' +
      inner + '</div></div>';
  }

  /* Every step popup is the same size, so the title is centred inside a
     flexible middle section rather than deciding the height of the box. */
  function popupHTML(titleHTML, action, label) {
    return '<div class="modal-backdrop"><div class="modal">' +
      '<div class="modal-body"><h2>' + titleHTML + '</h2></div>' +
      '<div class="modal-actions"><button class="btn" data-action="' + esc(action) + '">' +
      esc(label) + '</button></div></div></div>';
  }

  function welcomePopupHTML() {
    return popupHTML("Welcome to " + esc(MARKING.siteLabel(site())), "begin", "Begin");
  }

  function restartConfirmHTML() {
    return '<div class="modal-backdrop"><div class="modal modal-ask">' +
      '<div class="modal-body">' +
      '<h2>Restart the simulation?</h2>' +
      '<p>Your answers will be lost.</p></div>' +
      '<div class="modal-actions">' +
      '<button class="btn btn-quiet" data-action="restart-cancel">Cancel</button>' +
      '<button class="btn" data-action="restart-confirm">Restart</button>' +
      '</div></div></div>';
  }

  /* Behind the welcome popup we show whichever screen comes next, so the
     blurred background is the real thing rather than something invented. */
  function step5OrStep1Preview() {
    return needsStep5() ? step5HTML(true) : step1HTML(true);
  }

  /* ---------------------------------------------------------------
     Step 1 — characteristics
     --------------------------------------------------------------- */

  function freshStep1() {
    var ui = { on: [], ranges: {} };
    /* Every slider starts at the bottom of the scale, as it does now. */
    MARKING.attributeNames(site()).forEach(function (name) {
      ui.ranges[name] = [1, state.data.sliderSpan];
    });
    return ui;
  }

  function step1HTML(forPreview) {
    var ui = state.ui.step1 || freshStep1();
    var theSite = site();
    var atLimit = ui.on.length >= 2;

    var attributes = MARKING.attributeNames(theSite).map(function (name) {
      var isOn = ui.on.indexOf(name) !== -1;
      var range = ui.ranges[name];
      return '' +
        '<div class="char-row">' +
          iconTag(name) +
          '<span class="name">' + esc(name) + '</span>' +
          switchHTML(name, isOn, !isOn && atLimit) +
        '</div>' +
        '<div class="range-row">' +
          '<span class="range-end">1</span>' +
          '<div class="range' + (isOn ? "" : " off") + '" data-range="' + esc(name) + '">' +
            '<div class="rail"></div>' +
            '<div class="selected"></div>' +
            '<span class="bubble bubble-from">' + range[0] + '</span>' +
            '<span class="bubble bubble-to">' + range[1] + '</span>' +
            '<input type="range" min="1" max="10" step="1" value="' + range[0] +
              '" data-handle="from" data-attr="' + esc(name) + '"' + (isOn ? "" : " disabled") + '>' +
            '<input type="range" min="1" max="10" step="1" value="' + range[1] +
              '" data-handle="to" data-attr="' + esc(name) + '"' + (isOn ? "" : " disabled") + '>' +
          '</div>' +
          '<span class="range-end">10</span>' +
        '</div>';
    }).join("");

    var traits = MARKING.TRAIT_NAMES.map(function (name) {
      var isOn = ui.on.indexOf(name) !== -1;
      return '<div class="char-row">' + iconTag(name) +
        '<span class="name">' + esc(name) + '</span>' +
        switchHTML(name, isOn, !isOn && atLimit) + '</div>';
    }).join("");

    var workspace =
      '<div class="workspace"><div class="step1">' +
        '<div class="step1-col">' +
          '<div class="char-title">Characteristics</div>' +
          '<div class="group-label">Attributes</div>' +
          '<div class="char-group">' + attributes + '</div>' +
          '<div class="group-label">Traits</div>' +
          '<div class="char-group">' + traits + '</div>' +
        '</div>' +
      '</div></div>';

    return workspace + sideHTML(theSite, {
      button: forPreview ? null : { label: "Continue", action: "step1-continue", disabled: ui.on.length !== 2 }
    });
  }

  function switchHTML(name, isOn, isDisabled) {
    return '<label class="switch">' +
      '<input type="checkbox" data-char="' + esc(name) + '"' +
      (isOn ? " checked" : "") + (isDisabled ? " disabled" : "") + '>' +
      '<span class="track"></span></label>';
  }

  /* The two handles are always the same distance apart, so the pair
     selects a fixed number of consecutive values (three, in Sea Wolf).
     Dragging either handle moves both. This is how the real game behaves
     and is the reason a two-wide target like Site 2's Size 1-2 is answered
     as 1-3. */
  function moveSlider(attribute, handle, rawValue) {
    var span = state.data.sliderSpan;
    var value = Math.max(1, Math.min(10, parseInt(rawValue, 10)));
    var from, to;
    if (handle === "from") {
      from = Math.min(value, 10 - (span - 1));
      to = from + span - 1;
    } else {
      to = Math.max(value, span);
      from = to - span + 1;
    }
    state.ui.step1.ranges[attribute] = [from, to];
    paintSlider(attribute);
  }

  /* How wide the round slider handle is. Must match the width given to
     `::-webkit-slider-thumb` and `::-moz-range-thumb` in css/app.css. */
  var THUMB_WIDTH = 16;

  /* Sliders are painted in place rather than by redrawing the screen,
     because redrawing mid-drag would drop the drag.

     WHY THE POSITION IS NOT A SIMPLE PERCENTAGE
     -------------------------------------------
     A round handle cannot reach the ends of its track: at value 1 its
     CENTRE sits half a handle-width in from the left edge, and at value 10
     half a handle-width in from the right. So the handle travels across
     (track width − one handle width), not the whole track width.

     The little number bubbles used to be placed at a plain percentage of
     the full track, which is a different scale. The two agreed in the
     middle and drifted apart towards the ends — the further out, the worse
     — which is the drift you noticed. Both the bubbles and the blue
     selected bar now use the handle's real travel, so they stay locked to
     the handles at every value. */
  function paintSlider(attribute) {
    var wrap = app.querySelector('.range[data-range="' + attribute + '"]');
    if (!wrap) return;
    var range = state.ui.step1.ranges[attribute];

    var trackWidth = wrap.clientWidth;
    /* Before the element has been laid out its width is 0; fall back to the
       plain percentage rather than dividing by zero. */
    var travel = trackWidth > THUMB_WIDTH ? trackWidth - THUMB_WIDTH : 0;

    /* Where the CENTRE of the handle for `value` actually sits, in pixels
       from the left edge of the track. */
    var centre = function (value) {
      if (!travel) return ((value - 1) / 9) * trackWidth;
      return (THUMB_WIDTH / 2) + ((value - 1) / 9) * travel;
    };

    wrap.querySelector('input[data-handle="from"]').value = range[0];
    wrap.querySelector('input[data-handle="to"]').value = range[1];

    var fromX = centre(range[0]);
    var toX = centre(range[1]);

    var selected = wrap.querySelector(".selected");
    selected.style.left = fromX + "px";
    selected.style.width = Math.max(0, toX - fromX) + "px";

    var from = wrap.querySelector(".bubble-from");
    var to = wrap.querySelector(".bubble-to");
    from.textContent = range[0];
    to.textContent = range[1];
    from.style.left = fromX + "px";
    to.style.left = toX + "px";
  }

  function paintAllSliders() {
    MARKING.attributeNames(site()).forEach(paintSlider);
  }

  /* ---------------------------------------------------------------
     Step 2 — sorting the ten microbes
     --------------------------------------------------------------- */

  function freshStep2() { return { index: 0, choice: null, placed: {} }; }

  /* The microbes carried over from the previous site's Step 5. They start
     already in this site's columns, as they do now, marked so it is clear
     they were not sorted here. */
  function carriedOver() {
    var result = { here: [], returned: [] };
    if (state.siteIndex === 0) return result;
    var previous = sites()[state.siteIndex - 1];
    var given = state.answers.sites[String(previous.id)];
    if (!given || !given.step5) return result;
    var hereLabel = MARKING.siteLabel(site());
    step2RowsFor(previous).forEach(function (row) {
      var answer = given.step5[MARKING.microbeName(row)];
      if (!answer) return;
      if (answer.choice === hereLabel) result.here.push(row);
      else result.returned.push(row);
    });
    return result;
  }

  function step2HTML() {
    var theSite = site();
    var rows = step2RowsFor(theSite);
    var ui = state.ui.step2;
    var carried = carriedOver();
    var done = ui.index >= rows.length;
    var current = done ? null : rows[ui.index];

    var hereLabel = MARKING.siteLabel(theSite);
    var forwardLabel = MARKING.nextSiteLabel(theSite);
    var lastSite = isLastSite();

    /* The first column: the microbe being judged, and the choice list. */
    var choices = [{ label: hereLabel, value: hereLabel }];
    if (!lastSite) choices.push({ label: forwardLabel, value: forwardLabel });
    choices.push({ label: "Return", value: MARKING.RETURN });

    var firstColumn =
      '<div class="column">' +
        '<div class="column-head"><span class="title">Microbes</span>' +
        '<span class="counter">' + (rows.length - ui.index) + '</span></div>';
    if (current) {
      firstColumn += bigCardHTML(current, theSite);
      firstColumn += '<div class="choices">' + choices.map(function (c) {
        var selected = ui.choice === c.value;
        return '<label class="choice' + (selected ? " selected" : "") + '">' +
          '<span class="label">' + esc(c.label) + '</span>' +
          '<input type="radio" name="choice" value="' + esc(c.value) + '"' +
          (selected ? " checked" : "") + '></label>';
      }).join("") + '</div>';
    } else {
      firstColumn += '<div class="empty-note">All microbes sorted.</div>';
    }
    firstColumn += '</div>';

    /* One column per destination, in the order this site, next site,
       Returned — the order the current version uses. */
    function destinationColumn(label, key, carriedRows) {
      var placed = ui.placed[key] || [];
      var cards = (carriedRows || []).map(function (row) {
        return compactCardHTML(row, theSite, true);
      }).concat(placed.map(function (row) {
        return compactCardHTML(row, theSite, false);
      })).join("");
      return '<div class="column">' +
        '<div class="column-head"><span class="title">' + esc(label) + '</span>' +
        '<span class="counter">' + placed.length + '</span></div>' +
        '<div class="drop-box">' + cards + '</div></div>';
    }

    var columns = firstColumn;
    columns += destinationColumn(hereLabel, hereLabel, carried.here);
    if (!lastSite) columns += destinationColumn(forwardLabel, forwardLabel, []);
    columns += destinationColumn("Returned", MARKING.RETURN, carried.returned);
    /* The last site has no "next site" column. Leave its space empty rather
       than letting the other three spread out — see the note in Step 5. */
    if (lastSite) columns += '<div class="column-spacer"></div>';

    var workspace = '<div class="workspace"><div class="columns ' +
      (lastSite ? "three" : "four") + '">' + columns + '</div></div>';

    var button = done
      ? { label: "Complete", action: "step2-complete", disabled: false }
      : { label: "Continue", action: "step2-continue", disabled: ui.choice === null };

    return workspace + sideHTML(theSite, { button: button, preview: true });
  }

  /* ---------------------------------------------------------------
     Step 5 — confirming what was sent forward
     --------------------------------------------------------------- */

  function pushedForward() {
    if (state.siteIndex === 0) return [];
    var previous = sites()[state.siteIndex - 1];
    var given = state.answers.sites[String(previous.id)];
    if (!given || !given.step2) return [];
    var forwardLabel = MARKING.nextSiteLabel(previous);
    return step2RowsFor(previous).filter(function (row) {
      var answer = given.step2[MARKING.microbeName(row)];
      return answer && answer.choice === forwardLabel;
    });
  }

  /* If nothing was sent forward there is nothing to confirm, so Step 5 is
     skipped entirely — the same as the current version. */
  function needsStep5() {
    return state.siteIndex > 0 && pushedForward().length > 0;
  }

  function freshStep5() { return { index: 0, choice: null, placed: {} }; }

  function step5HTML(forPreview) {
    var theSite = site();
    var rows = pushedForward();
    var ui = state.ui.step5 || freshStep5();
    var done = ui.index >= rows.length;
    var current = done ? null : rows[ui.index];
    var hereLabel = MARKING.siteLabel(theSite);

    var firstColumn =
      '<div class="column">' +
        '<div class="column-head"><span class="title">Microbes</span>' +
        '<span class="counter">' + (rows.length - ui.index) + '</span></div>';
    if (current) {
      firstColumn += bigCardHTML(current, theSite);
      firstColumn += '<div class="choices">' +
        [{ label: hereLabel, value: hereLabel }, { label: "Return", value: MARKING.RETURN }]
        .map(function (c) {
          var selected = ui.choice === c.value;
          return '<label class="choice' + (selected ? " selected" : "") + '">' +
            '<span class="label">' + esc(c.label) + '</span>' +
            '<input type="radio" name="choice" value="' + esc(c.value) + '"' +
            (selected ? " checked" : "") + '></label>';
        }).join("") + '</div>';
    } else {
      firstColumn += '<div class="empty-note">All microbes confirmed.</div>';
    }
    firstColumn += '</div>';

    function destinationColumn(label, key) {
      var placed = ui.placed[key] || [];
      return '<div class="column">' +
        '<div class="column-head"><span class="title">' + esc(label) + '</span>' +
        '<span class="counter">' + placed.length + '</span></div>' +
        '<div class="drop-box">' + placed.map(function (row) {
          return compactCardHTML(row, theSite, false);
        }).join("") + '</div></div>';
    }

    /* Step 5 has one destination fewer than Step 2, but the columns keep
       Step 2's widths and the right-hand space is simply left empty — the
       same as the current simulation. Nothing the candidate has learned to
       find moves between the two steps. */
    var workspace = '<div class="workspace"><div class="columns three">' +
      firstColumn + destinationColumn(hereLabel, hereLabel) +
      destinationColumn("Returned", MARKING.RETURN) +
      '<div class="column-spacer"></div>' + '</div></div>';

    var button = done
      ? { label: "Complete", action: "step5-complete", disabled: false }
      : { label: "Continue", action: "step5-continue", disabled: ui.choice === null };

    return workspace + sideHTML(theSite, { button: forPreview ? null : button });
  }

  /* ---------------------------------------------------------------
     Steps 3 and 4 — one screen, two phases
     --------------------------------------------------------------- */

  function freshStep34() {
    return { phase: 3, round: 0, picks: [], slots: [null, null, null] };
  }

  function step34HTML() {
    var theSite = site();
    var rows = step34RowsFor(theSite);
    var groups = MARKING.groupByCategory(rows);
    var existing = groups[MARKING.EXISTING] || [];
    var ui = state.ui.step34;

    var pickedRows = ui.picks.map(function (name) { return findRow(rows, name); });

    /* --- the top row --- */
    var topCards;
    if (ui.phase === 3) {
      var setName = MARKING.SET_NAMES[ui.round];
      var members = groups[setName] || [];
      topCards = members.map(function (row) {
        return candidateCardHTML(row, theSite,
          '<button class="round-btn" data-action="pick" data-name="' +
          esc(MARKING.microbeName(row)) + '">+</button>');
      }).join("");
    } else {
      topCards = ui.slots.map(function (name, index) {
        if (!name) {
          return '<div class="slot-empty">Microbe ' + (index + 1) + '</div>';
        }
        return candidateCardHTML(findRow(rows, name), theSite,
          '<button class="round-btn remove" data-action="unslot" data-slot="' + index + '">−</button>');
      }).join("");
    }

    var submitDisabled = !(ui.phase === 4 && ui.slots.every(function (s) { return s !== null; }));
    var top =
      '<div class="s34-top">' +
        '<button class="btn btn-submit-topleft" data-action="step34-submit"' +
          (submitDisabled ? " disabled" : "") + '>Submit</button>' +
        '<div class="s34-cards">' + topCards + '</div>' +
      '</div>';

    /* --- the grid of ten: the six Existing, then the picks --- */
    var gridRows = existing.concat(pickedRows);
    var cells = "";
    for (var i = 0; i < 10; i++) {
      var row = gridRows[i];
      if (!row) { cells += '<div class="mini-slot"><div class="mini-empty"></div></div>'; continue; }
      var name = MARKING.microbeName(row);
      var inSlot = ui.slots.indexOf(name) !== -1;
      var plus = "";
      if (ui.phase === 4) {
        var full = ui.slots.every(function (s) { return s !== null; });
        plus = '<button class="round-btn" data-action="slot" data-name="' + esc(name) + '"' +
          (inSlot || full ? " disabled" : "") + '>+</button>';
      }
      /* WK asked that once all three slots are full, or a microbe is already
         in a slot, the WHOLE tile dims rather than just its button — greying
         only the button was too quiet to read as "not available". */
      var dimmed = ui.phase === 4 &&
        (inSlot || ui.slots.every(function (s) { return s !== null; }));

      /* The card follows the original application's layout: the name alone
         on the top row with the + button in the corner beside it, and the
         three attribute numbers followed by the trait icon on the row
         below. See the .mini-card notes in app.css for why the trait icon
         must not be pushed to the right-hand edge. */
      cells += '<div class="mini-slot' + (dimmed ? " is-dimmed" : "") + '">' +
        '<div class="mini-pic">' + microbeImg(name) + '</div>' +
        '<div class="mini-card">' +
          '<div class="mini-name">' + esc(name) + '</div>' +
          '<div class="mini-stats">' + miniStatsHTML(row, theSite) +
            miniTraitHTML(row) +
          '</div>' +
          plus +
        '</div></div>';
    }

    var legend = '<div class="legend-wrap">' +
      (state.ui.legendOpen ? '<div class="legend-panel">' +
        MARKING.attributeNames(theSite).concat(MARKING.TRAIT_NAMES).map(function (n) {
          return '<div class="legend-row">' + iconTag(n) + '<span>' + esc(n) + '</span></div>';
        }).join("") + '</div>' : "") +
      '<button class="legend-btn" data-action="legend">Legend</button></div>';

    var workspace = '<div class="workspace"><div class="s34">' + top +
      '<div class="s34-bottom"><div class="s34-arc"></div><div class="grid">' + cells + '</div></div>' +
      '</div></div>';

    /* Steps 3 and 4 are the one screen where the primary button is not at
       the bottom-right: Submit sits at the top-left, and the Legend takes
       the bottom-right corner instead. */
    return workspace + sideHTML(theSite, { bottom: legend });
  }

  function candidateCardHTML(microbe, theSite, buttonHTML) {
    if (!microbe) return '<div class="slot-empty">—</div>';
    var name = MARKING.microbeName(microbe);
    /* The name and the button share one header row. The empty spacer on the
       left is the same width as the button, so the name lands in the middle
       of the card rather than in the middle of whatever is left beside the
       button. When there is no button the spacer is omitted too, so the name
       is still centred. */
    var head = buttonHTML
      ? '<div class="card-head">' +
          '<span class="card-head-spacer"></span>' +
          '<div class="card-name">' + esc(name) + '</div>' +
          buttonHTML +
        '</div>'
      : '<div class="card-head"><div class="card-name">' + esc(name) + '</div></div>';
    return '<div class="cand-card">' +
      head +
      '<div class="picture">' + microbeImg(name) + '</div>' +
      statsHTML(microbe, theSite) +
      '</div>';
  }

  /* The three attribute numbers. The trait icon is added separately by
     miniTraitHTML, straight after the third number (D40).

     Each icon is wrapped WITH its own number in a .stat-pair.

     Without the wrapper the row held seven loose items, and the spreading
     put the same gap between an icon and its own number as between that
     number and the NEXT icon - measured 26px and 26px at 1920px wide. A
     number then looked equally attached to the icon on either side of it,
     which is ambiguous and, as WK put it, makes no sense.

     Pairing them means the row spreads FOUR objects (three attributes and
     the trait) rather than seven, and the icon-to-number distance inside
     each pair stays small and fixed at every window size. */
  function miniStatsHTML(microbe, theSite) {
    return MARKING.attributeNames(theSite).map(function (name) {
      return '<span class="stat-pair">' + iconTag(name) +
        '<span class="num">' +
        esc(MARKING.microbeAttribute(microbe, name)) + '</span></span>';
    }).join("");
  }

  function miniTraitHTML(microbe) {
    return '<span class="trait-icon">' + iconTag(MARKING.microbeTrait(microbe)) + '</span>';
  }

  function findRow(rows, name) {
    for (var i = 0; i < rows.length; i++) {
      if (MARKING.microbeName(rows[i]) === name) return rows[i];
    }
    return null;
  }

  /* ======================================================================
     8. THE RESULTS SCREEN
     ====================================================================== */

  function isDemo() { return state.data && state.data.results_mode === "demo"; }

  function resultsHTML() {
    var result = state.result;
    var theSites = sites();
    var demo = isDemo();

    var tiles = theSites.map(function (s, index) {
      var r = result.sites[String(s.id)].step4;
      var isBest = r.bestOverall !== null && r.score === r.bestOverall;
      return '<div class="tile' + (isBest ? " is-best" : "") + '">' +
        '<div class="tile-name">' + esc(MARKING.siteLabel(s)) + '</div>' +
        '<div class="tile-score">' + r.score + '%</div>' +
        '<div class="tile-best">best possible ' + (r.bestOverall === null ? "—" : r.bestOverall + "%") + '</div>' +
        '</div>';
    }).join("");

    var summary = result.summary;
    var summaryLine = '<div class="summary-line">' +
      'Decisions correct: <strong>' + summary.decisionsCorrect + ' of ' + summary.decisionsOf + '</strong>' +
      '<span class="sep">|</span>' +
      'Answers after time ran out: <strong>' + summary.lateAnswers + '</strong>' +
      (summary.finished ? "" : '<span class="sep">|</span>Not all sites were completed') +
      '</div>';

    /* In demo mode every detail block is drawn greyed out and locked:
       heading and score visible, nothing inside, nothing to expand. The
       CSV and Print buttons go too, because the CSV lists the expected
       answers (D48). */
    var blocks = theSites.map(function (s) {
      return demo
        ? lockedSiteBlockHTML(s, result.sites[String(s.id)])
        : siteBlockHTML(s, result.sites[String(s.id)], !!state.ui.openSites[String(s.id)]);
    }).join("");

    var demoNote = demo
      ? '<div class="demo-note"><span class="lock" aria-hidden="true">' + LOCK_ICON + '</span>' +
        '<span>' + esc(label("demo_note", "This is the free demo, which shows your score and percentile only.")) + '</span></div>'
      : "";

    return '<div class="results"><div class="results-inner">' +
      '<div class="results-top"><h1>Your result</h1>' +
      '<div class="results-actions">' +
        (demo ? "" : '<button class="btn btn-quiet" data-action="print">Print</button>' +
                     '<button class="btn btn-quiet" data-action="csv">Download CSV</button>') +
        '<button class="btn" data-action="restart">Restart</button>' +
      '</div></div>' +
      standingHTML(result.benchmark) +
      '<div class="tiles">' + tiles + '</div>' +
      summaryLine + demoNote + blocks +
      '</div></div>';
  }

  /* A small padlock, drawn inline so nothing is loaded from anywhere. */
  var LOCK_ICON = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="11" width="16" height="10" rx="2"></rect><path d="M8 11V7a4 4 0 0 1 8 0v4"></path></svg>';

  /* "th", "st", "nd", "rd" — the ordinal suffix alone, drawn smaller than
     the number, as Redrock draws it. */
  function ordinal(n) {
    var tens = n % 100, ones = n % 10;
    if (tens >= 11 && tens <= 13) return "th";
    return ones === 1 ? "st" : ones === 2 ? "nd" : ones === 3 ? "rd" : "th";
  }

  /* Which colour family a zone is drawn in, decided by its POSITION in the
     content's list, never by its label. The first zone (below the pass
     region) is neutral grey; counting down from the top, the highest zone
     is green, the one under it light green, and any others amber. With four
     zones that gives grey / amber / light green / green. Never red: a
     candidate below the line should be motivated, not punished. Copied from
     Redrock (zoneTone) so the two products draw the same card (D54). */
  function zoneTone(index, count) {
    if (index === 0) return "grey";
    var fromTop = count - 1 - index;
    return fromTop === 0 ? "green" : fromTop === 1 ? "lightgreen" : "amber";
  }

  /* THE "WHERE YOU STAND" CARD (D48, D54). Drawn above the score tiles from
     the numbers the marking engine worked out — nothing is computed here.
     The markup is Redrock's standingHtml() with Sea Wolf's names, so the
     two products look the same: big number with a smaller ordinal and the
     word "percentile"; a filled pill; one sentence; a thin decile band with
     the numbers 1–10 beneath it, a blue marker at exactly the percentile;
     a legend reading "70–79 · Borderline"; the content note under a rule.
     No caption (R-D47): "Where you stand" is the accessibility label only. */
  function standingHTML(b) {
    if (!b) return "";
    var zones = b.zones;
    var p = b.percentile;
    var zoneIndex = zones.indexOf(b.zone);
    var tone = zoneIndex >= 0 ? zoneTone(zoneIndex, zones.length) : "grey";

    /* the ten cells, each coloured by the zone its decile starts in */
    var cells = "", nums = "";
    for (var d = 1; d <= 10; d++) {
      var z = MARKING.zoneFor((d - 1) * 10, b);
      cells += '<span class="band-cell tone-' + zoneTone(zones.indexOf(z), zones.length) + '"></span>';
      nums += '<span>' + d + '</span>';
    }

    /* The marker sits at exactly the percentile along the band. The band is
       ten equal cells with a 4px gap between them, so the position is the
       share of the cells' total width plus the gaps already passed. */
    var cellIndex = Math.min(9, Math.floor(p / 10));
    var left = 'calc((100% - 36px) * ' + (p / 100) + ' + ' + (cellIndex * 4) + 'px)';

    var legend = "";
    for (var i = 0; i < zones.length; i++) {
      var range = i === 0 ? ""
        : (i === zones.length - 1 ? zones[i].from + "+"
                                  : zones[i].from + "–" + (zones[i + 1].from - 1)) + " · ";
      legend += '<span class="legend-item"><i class="tone-' + zoneTone(i, zones.length) + '"></i>' +
        esc(range) + esc(zones[i].label) + '</span>';
    }

    return '<section class="standing tone-' + tone + '" aria-label="Where you stand">' +
      '<div class="standing-main">' +
        '<div class="standing-left">' +
          '<div class="standing-figure">' +
            '<span class="standing-number">' + p + '</span>' +
            '<span class="standing-ordinal">' + ordinal(p) + '</span>' +
            '<span class="standing-word">percentile</span>' +
          '</div>' +
          '<div class="standing-pill">Decile ' + b.decile + ' · top ' + b.topShare + '%' +
            ' · ' + esc(b.zone.label) + '</div>' +
          '<p class="standing-sentence">Estimated: your weighted score of <b>' +
            showScore(b.weighted) + ' / 100</b> beats about <b>' + p + ' in 100</b> candidates ' +
            'who practised this simulation.</p>' +
        '</div>' +
        '<div class="standing-right">' +
          '<div class="band" role="img" aria-label="Decile band, you are at the ' + p + ordinal(p) + ' percentile">' +
            '<div class="band-marker" style="left:' + left + '">' +
              '<span class="marker-label">You · ' + p + ordinal(p) + '</span>' +
              '<span class="marker-arrow"></span>' +
              '<span class="marker-line"></span>' +
            '</div>' +
            '<div class="band-cells">' + cells + '</div>' +
            '<div class="band-nums">' + nums + '</div>' +
          '</div>' +
          '<div class="band-legend">' + legend + '</div>' +
        '</div>' +
      '</div>' +
      (b.note ? '<p class="standing-note">' + esc(b.note) + '</p>' : "") +
    '</section>';
  }

  /* "100", "82.5" — a score with one decimal only when it needs one. */
  function showScore(n) {
    if (typeof n !== "number") return String(n);
    return (Math.round(n * 10) / 10 === Math.round(n)) ? String(Math.round(n))
                                                       : (Math.round(n * 10) / 10).toFixed(1);
  }

  /* Demo mode: the site block with its heading and score, greyed out and
     locked, nothing inside (D48; the decision against a ✓/✗ teaser is
     recorded there too). */
  function lockedSiteBlockHTML(theSite, r) {
    return '<div class="site-block is-locked">' +
      '<div class="locked-head"><span class="lock" aria-hidden="true">' + LOCK_ICON + '</span>' +
      esc(MARKING.siteLabel(theSite)) +
      '<span class="site-score">' + r.step4.score + '% · best possible ' +
      (r.step4.bestOverall === null ? "—" : r.step4.bestOverall + "%") + '</span></div>' +
      '</div>';
  }

  function siteBlockHTML(theSite, r, openByDefault) {
    var id = String(theSite.id);
    var reveal = !!state.ui.revealReasons[id];
    var body = "";

    body += stepBlock("Step 1: Characteristics", r.step1.correct + " / " + r.step1.of,
      r.step1.answered ? itemRows(r.step1.items.map(function (item) {
        return {
          name: item.expected.trait
            ? item.expected.trait
            : item.expected.attribute + " " + rangeText(item.expected.range),
          you: item.candidate
            ? (item.candidate.trait || (item.candidate.attribute + " " + rangeText(item.candidate.range)))
            : null,
          expected: item.expected.trait
            ? item.expected.trait
            : item.expected.attribute + " " + rangeText(item.expected.range),
          correct: item.correct, late: item.late, reason: item.reason, image: null
        };
      }), reveal) : notAnswered());

    body += stepBlock("Step 2: Categorisation", r.step2.correct + " / " + r.step2.of,
      itemRows(r.step2.items.map(function (item) {
        return {
          name: item.microbe, you: item.candidate, expected: item.expected,
          correct: item.correct, late: item.late, reason: item.reason, image: item.microbe
        };
      }), reveal));

    body += stepBlock("Step 3: Selection", r.step3.correct + " / " + r.step3.of,
      itemRows(r.step3.items.map(function (item) {
        return {
          name: item.set, you: item.candidate, expected: item.expected.join(" or "),
          correct: item.correct, late: item.late, reason: item.reason, image: item.candidate
        };
      }), reveal));

    body += step4Block(theSite, r.step4);

    if (r.step5.applicable) {
      body += stepBlock("Step 5: Confirmation for " + esc(MARKING.nextSiteLabel(theSite)),
        r.step5.correct + " / " + r.step5.of,
        itemRows(r.step5.items.map(function (item) {
          return {
            name: item.microbe, you: item.candidate, expected: item.expected,
            correct: item.correct, late: item.late, reason: item.reason, image: item.microbe
          };
        }), reveal));
    }

    body += '<button class="reveal" data-action="reveal" data-site="' + esc(id) + '">' +
      (reveal ? "Hide reasons for correct answers" : "Show reasons for correct answers") +
      '</button>';

    return '<details class="site-block" data-site="' + esc(id) + '"' + (openByDefault ? " open" : "") + '>' +
      '<summary>' + esc(MARKING.siteLabel(theSite)) +
      '<span class="site-score">' + r.step4.score + '% · best possible ' +
      (r.step4.bestOverall === null ? "—" : r.step4.bestOverall + "%") + '</span></summary>' +
      '<div class="site-body">' + body + '</div></details>';
  }

  function stepBlock(title, count, inner) {
    return '<div class="step-block"><div class="step-head">' +
      '<span class="step-title">' + title + '</span>' +
      '<span class="step-count">' + esc(count) + '</span></div>' + inner + '</div>';
  }

  function notAnswered() { return '<p class="not-answered">Not answered.</p>'; }

  /* One row per item. Correct rows show only a tick; the explanation is
     kept for the wrong ones, so the page does not become a wall of text.
     The "Show reasons for correct answers" button reveals the rest. */
  function itemRows(items, reveal) {
    var rows = items.map(function (item) {
      var showReason = !item.correct || reveal;
      return '<tr class="' + (item.correct ? "" : "wrong") + '">' +
        '<td class="c-mark ' + (item.correct ? "ok" : "bad") + '">' + (item.correct ? "✓" : "✗") + '</td>' +
        (item.image
          ? '<td class="c-thumb"><img src="img/' + esc(item.image) + '.png" alt="" onerror="this.style.visibility=\'hidden\'"></td>'
          : '<td class="c-thumb"></td>') +
        '<td class="c-name">' + esc(item.name) +
          (item.late ? '<span class="tag-late">after time</span>' : "") + '</td>' +
        '<td class="c-you">' + (item.you === null || item.you === undefined
          ? '<span class="not-answered">not answered</span>' : esc(item.you)) + '</td>' +
        '<td class="c-exp">' + (item.correct ? "" : "expected: " + esc(item.expected)) + '</td>' +
        '<td class="reason">' + (showReason ? esc(item.reason) : "") + '</td>' +
        '</tr>';
    }).join("");
    return '<table class="rows"><tbody>' + rows + '</tbody></table>';
  }

  function step4Block(theSite, s4) {
    if (!s4.answered) {
      return stepBlock("Step 4: Submission", "0%", notAnswered() +
        '<div class="best-line">Best possible at this site: <strong>' +
        (s4.bestOverall === null ? "—" : s4.bestOverall + "%") + '</strong></div>');
    }

    var rows = step34RowsFor(theSite);
    var trio = s4.candidate.map(function (name) { return findRow(rows, name); })
      .filter(function (r) { return r; })
      .map(function (r) { return compactCardHTML(r, theSite, false); }).join("");

    var averages = '<table class="avg-table"><thead><tr><th>Attribute</th><th>Average</th>' +
      '<th>Target</th><th></th></tr></thead><tbody>' +
      MARKING.attributeNames(theSite).map(function (name) {
        var average = s4.averages[name];
        if (average === undefined) return "";
        /* Whether it landed inside the target is a rule, so the marking
           engine says so directly. This screen only prints the answer. */
        var isOut = s4.withinRange[name] === false;
        return '<tr><td>' + esc(name) + '</td><td>' + average.toFixed(2) + '</td>' +
          '<td>' + esc(rangeText(theSite.ranges[name])) + '</td>' +
          '<td class="' + (isOut ? "out" : "in") + '">' + (isOut ? "outside" : "inside") + '</td></tr>';
      }).join("") + '</tbody></table>';

    var penalties = s4.penalties.length
      ? '<ul class="penalties">' + s4.penalties.map(function (p) {
          return '<li>' + esc(p) + '</li>';
        }).join("") + '</ul>'
      : '<p style="color:var(--success);font-weight:600">No penalties — a perfect submission.</p>';

    var combos = "";
    if (s4.bestCombosForYourPool && s4.bestCombosForYourPool.length) {
      combos = '<details><summary class="reveal" style="display:inline">' +
        s4.bestCombosForYourPool.length + ' combination' +
        (s4.bestCombosForYourPool.length === 1 ? "" : "s") +
        ' from your pool reach ' + s4.bestForYourPool + '%</summary>' +
        '<div class="combo-list">' + s4.bestCombosForYourPool.map(function (c) {
          return '<code>' + esc(c.join(" + ")) + '</code>';
        }).join("") + '</div></details>';
    }

    return stepBlock("Step 4: Submission",
      s4.score + "%" + (s4.late ? " (after time)" : ""),
      '<div class="trio">' + trio + '</div>' + averages + penalties +
      '<div class="best-line">Best from your pool: <strong>' +
      (s4.bestForYourPool === null ? "—" : s4.bestForYourPool + "%") +
      '</strong> · Best overall: <strong>' +
      (s4.bestOverall === null ? "—" : s4.bestOverall + "%") + '</strong>' +
      (s4.optimal ? ' · <span style="color:var(--success)">you found the best available</span>' : "") +
      '</div>' + combos);
  }

  /* ---- the CSV file ---- */

  function csvCell(value) {
    var text = value === null || value === undefined ? "" : String(value);
    return '"' + text.replace(/"/g, '""') + '"';
  }

  function buildCSV() {
    var lines = [["Site", "Step", "Item", "Your answer", "Expected", "Correct", "After time"]
      .map(csvCell).join(",")];

    sites().forEach(function (s) {
      var siteName = MARKING.siteLabel(s);
      var r = state.result.sites[String(s.id)];

      r.step1.items.forEach(function (item) {
        var expected = item.expected.trait || (item.expected.attribute + " " + rangeText(item.expected.range));
        var you = item.candidate
          ? (item.candidate.trait || (item.candidate.attribute + " " + rangeText(item.candidate.range)))
          : "";
        lines.push([siteName, "Step 1: Characteristics", expected, you, expected,
          item.correct ? "Yes" : "No", item.late ? "Yes" : "No"].map(csvCell).join(","));
      });

      r.step2.items.forEach(function (item) {
        lines.push([siteName, "Step 2: Categorisation", item.microbe, item.candidate || "",
          item.expected, item.correct ? "Yes" : "No", item.late ? "Yes" : "No"].map(csvCell).join(","));
      });

      r.step3.items.forEach(function (item) {
        lines.push([siteName, "Step 3: Selection", item.set, item.candidate || "",
          item.expected.join(" or "), item.correct ? "Yes" : "No",
          item.late ? "Yes" : "No"].map(csvCell).join(","));
      });

      lines.push([siteName, "Step 4: Submission", "Score",
        r.step4.answered ? r.step4.candidate.join(" + ") : "",
        "best for your pool " + r.step4.bestForYourPool + "%, best overall " + r.step4.bestOverall + "%",
        r.step4.score + "%", r.step4.late ? "Yes" : "No"].map(csvCell).join(","));

      if (r.step5.applicable) {
        r.step5.items.forEach(function (item) {
          lines.push([siteName, "Step 5: Confirmation", item.microbe, item.candidate || "",
            item.expected, item.correct ? "Yes" : "No", item.late ? "Yes" : "No"].map(csvCell).join(","));
        });
      }
    });

    if (state.result.benchmark) {
      lines.push(["Total", "Weighted score", "", String(state.result.benchmark.weighted), "", "", ""].map(csvCell).join(","));
      lines.push(["Total", "Percentile", "", String(state.result.benchmark.percentile), "", "", ""].map(csvCell).join(","));
    }

    return lines.join("\r\n");
  }

  /* The download uses a link the page builds itself, which is the same way
     the current version does it and is confirmed to work inside the course
     lesson's frame. */
  /* The file is named after the content's title, never a version id, since
     no version must ever reach a candidate (D55, as Redrock Q21/R-D46):
     "Sea Wolf Simulation" becomes sea-wolf-simulation-results.csv. */
  function csvFileName(title) {
    var slug = String(title || "simulation").toLowerCase()
      .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
    return (slug || "simulation") + "-results.csv";
  }

  function downloadCSV() {
    var link = document.createElement("a");
    link.href = "data:text/csv;charset=utf-8," + encodeURIComponent("﻿" + buildCSV());
    link.download = csvFileName(state.data && state.data.title);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }

  /* The candidate can leave fullscreen with the Escape key rather than the
     button, and the browser tells nobody. Without this the button would go
     on showing a cross after they were already back to normal. Redrawing on
     the browser's own event keeps the button honest however they leave. */
  document.addEventListener("fullscreenchange", function () {
    render();
  });

  /* Printing opens every site so the printed page is complete, then puts
     them back as they were. */
  window.addEventListener("beforeprint", function () {
    Array.prototype.forEach.call(document.querySelectorAll("details"), function (d) {
      d.dataset.wasOpen = d.open ? "1" : "0";
      d.open = true;
    });
  });
  window.addEventListener("afterprint", function () {
    Array.prototype.forEach.call(document.querySelectorAll("details"), function (d) {
      if (d.dataset.wasOpen === "0") d.open = false;
      delete d.dataset.wasOpen;
    });
  });

  /* ======================================================================
     9. MOVING THROUGH THE GAME
     ====================================================================== */

  function goToSite(index) {
    state.siteIndex = index;
    state.ui.step1 = null;
    state.ui.step2 = null;
    state.ui.step34 = null;
    state.ui.step5 = null;
    state.ui.openCards = {};
    state.phase = "welcome";
    pauseClock();
    render();
  }

  function finishSite() {
    if (isLastSite()) {
      pauseClock();
      state.result = MARKING.markGame(state.data, state.files, state.answers);
      /* Site 1 open, the rest collapsed, on arrival (SW-BUILD-SPEC §7). */
      state.ui.openSites = {};
      state.ui.openSites[String(sites()[0].id)] = true;
      state.phase = "results";
      render();
    } else {
      goToSite(state.siteIndex + 1);
    }
  }

  function restartGame() {
    state.siteIndex = 0;
    state.answers = { startedAt: new Date().toISOString(), sites: {} };
    state.timer.secondsLeft = state.timer.total;
    state.timer.running = false;
    state.timer.everStarted = false;
    state.ui.step1 = null;
    state.ui.step2 = null;
    state.ui.step34 = null;
    state.ui.step5 = null;
    state.ui.confirmRestart = false;
    state.ui.legendOpen = false;
    state.ui.openCards = {};
    state.ui.revealReasons = {};
    state.ui.openSites = {};
    state.result = null;
    state.phase = "welcome";
    render();
  }

  /* ---- clicks ---- */

  app.addEventListener("click", function (event) {
    var target = event.target.closest("[data-action]");
    if (!target) return;
    var action = target.dataset.action;

    switch (action) {

      /* FULLSCREEN.

         WK's ruling of 8 September 2026 (D37): real fullscreen matters more
         than hiding the address. So this asks the browser for true
         fullscreen — the simulation fills the whole monitor, and the
         browser's tabs, address bar and the surrounding lesson page all
         disappear.

         ONE THING TO KNOW, so nobody is caught out by it. On entering
         fullscreen the browser shows its own short notice, along the lines
         of "cm-43.github.io is now full screen". That notice is drawn by the
         BROWSER, on top of the page — not by this page — so nothing here can
         restyle it, reword it or hide it. It fades on its own after a second
         or two.

         Nor can we sidestep it by fullscreening the lesson's frame instead
         (which would name casementor.com): the lesson and the simulation are
         served from different web addresses, and a browser blocks a page
         from reaching the frame it sits inside when that is so. Tested, not
         assumed — window.frameElement comes back null.

         IF YOU WANT THE NOTICE TO NAME YOUR OWN ADDRESS, the way to do it is
         to serve these same files from a custom domain such as
         sim.casementor.com. That is a DNS setting plus a one-line CNAME file
         in the repository, and it changes nothing in this code (Q-G).

         WHERE FULLSCREEN IS IMPOSSIBLE (a lesson iframe without the
         allowfullscreen attribute, or a browser without the feature) the
         button is not drawn at all — see fullscreenAvailable() and README
         §8 (D46). */
      case "fullscreen": {
        if (document.fullscreenElement) {
          if (document.exitFullscreen) document.exitFullscreen().catch(function () { });
        } else if (document.documentElement.requestFullscreen) {
          var ask = document.documentElement.requestFullscreen();
          if (ask && ask.catch) ask.catch(function () { render(); });
        }
        return;
      }

      case "restart":
        state.ui.confirmRestart = true;
        render();
        return;

      case "restart-cancel":
        state.ui.confirmRestart = false;
        render();
        return;

      case "restart-confirm":
        restartGame();
        return;

      case "begin":
        if (!state.answers.startedAt) state.answers.startedAt = new Date().toISOString();
        if (state.timer.everStarted) resumeClock(); else startClock();
        if (needsStep5()) {
          state.ui.step5 = freshStep5();
          state.phase = "step5";
        } else {
          state.ui.step1 = freshStep1();
          state.phase = "step1";
        }
        render();
        return;

      case "step1-continue": {
        var ui1 = state.ui.step1;
        if (ui1.on.length !== 2) return;
        var items = ui1.on.map(function (name) {
          if (MARKING.TRAIT_NAMES.indexOf(name) !== -1) return { trait: name };
          return { attribute: name, range: ui1.ranges[name].slice() };
        });
        recordStep1(items);
        state.ui.step2 = freshStep2();
        state.phase = "step2";
        render();
        return;
      }

      case "step2-continue": {
        var ui2 = state.ui.step2;
        if (ui2.choice === null) return;
        var rows2 = step2RowsFor(site());
        var current2 = rows2[ui2.index];
        recordStep2(MARKING.microbeName(current2), ui2.choice);
        if (!ui2.placed[ui2.choice]) ui2.placed[ui2.choice] = [];
        ui2.placed[ui2.choice].push(current2);
        ui2.index += 1;
        ui2.choice = null;
        render();
        return;
      }

      case "step2-complete":
        pauseClock();
        state.phase = "step2done";
        render();
        return;

      case "step2done-continue":
        resumeClock();
        state.ui.step34 = freshStep34();
        state.phase = "step34";
        render();
        return;

      case "step5-continue": {
        var ui5 = state.ui.step5;
        if (ui5.choice === null) return;
        var rows5 = pushedForward();
        var current5 = rows5[ui5.index];
        recordStep5(MARKING.microbeName(current5), ui5.choice);
        if (!ui5.placed[ui5.choice]) ui5.placed[ui5.choice] = [];
        ui5.placed[ui5.choice].push(current5);
        ui5.index += 1;
        ui5.choice = null;
        render();
        return;
      }

      case "step5-complete":
        /* Step 5 runs straight into this site's Step 1, with no popup in
           between — the same as the current version. */
        state.ui.step1 = freshStep1();
        state.phase = "step1";
        render();
        return;

      case "pick": {
        var ui34 = state.ui.step34;
        ui34.picks.push(target.dataset.name);
        recordStep3(target.dataset.name);
        ui34.round += 1;
        if (ui34.round >= MARKING.SET_NAMES.length) ui34.phase = 4;
        render();
        return;
      }

      case "slot": {
        var uiSlot = state.ui.step34;
        var free = uiSlot.slots.indexOf(null);
        if (free === -1) return;
        uiSlot.slots[free] = target.dataset.name;
        render();
        return;
      }

      case "unslot":
        state.ui.step34.slots[parseInt(target.dataset.slot, 10)] = null;
        render();
        return;

      case "step34-submit": {
        var uiSub = state.ui.step34;
        if (uiSub.phase !== 4 || uiSub.slots.some(function (s) { return s === null; })) return;
        recordStep4(uiSub.slots);
        pauseClock();
        state.phase = "sitedone";
        render();
        return;
      }

      case "sitedone-continue":
        finishSite();
        return;

      case "legend":
        state.ui.legendOpen = !state.ui.legendOpen;
        render();
        return;

      case "toggle-compact": {
        /* Record it in the state, then redraw — so the card is still open
           after the next microbe is assigned and the screen is rebuilt. */
        var cardName = target.dataset.name;
        if (state.ui.openCards[cardName]) delete state.ui.openCards[cardName];
        else state.ui.openCards[cardName] = true;
        render();
        return;
      }

      case "reveal": {
        var siteId = target.dataset.site;
        state.ui.revealReasons[siteId] = !state.ui.revealReasons[siteId];
        render();
        return;
      }

      case "print":
        window.print();
        return;

      case "csv":
        downloadCSV();
        return;
    }
  });

  /* Results screen: when the candidate opens or closes a site block, note it
     in the state so the next redraw keeps it that way. The browser's toggle
     event does not bubble, so it is caught on the way down (the `true`). */
  app.addEventListener("toggle", function (event) {
    var d = event.target;
    if (!d || !d.classList || !d.classList.contains("site-block")) return;
    state.ui.openSites[d.dataset.site] = d.open;
  }, true);

  /* ---- changes: toggles, sliders and the choice list ---- */

  app.addEventListener("change", function (event) {
    var el = event.target;

    /* Step 1: switching a characteristic on or off. Switching on a third
       is refused, exactly as it is now. */
    if (el.dataset && el.dataset.char !== undefined) {
      var name = el.dataset.char;
      var on = state.ui.step1.on;
      var at = on.indexOf(name);
      if (el.checked) {
        if (on.length >= 2) { el.checked = false; return; }
        on.push(name);
      } else if (at !== -1) {
        on.splice(at, 1);
      }
      render();
      return;
    }

    /* Steps 2 and 5: choosing where this microbe goes. */
    if (el.name === "choice") {
      var ui = state.phase === "step5" ? state.ui.step5 : state.ui.step2;
      ui.choice = el.value;
      render();
    }
  });

  app.addEventListener("input", function (event) {
    var el = event.target;
    if (el.dataset && el.dataset.handle) {
      moveSlider(el.dataset.attr, el.dataset.handle, el.value);
    }
  });

  /* ---- the login form ---- */

  app.addEventListener("submit", function (event) {
    if (event.target.id !== "login-form") return;
    event.preventDefault();
    var username = document.getElementById("u").value.trim();
    var password = document.getElementById("p").value;
    state.ui.loginError = "";
    checkPasscode(username, password).then(function (ok) {
      if (ok) {
        state.answers.startedAt = new Date().toISOString();
        state.phase = "welcome";
      } else {
        state.ui.loginError = "That username or password was not recognised.";
      }
      render();
    }).catch(function () {
      /* Scrambling the password needs a secure connection. The login is
         never allowed to let somebody through when it cannot check. */
      state.ui.loginError = "Login needs the page to be opened over https.";
      render();
    });
  });

  boot();
})();
