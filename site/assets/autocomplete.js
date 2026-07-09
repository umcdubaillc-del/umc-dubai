/* © UMC Dubai LLC. All rights reserved. Unauthorised reproduction of this code or design is prohibited and monitored. */
/* UMC Dubai — shared place-autocomplete dropdown.
   Used by BOTH the homepage hero form (main.js) and the booking form
   (booking.js). A custom dropdown driven by the Places AutocompleteService
   (suggestion API) with our OWN markup, so each suggestion carries a branded
   type icon. One AutocompleteSessionToken groups the predictions (+ the
   optional getDetails lookup) into a single billed session. On select we set
   the input's .value to the full prediction description, so any downstream
   text detection (airport token / Terminal-3 welcome-sign suppression) reads
   the same value it did before — the hard constraint the booking flow depends
   on. Keyboard (up/down/Enter/Esc), hover, click; ARIA combobox/listbox/option.

   Dual-published: window.umcAutocomplete in the browser, module.exports in Node
   (so scripts/test-place-icon.mjs can exercise the pure icon classifier). No DOM
   or google.* access happens at load time — those live inside attach()/choose(),
   which the test never calls. */
(function (root, factory) {
  var api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.umcAutocomplete = api;
})(typeof window !== "undefined" ? window : globalThis, function () {
  "use strict";

  // Branded outline glyphs, one per icon KIND. 24-box, rendered ~18px via the
  // .ac-ic svg rule in style.css (fill:none; muted stroke; 1.5 weight).
  var ICONS = {
    plane: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M17.8 19.2 16 11l3.5-3.5c1-1 1-2.5 0-3s-2.5-1-3 0L13 8 4.8 6.2c-.4-.1-.7.4-.4.7l3.9 4.2-2.2 2.2-1.9-.3-.9.9 2.4 1.5L8 18.4l.9-.9-.3-1.9 2.2-2.2 4.2 3.9c.3.3.8 0 .7-.4z"/></svg>',
    // Bed redrawn (ICONS-2 §3): legible at 16px — vertical headboard, a straight
    // mattress line, a pillow hump by the headboard, and two short legs.
    bed: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 14V7M5 14h13.5M7 14c0-1.3.9-2 2-2s2 .7 2 2M6.5 14v2.4M17 14v2.4"/></svg>',
    building: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 21V4.5A1.5 1.5 0 0 1 7.5 3h6A1.5 1.5 0 0 1 15 4.5V21M15 10h2.5A1.5 1.5 0 0 1 19 11.5V21M4 21h16M9 7h3M9 11h3M9 15h3"/></svg>',
    pin: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 21s-6-5.7-6-10a6 6 0 1 1 12 0c0 4.3-6 10-6 10z"/><circle cx="12" cy="11" r="2.3"/></svg>'
  };

  // ICONS-2 §2: derive the icon from a PRIORITY LIST evaluated over the FULL
  // prediction.types array, not from whichever type Google happens to list
  // first. The first KIND whose token set intersects `types` wins, so one place
  // resolves to the same icon across phrasings ("mall of emirates" and
  // "mall mall of the emirates" both carry shopping_mall/establishment -> building).
  var ICON_PRIORITY = [
    ["plane",    ["airport", "heliport"]],
    ["bed",      ["lodging", "hotel"]],
    ["building", ["shopping_mall", "store", "restaurant", "cafe", "establishment", "point_of_interest", "premise"]],
    ["pin",      ["route", "street_address", "geocode", "neighborhood", "sublocality", "locality"]]
  ];

  function iconKindFor(types) {
    types = types || [];
    for (var r = 0; r < ICON_PRIORITY.length; r++) {
      var toks = ICON_PRIORITY[r][1];
      for (var t = 0; t < toks.length; t++) {
        if (types.indexOf(toks[t]) >= 0) return ICON_PRIORITY[r][0];
      }
    }
    return "pin";
  }

  function iconFor(types) { return ICONS[iconKindFor(types)]; }

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c];
    });
  }

  // attach(input, config) — wire a branded autocomplete dropdown to `input`.
  // config:
  //   service       google.maps.places.AutocompleteService     (required)
  //   placesService google.maps.places.PlacesService           (needed for details)
  //   country       componentRestrictions country code         (default "ae")
  //   limit         max suggestions shown                       (default 6)
  //   which         id suffix for the dropdown/options          (default input.id)
  //   getSession    () => sessionToken                          (optional)
  //   newSession    () => sessionToken  — mint a fresh token    (optional)
  //   onSession     (token) => void     — store the rotated one (optional)
  //   detailFields  string[]|null — if set (+ placesService), getDetails on pick
  //   onSelect      (prediction, place|null) => void
  function attach(input, config) {
    if (!input || !config || !config.service) return;
    var svc = config.service;
    var country = config.country || "ae";
    var limit = config.limit || 6;
    var which = config.which || input.id || "ac";
    var wrap = input.closest(".f") || input.parentNode;
    wrap.classList.add("ac-wrap");
    var drop = document.createElement("div");
    drop.className = "ac-drop"; drop.setAttribute("role", "listbox"); drop.id = "acdrop-" + which; drop.hidden = true;
    wrap.appendChild(drop);
    input.setAttribute("role", "combobox");
    input.setAttribute("aria-autocomplete", "list");
    input.setAttribute("aria-expanded", "false");
    input.setAttribute("aria-controls", drop.id);
    var preds = [], active = -1, tmr = null;

    function session() { return config.getSession ? config.getSession() : undefined; }

    function close() { drop.hidden = true; drop.innerHTML = ""; preds = []; active = -1; input.setAttribute("aria-expanded", "false"); input.removeAttribute("aria-activedescendant"); }
    function setActive(i) {
      var items = drop.querySelectorAll(".ac-item");
      active = i;
      items.forEach(function (el, idx) { el.classList.toggle("on", idx === i); el.setAttribute("aria-selected", idx === i ? "true" : "false"); });
      if (i >= 0 && items[i]) { input.setAttribute("aria-activedescendant", items[i].id); items[i].scrollIntoView({ block: "nearest" }); }
      else input.removeAttribute("aria-activedescendant");
    }
    function render() {
      if (!preds.length) { close(); return; }
      drop.innerHTML = preds.map(function (p, i) {
        var m = p.structured_formatting || {};
        var main = esc(m.main_text || p.description);
        var sec = m.secondary_text ? '<span class="ac-sec">' + esc(m.secondary_text) + '</span>' : '';
        return '<div class="ac-item" role="option" aria-selected="false" id="acopt-' + which + '-' + i + '" data-i="' + i + '">'
          + '<span class="ac-ic">' + iconFor(p.types) + '</span>'
          + '<span class="ac-tx"><span class="ac-main">' + main + '</span>' + sec + '</span></div>';
      }).join("");
      drop.hidden = false;
      input.setAttribute("aria-expanded", "true");
      setActive(-1);
    }
    function query() {
      var val = (input.value || "").trim();
      if (val.length < 2) { close(); return; }
      svc.getPlacePredictions(
        { input: val, componentRestrictions: { country: country }, sessionToken: session() },
        function (res, status) {
          if (status !== google.maps.places.PlacesServiceStatus.OK || !res || !res.length) { close(); return; }
          preds = res.slice(0, limit); render();
        });
    }
    function rotate() { if (config.newSession && config.onSession) config.onSession(config.newSession()); }
    function choose(i) {
      var p = preds[i]; if (!p) return;
      input.value = p.description;            // full text -> downstream airport/T3 detection reads this
      close();
      if (config.detailFields && config.placesService) {
        config.placesService.getDetails(
          { placeId: p.place_id, fields: config.detailFields, sessionToken: session() },
          function (place, status) {
            rotate();                          // end the billed session
            var ok = status === google.maps.places.PlacesServiceStatus.OK && place;
            if (config.onSelect) config.onSelect(p, ok ? place : null);
          });
      } else {
        rotate();
        if (config.onSelect) config.onSelect(p, null);
      }
    }
    input.addEventListener("input", function () { if (tmr) clearTimeout(tmr); tmr = setTimeout(query, 160); });
    input.addEventListener("keydown", function (e) {
      if (drop.hidden) { if (e.key === "ArrowDown") query(); return; }
      if (e.key === "ArrowDown") { e.preventDefault(); setActive(Math.min(active + 1, preds.length - 1)); }
      else if (e.key === "ArrowUp") { e.preventDefault(); setActive(active <= 0 ? preds.length - 1 : active - 1); }
      else if (e.key === "Enter" && active >= 0) { e.preventDefault(); choose(active); }
      else if (e.key === "Escape") { close(); }
    });
    drop.addEventListener("mousedown", function (e) { var it = e.target.closest(".ac-item"); if (it) { e.preventDefault(); choose(parseInt(it.getAttribute("data-i"), 10)); } });
    input.addEventListener("blur", function () { setTimeout(close, 150); });   // let a click register first
  }

  return { ICONS: ICONS, ICON_PRIORITY: ICON_PRIORITY, iconKindFor: iconKindFor, iconFor: iconFor, esc: esc, attach: attach };
});
