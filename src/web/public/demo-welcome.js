/* Demo or fresh start, for visitors arriving from Jen's portfolio.

   The portfolio's "Open the app" links add ?from=portfolio. When a page opened that way has
   nothing saved yet, this offers two ways in: see the demo (the app filled with sample data,
   so nothing is locked and there's no setup) or start fresh as a new user. While the demo is
   in use, a small banner says so and offers Start fresh. Anyone who comes in another way, or
   already has their own data, never sees any of it.

   The same file is copied into each app (the master is projects/tools/demo-welcome.js); the
   app supplies what differs:

     DemoWelcome.init({
       id: "nihongo-quest",          // names this app's flag in localStorage
       name: "Nihongo Quest",
       accent: "#c2412d",            // the app's own colour, for the demo button
       demo: "What the demo has",    // one line under See the demo
       fresh: "What fresh means",    // one line under Start fresh
       isEmpty: () => true,          // nothing saved yet (may return a promise)
       loadDemo: () => {},           // fill the app with the sample (may return a promise)
       clear: () => {},              // remove the sample again (may return a promise)
       stillDemo: () => true,        // optional: is the sample still what's on screen?
       banner: true,                 // false when the app already marks its sample
       bannerAt: "bottom",           // or "top", if the app has a bar along the bottom
       tour: [                       // optional: a walk through the demo, right after it loads
         { go: () => {},             //   optional: get the app to the right screen first
           el: ["#a", ".b"],         //   what to light up: the first of these that's on screen
           title: "…", text: "…" },  //   (no el: a card in the middle)
       ],
     });

   An app whose loadDemo reloads the page still gets its tour: it's flagged before the reload
   and run on the next start.
*/
(function () {
  "use strict";

  var FROM = /([?&])from=portfolio(&|$)/;
  var cfg = null, host = null, bannerHost = null, poll = null, placeBanner = null;

  var flagKey = function () { return "demo-welcome:" + cfg.id; };
  var isOn = function () { try { return localStorage.getItem(flagKey()) === "on"; } catch (e) { return false; } };
  var setOn = function (on) { try { on ? localStorage.setItem(flagKey(), "on") : localStorage.removeItem(flagKey()); } catch (e) {} };
  var later = function (v) { return Promise.resolve(typeof v === "function" ? v() : v); };
  var tourKey = function () { return "demo-welcome:" + cfg.id + ":tour"; };
  var tourDue = function (due) {
    try {
      if (due === undefined) return localStorage.getItem(tourKey()) === "due";
      due ? localStorage.setItem(tourKey(), "due") : localStorage.removeItem(tourKey());
    } catch (e) { return false; }
  };
  var wait = function (ms) { return new Promise(function (ok) { setTimeout(ok, ms); }); };
  // the part of the page actually on screen, in the coordinates fixed elements use
  var vp = function () {
    var v = window.visualViewport;
    return v ? { x: v.offsetLeft, y: v.offsetTop, w: v.width, h: v.height } : { x: 0, y: 0, w: innerWidth, h: innerHeight };
  };
  var NARROW = 600; // below this, a phone: the walk-through's card spans the screen
  function fit(el) {
    var v = vp();
    el.style.left = v.x + "px"; el.style.top = v.y + "px"; el.style.width = v.w + "px"; el.style.height = v.h + "px";
  }
  function onScreenChange(fn, on) {
    var v = window.visualViewport, m = on ? "addEventListener" : "removeEventListener";
    window[m]("resize", fn);
    if (v) { v[m]("resize", fn); v[m]("scroll", fn); }
  }

  var CSS = [
    ":host { all: initial; }",
    "* { box-sizing: border-box; }",
    // fixed layers are sized to the visible screen in code (fit), since a page wider than the
    // phone makes the layout viewport, and with it inset:0, 100vw and media queries, too big
    ".scrim { position: fixed; left: 0; top: 0; width: 100vw; height: 100vh; z-index: 2147483000; display: grid; place-items: center; padding: 16px;",
    "  background: rgba(20, 18, 16, 0.42); -webkit-backdrop-filter: blur(4px); backdrop-filter: blur(4px);",
    "  font: 400 15px/1.5 ui-sans-serif, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; color: #1d1b18; }",
    ".card { width: min(460px, 100%); max-height: 100%; overflow: auto; padding: 26px 24px 20px; border-radius: 20px;",
    "  background: #fffdf9; box-shadow: 0 2px 6px rgba(0,0,0,.08), 0 30px 70px -20px rgba(0,0,0,.45); }",
    ".eyebrow { margin: 0; font-size: 12px; font-weight: 600; letter-spacing: .08em; text-transform: uppercase; color: #8a847a; }",
    "h2 { margin: 6px 0 0; font: 600 26px/1.15 ui-serif, Georgia, 'Times New Roman', serif; letter-spacing: -.01em; }",
    ".lead { margin: 8px 0 18px; color: #5a554d; }",
    ".opt { display: block; width: 100%; margin: 0 0 10px; padding: 14px 16px; border-radius: 14px; text-align: left; cursor: pointer;",
    "  font: inherit; color: inherit; background: #fff; border: 1.5px solid #e6e0d6; transition: border-color .15s, transform .15s; }",
    ".opt:hover { border-color: #bdb5a8; transform: translateY(-1px); }",
    ".opt:focus-visible { outline: 3px solid var(--accent); outline-offset: 2px; }",
    ".opt b { display: block; font-size: 16px; }",
    ".opt span { display: block; margin-top: 2px; color: #6b665e; font-size: 14px; }",
    ".opt.demo { background: var(--accent); border-color: var(--accent); color: var(--on); }",
    ".opt.demo span { color: inherit; opacity: .88; }",
    ".opt.demo:hover { filter: brightness(1.06); }",
    ".fine { margin: 6px 0 0; font-size: 12.5px; color: #8a847a; }",
    ".banner { position: fixed; left: 12px; top: 12px; z-index: 2147483000; display: flex; align-items: center; gap: 10px;",
    "  padding: 6px 6px 6px 12px; border-radius: 999px; background: rgba(29, 27, 24, .9); color: #fff; box-shadow: 0 4px 16px rgba(0,0,0,.25);",
    "  font: 500 13px/1.3 ui-sans-serif, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; }",
    ".banner .short { display: none; }",
    ".banner.narrow .long { display: none; } .banner.narrow .short { display: inline; }",
    ".banner i { width: 8px; height: 8px; flex: none; border-radius: 50%; background: var(--accent); }",
    ".banner button { flex: none; padding: 5px 11px; border: 0; border-radius: 999px; cursor: pointer; font: inherit; font-weight: 600; font-size: 12.5px;",
    "  background: #fff; color: #1d1b18; }",
    ".banner button:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }",
    // the walk-through: a lit-up spot (everything else dimmed by its shadow) and a card beside it
    ".tour { position: fixed; left: 0; top: 0; width: 100vw; height: 100vh; z-index: 2147483000;",
    "  font: 400 15px/1.5 ui-sans-serif, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; color: #1d1b18; }",
    ".spot { position: fixed; border-radius: 14px; box-shadow: 0 0 0 3px var(--accent), 0 0 0 9999px rgba(20, 18, 16, 0.5);",
    "  transition: left .25s ease, top .25s ease, width .25s ease, height .25s ease; pointer-events: none; }",
    ".spot.none { width: 0 !important; height: 0 !important; box-shadow: 0 0 0 9999px rgba(20, 18, 16, 0.5); }",
    ".tip { position: fixed; width: 360px; padding: 16px 18px 14px; border-radius: 16px; background: #fffdf9;",
    "  box-shadow: 0 2px 6px rgba(0,0,0,.1), 0 24px 50px -16px rgba(0,0,0,.45); }",
    ".tip .step { margin: 0; font-size: 12px; font-weight: 600; letter-spacing: .06em; text-transform: uppercase; color: #8a847a; }",
    ".tip h3 { margin: 4px 0 0; font: 600 19px/1.25 ui-serif, Georgia, 'Times New Roman', serif; }",
    ".tip p.text { margin: 6px 0 0; color: #4f4a43; font-size: 14.5px; }",
    ".tip .row { display: flex; align-items: center; gap: 8px; margin-top: 14px; }",
    ".tip .row .skip { margin-right: auto; padding: 6px 2px; border: 0; background: none; color: #8a847a; cursor: pointer; font: inherit; font-size: 13.5px; }",
    ".tip .row .back, .tip .row .next { padding: 8px 14px; border-radius: 999px; cursor: pointer; font: inherit; font-weight: 600; font-size: 14px; }",
    ".tip .row .back { border: 1.5px solid #e6e0d6; background: #fff; color: inherit; }",
    ".tip .row .next { border: 0; background: var(--accent); color: var(--on); }",
    ".tip button:focus-visible { outline: 3px solid var(--accent); outline-offset: 2px; }",
    "@media (prefers-reduced-motion: reduce) { .spot { transition: none; } }",
    "@media (prefers-color-scheme: dark) {",
    "  .tour { color: #f1ede6; } .tip { background: #22201d; } .tip p.text { color: #c9c3b8; }",
    "  .tip .row .back { background: #2b2925; border-color: #3d3a35; }",
    "  .scrim { color: #f1ede6; }",
    "  .card { background: #22201d; }",
    "  .lead { color: #c9c3b8; } .eyebrow, .fine { color: #9b958b; }",
    "  .opt { background: #2b2925; border-color: #3d3a35; } .opt:hover { border-color: #5a564f; } .opt span { color: #b5afa5; }",
    "}",
    "@media (prefers-reduced-motion: reduce) { .opt { transition: none; } .opt:hover { transform: none; } }",
  ].join("\n");

  // white or near-black text, whichever reads better on the accent
  function inkOn(hex) {
    var n = parseInt(String(hex).slice(1), 16);
    if (isNaN(n)) return "#fff";
    var lum = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map(function (v) {
      v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
    });
    return 0.2126 * lum[0] + 0.7152 * lum[1] + 0.0722 * lum[2] > 0.4 ? "#1d1b18" : "#fff";
  }

  function mount(tag) {
    var el = document.createElement(tag);
    var root = el.attachShadow({ mode: "open" });
    root.innerHTML = "<style>" + CSS + "</style>";
    el.style.setProperty("--accent", cfg.accent || "#1d1b18");
    el.style.setProperty("--on", inkOn(cfg.accent || "#1d1b18"));
    document.body.appendChild(el);
    return root;
  }
  var esc = function (s) {
    return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; });
  };

  function showChoice() {
    var root = mount("demo-welcome");
    host = root.host;
    var wrap = document.createElement("div");
    wrap.className = "scrim";
    wrap.innerHTML =
      '<div class="card" role="dialog" aria-modal="true" aria-labelledby="dw-title">' +
        '<p class="eyebrow">From Jen’s portfolio</p>' +
        '<h2 id="dw-title">' + esc(cfg.name) + "</h2>" +
        '<p class="lead">Look around with sample data already in it, or start from a blank slate the way a new user would.</p>' +
        '<button type="button" class="opt demo" data-pick="demo"><b>See the demo</b><span>' + esc(cfg.demo) + "</span></button>" +
        '<button type="button" class="opt" data-pick="fresh"><b>Start fresh</b><span>' + esc(cfg.fresh) + "</span></button>" +
        (cfg.banner === false ? "" : '<p class="fine">You can leave the demo and start fresh at any time.</p>') +
      "</div>";
    root.appendChild(wrap);
    var refit = function () { fit(wrap); };
    refit();
    onScreenChange(refit, true);
    var close = function () {
      if (host) { host.remove(); host = null; }
      document.removeEventListener("keydown", onKey, true);
      onScreenChange(refit, false);
    };
    var onKey = function (e) { if (e.key === "Escape") { e.stopPropagation(); close(); } };
    document.addEventListener("keydown", onKey, true);
    wrap.addEventListener("click", function (e) {
      var b = e.target.closest && e.target.closest("[data-pick]");
      if (!b) return;
      close();
      if (b.dataset.pick === "demo") {
        setOn(true);
        if (cfg.tour && cfg.tour.length) tourDue(true);
        later(cfg.loadDemo).then(afterDemo, function (err) { setOn(false); tourDue(false); console.warn("demo didn't load", err); });
      }
    });
    root.querySelector(".opt.demo").focus();
  }

  // the demo is in: walk through it if there's a tour waiting, then put the banner up
  function afterDemo() {
    if (tourDue()) { tourDue(false); return wait(350).then(function () { return runTour(cfg.tour); }).then(showBanner); }
    showBanner();
  }

  // ---------- the walk-through ----------
  function findEl(el) {
    var list = typeof el === "function" ? [el()] : [].concat(el || []);
    for (var i = 0; i < list.length; i++) {
      var x = typeof list[i] === "string" ? document.querySelector(list[i]) : list[i];
      if (x && x.getClientRects().length) { var r = x.getBoundingClientRect(); if (r.width && r.height) return x; }
    }
    return null;
  }
  function runTour(steps) {
    return new Promise(function (finish) {
      var root = mount("demo-welcome-tour");
      var layer = document.createElement("div");
      layer.className = "tour";
      layer.innerHTML = '<div class="spot none"></div><div class="tip" role="dialog" aria-modal="true" aria-live="polite">' +
        '<p class="step"></p><h3></h3><p class="text"></p><div class="row">' +
        '<button type="button" class="skip">Skip the tour</button><button type="button" class="back">Back</button>' +
        '<button type="button" class="next">Next</button></div></div>';
      root.appendChild(layer);
      var spot = layer.querySelector(".spot"), tip = layer.querySelector(".tip"), i = 0, target = null, busy = false;

      // light up the target and set the card beside it: below if there's room, else above.
      // On a phone the card spans the screen along the bottom, or the top when that's where
      // the lit-up part is. Everything is measured against the part of the page on screen.
      function place() {
        var v = vp(), narrow = v.w < NARROW, right = v.x + v.w, foot = v.y + v.h;
        fit(layer);
        tip.style.width = (narrow ? v.w - 24 : Math.min(360, v.w - 24)) + "px";
        var h = tip.offsetHeight, w = tip.offsetWidth;
        if (!target) {
          spot.className = "spot none";
          spot.style.left = v.x + v.w / 2 + "px";
          spot.style.top = v.y + v.h * 0.45 + "px";
          tip.style.left = v.x + Math.max(12, (v.w - w) / 2) + "px";
          tip.style.top = v.y + Math.max(12, (v.h - h) / 2) + "px";
          return;
        }
        var r = target.getBoundingClientRect(), pad = 8;
        var top = Math.max(v.y + 4, r.top - pad), bottom = Math.min(foot - 4, r.bottom + pad);
        // coming from no target, appear in place rather than slide in from the middle
        var jump = spot.classList.contains("none");
        if (jump) spot.style.transition = "none";
        spot.className = "spot";
        spot.style.left = Math.max(v.x + 4, r.left - pad) + "px";
        spot.style.top = top + "px";
        spot.style.width = Math.max(0, Math.min(right - 4, r.right + pad) - Math.max(v.x + 4, r.left - pad)) + "px";
        spot.style.height = Math.max(0, bottom - top) + "px";
        if (jump) { void spot.offsetWidth; spot.style.transition = ""; }
        if (narrow) {
          tip.style.left = v.x + 12 + "px";
          tip.style.top = (r.top > foot - h - 40 ? v.y + 12 : foot - h - 12) + "px";
          return;
        }
        tip.style.left = Math.min(right - w - 12, Math.max(v.x + 12, r.left)) + "px";
        tip.style.top = (bottom + 12 + h < foot ? bottom + 12 : top - 12 - h > v.y ? top - 12 - h : Math.max(v.y + 12, foot - h - 12)) + "px";
      }
      function show(n) {
        if (busy) return;
        busy = true;
        i = n;
        var s = steps[i];
        later(s.go).then(function () { return wait(s.go ? 300 : 0); }).then(function () {
          target = findEl(s.el);
          if (target) {
            var r = target.getBoundingClientRect(), v = vp();
            // keep the top of a tall target in view, with room for the card under a short one
            if (r.top < v.y + 60 || r.bottom > v.y + v.h - 40 || r.left < v.x || r.left > v.x + v.w - 40) {
              target.scrollIntoView({ block: r.height > v.h * 0.5 ? "start" : "center", inline: "nearest" });
            }
          }
          tip.querySelector(".step").textContent = (i + 1) + " of " + steps.length;
          tip.querySelector("h3").textContent = s.title;
          tip.querySelector(".text").textContent = s.text;
          tip.querySelector(".back").hidden = i === 0;
          tip.querySelector(".skip").hidden = i === steps.length - 1;
          tip.querySelector(".next").textContent = i === steps.length - 1 ? "Start exploring" : "Next";
          return wait(target ? 80 : 0);
        }).then(function () {
          place();
          tip.querySelector(".next").focus({ preventScroll: true });
          busy = false;
        }, function (err) { busy = false; console.warn("tour step failed", err); end(); });
      }
      function end() {
        onScreenChange(place, false);
        removeEventListener("scroll", place, true);
        document.removeEventListener("keydown", onKey, true);
        root.host.remove();
        finish();
      }
      var onKey = function (e) {
        if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); end(); }
        else if (e.key === "ArrowRight" || e.key === "Enter") { e.preventDefault(); e.stopPropagation(); i < steps.length - 1 ? show(i + 1) : end(); }
        else if (e.key === "ArrowLeft" && i > 0) { e.preventDefault(); e.stopPropagation(); show(i - 1); }
      };
      tip.querySelector(".next").addEventListener("click", function () { i < steps.length - 1 ? show(i + 1) : end(); });
      tip.querySelector(".back").addEventListener("click", function () { show(i - 1); });
      tip.querySelector(".skip").addEventListener("click", end);
      onScreenChange(place, true);
      addEventListener("scroll", place, true);
      document.addEventListener("keydown", onKey, true);
      fit(layer);
      show(0);
    });
  }

  function showBanner() {
    if (cfg.banner === false || bannerHost || !isOn()) return;
    var root = mount("demo-welcome-banner");
    bannerHost = root.host;
    var bar = document.createElement("div");
    bar.className = "banner";
    bar.setAttribute("role", "status");
    bar.innerHTML = "<i></i><span class=\"long\">You’re looking at a demo</span><span class=\"short\">Demo</span>" +
      "<button type=\"button\">Start fresh</button>";
    root.appendChild(bar);
    // bottom left (or top left) of what's on screen; just "Demo" on a narrow phone
    placeBanner = function () {
      var v = vp();
      bar.classList.toggle("narrow", v.w <= 420);
      bar.style.left = v.x + 12 + "px";
      bar.style.top = (cfg.bannerAt === "top" ? v.y + 12 : v.y + v.h - bar.offsetHeight - 12) + "px";
    };
    placeBanner();
    onScreenChange(placeBanner, true);
    bar.querySelector("button").addEventListener("click", function () {
      if (!confirm("Start fresh? The demo’s sample data goes away, and you start as a new user.")) return;
      leave();
    });
    // an app whose sample can be closed by other means (Writers Blocks) says when it's gone
    if (cfg.stillDemo) poll = setInterval(function () { if (!cfg.stillDemo()) { setOn(false); hideBanner(); } }, 1000);
  }
  function hideBanner() {
    clearInterval(poll);
    if (placeBanner) { onScreenChange(placeBanner, false); placeBanner = null; }
    if (bannerHost) { bannerHost.remove(); bannerHost = null; }
  }
  function leave() {
    hideBanner();
    later(cfg.clear).then(function () { setOn(false); });
  }

  window.DemoWelcome = {
    init: function (c) {
      cfg = c;
      var fromPortfolio = FROM.test(location.search);
      if (fromPortfolio) {
        // tidy the address so a reload or a shared link doesn't ask again
        var q = location.search.replace(FROM, function (m, a, b) { return b ? a : ""; }).replace(/^&/, "?");
        try { history.replaceState(history.state, "", location.pathname + (q === "?" ? "" : q) + location.hash); } catch (e) {}
      }
      if (isOn()) {
        // the tour of a demo that reloaded the page to load runs now
        if (cfg.stillDemo && !cfg.stillDemo()) { setOn(false); tourDue(false); } else afterDemo();
      }
      if (!fromPortfolio || isOn()) return;
      later(cfg.isEmpty).then(function (empty) { if (empty) showChoice(); });
    },
    // for an app's own "start fresh" or reset, so the banner goes with it
    off: function () { setOn(false); tourDue(false); hideBanner(); },
    // to replay the walk-through from the app's own help, if it wants to
    tour: function () { return cfg && cfg.tour ? runTour(cfg.tour) : Promise.resolve(); },
  };
})();
