/* © UMC Dubai LLC. All rights reserved. Unauthorised reproduction of this code or design is prohibited and monitored. */
/* FIND-1 — "Find your car" fit-finder on /fleet.
   Reads data-fit-guests / data-fit-cases off the server-rendered .vcard nodes
   (renderFleet hydrate mode preserves them), wires the two steppers, and re-ranks
   the grid: fitting cars lead (each tagged with a mono FITS chip); non-fitting cars
   stay VISIBLE in place below, dimmed, with a one-line reason. Never hides a card,
   never shows an empty state. State lives in ?guests=&cases= so a result is
   shareable and back-safe. Reorder animates ≤250ms via FLIP; instant when the page
   loads from a shared URL and under prefers-reduced-motion. */
(function () {
  "use strict";
  var mod = document.getElementById("fitFinder");
  var grid = document.getElementById("fleetAll");
  if (!mod || !grid) return;

  var GMIN = 1, GMAX = 8, CMIN = 0, CMAX = 8;   // 8 renders as "8+" (8 or more)
  var guests = GMIN, cases = CMIN, active = false;
  var RM = matchMedia("(prefers-reduced-motion:reduce)").matches;

  var gVal = document.getElementById("ffGuestsVal");
  var cVal = document.getElementById("ffCasesVal");
  var statusEl = document.getElementById("ffStatus");
  var resetBtn = document.getElementById("ffReset");
  var concierge = document.getElementById("ffConcierge");

  var cards = Array.prototype.slice.call(grid.querySelectorAll(".vcard"));
  cards.forEach(function (c, i) { c._ffOrder = i; });   // capture SSR order once

  function fitG(c) { return parseInt(c.getAttribute("data-fit-guests"), 10) || 0; }
  function fitC(c) { return parseInt(c.getAttribute("data-fit-cases"), 10) || 0; }
  function isBig(c) { var v = c.getAttribute("data-vid"); return v === "mb-sprinter" || v === "luxury-coach"; }
  function fits(c) { return fitG(c) >= guests && fitC(c) >= cases; }
  function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
  function label(v, max) { return v >= max ? (max + "+") : String(v); }

  function ensure(c, cls) {
    var el = c.querySelector("." + cls);
    if (!el) { el = document.createElement("span"); el.className = cls; c.appendChild(el); }
    return el;
  }
  function drop(c, cls) { var el = c.querySelector("." + cls); if (el) el.parentNode.removeChild(el); }

  function markFit(c) {
    c.classList.remove("ff-unfit");
    drop(c, "ff-reason");
    ensure(c, "ff-chip").textContent =
      "FITS · " + label(guests, GMAX) + " GUESTS · " + label(cases, CMAX) + " CASES";
  }
  function markUnfit(c) {
    c.classList.add("ff-unfit");
    drop(c, "ff-chip");
    ensure(c, "ff-reason").textContent = (fitG(c) < guests)
      ? "Seats " + fitG(c) + " — you need " + label(guests, GMAX)
      : "Takes " + fitC(c) + " cases — you have " + label(cases, CMAX);
  }
  function clearCard(c) { c.classList.remove("ff-unfit"); drop(c, "ff-chip"); drop(c, "ff-reason"); }

  // FLIP: reorder the DOM, then animate each card from its old box to its new one.
  function reorder(ordered, animate) {
    var first = null;
    if (animate && !RM) { first = cards.map(function (c) { return c.getBoundingClientRect(); }); }
    ordered.forEach(function (c) { grid.appendChild(c); });
    if (!first) return;
    cards.forEach(function (c, i) {
      var f = first[i], l = c.getBoundingClientRect();
      var dx = f.left - l.left, dy = f.top - l.top;
      if (!dx && !dy) return;
      c.style.transition = "none";
      c.style.transform = "translate(" + dx + "px," + dy + "px)";
      requestAnimationFrame(function () {
        c.style.transition = "transform .24s cubic-bezier(.4,0,.2,1)";
        c.style.transform = "";
      });
    });
  }

  function setBtns() {
    mod.querySelectorAll(".ff-stepper").forEach(function (sp) {
      var g = sp.getAttribute("data-step") === "guests";
      var val = g ? guests : cases, lo = g ? GMIN : CMIN, hi = g ? GMAX : CMAX;
      sp.querySelectorAll(".ff-btn").forEach(function (b) {
        var dir = parseInt(b.getAttribute("data-dir"), 10);
        b.disabled = (dir < 0 && val <= lo) || (dir > 0 && val >= hi);
      });
    });
  }

  function sync() {
    var u = new URL(location.href);
    if (active) { u.searchParams.set("guests", guests); u.searchParams.set("cases", cases); }
    else { u.searchParams.delete("guests"); u.searchParams.delete("cases"); }
    history.replaceState(null, "", u.pathname + (u.search || "") + u.hash);
  }

  function render(animate) {
    mod.setAttribute("data-active", active ? "true" : "false");
    gVal.textContent = label(guests, GMAX);
    cVal.textContent = label(cases, CMAX);
    if (resetBtn) resetBtn.hidden = !active;
    setBtns();

    if (!active) {
      cards.forEach(clearCard);
      reorder(cards.slice().sort(function (a, b) { return a._ffOrder - b._ffOrder; }), animate);
      if (statusEl) statusEl.textContent = "";
      if (concierge) concierge.hidden = true;
      return;
    }

    var group = guests >= GMAX;   // "8+" guests => group vehicles lead + concierge line
    var n = 0;
    cards.forEach(function (c) { if (fits(c)) { n++; markFit(c); } else { markUnfit(c); } });

    var ordered = cards.slice().sort(function (a, b) {
      var af = fits(a) ? 0 : 1, bf = fits(b) ? 0 : 1;
      if (af !== bf) return af - bf;
      if (group) {
        var ab = (af === 0 && isBig(a)) ? 0 : 1, bb = (bf === 0 && isBig(b)) ? 0 : 1;
        if (ab !== bb) return ab - bb;
      }
      return a._ffOrder - b._ffOrder;
    });
    reorder(ordered, animate);

    if (statusEl) statusEl.textContent = n + (n === 1 ? " car fits" : " cars fit");
    if (concierge) concierge.hidden = !group;
  }

  mod.querySelectorAll(".ff-btn").forEach(function (btn) {
    btn.addEventListener("click", function () {
      var g = btn.parentNode.getAttribute("data-step") === "guests";
      var dir = parseInt(btn.getAttribute("data-dir"), 10);
      if (g) guests = clamp(guests + dir, GMIN, GMAX);
      else cases = clamp(cases + dir, CMIN, CMAX);
      active = true;
      sync(); render(true);
    });
  });
  if (resetBtn) resetBtn.addEventListener("click", function () {
    guests = GMIN; cases = CMIN; active = false;
    sync(); render(true);
  });

  // Initial state from the URL (shareable / back-safe). No animation on first paint
  // so a shared link never counts as layout shift.
  var p = new URLSearchParams(location.search);
  if (p.has("guests") || p.has("cases")) {
    var g = parseInt(p.get("guests"), 10), c = parseInt(p.get("cases"), 10);
    if (!isNaN(g)) guests = clamp(g, GMIN, GMAX);
    if (!isNaN(c)) cases = clamp(c, CMIN, CMAX);
    active = true;
  }
  render(false);
})();
