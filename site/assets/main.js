/* © UMC In Bound Tour Operator LLC. All rights reserved. Unauthorised reproduction of this code or design is prohibited and monitored. */
/* UMC Dubai,shared behaviour */

// shared phone utility (must exist before the IIFE wires forms, and before booking.js runs)
window.umcPhone = {
  // strip non-digits; do NOT strip leading zero here,only for length check / output
  cleanInput: function(s){ return (s||"").replace(/[^0-9]/g, ""); },
  // strip exactly one leading 0 (national trunk prefix) before counting significant digits
  significantDigits: function(s){
    const d = this.cleanInput(s);
    return d.startsWith("0") ? d.slice(1) : d;
  },
  range: function(selEl){
    const opt = selEl && selEl.options ? selEl.options[selEl.selectedIndex] : null;
    const mn = opt && opt.dataset.lenMin ? +opt.dataset.lenMin : 7;
    const mx = opt && opt.dataset.lenMax ? +opt.dataset.lenMax : 12;
    return [mn, mx];
  },
  valid: function(inputEl, selEl){
    const [mn, mx] = this.range(selEl);
    const n = this.significantDigits(inputEl ? inputEl.value : "").length;
    return n >= mn && n <= mx;
  },
  errMsg: function(selEl){
    const [mn, mx] = this.range(selEl);
    return mn === mx
      ? "Enter a " + mn + "-digit mobile number"
      : "Enter a " + mn + "–" + mx + "-digit mobile number";
  },
  wire: function(selEl, inputEl){
    if(!selEl || !inputEl) return;
    const wrap = inputEl.closest(".f");
    const errEl = wrap ? wrap.querySelector(".phone-err") : null;
    const self = this;
    const syncMax = function(){
      const [, mx] = self.range(selEl);
      inputEl.setAttribute("maxlength", String(mx + 1)); // +1 so a leading 0 isn't blocked
    };
    const validate = function(showWhenEmpty){
      const raw = inputEl.value;
      const cleaned = self.cleanInput(raw);
      if(cleaned !== raw) inputEl.value = cleaned;
      const empty = cleaned.length === 0;
      const ok = self.valid(inputEl, selEl);
      const bad = !ok && (!empty || !!showWhenEmpty);
      if(wrap) wrap.classList.toggle("bad", bad);
      if(errEl) errEl.textContent = bad ? self.errMsg(selEl) : "";
      return ok;
    };
    selEl.addEventListener("change", function(){ syncMax(); validate(false); });
    inputEl.addEventListener("input", function(){ validate(false); });
    inputEl.addEventListener("blur", function(){ validate(false); });
    syncMax();
  }
};

(function(){
  // mobile nav
  const burger = document.querySelector(".burger");
  const nav = document.querySelector("nav.mainnav");
  if(burger && nav){
    burger.addEventListener("click", ()=>{
      const open = nav.classList.toggle("open");
      burger.setAttribute("aria-expanded", open);
    });
    nav.addEventListener("click", e=>{
      // Mobile submenu: tap on the chevron button toggles its parent .has-sub.
      // The parent <a> remains a normal link (tap navigates to the section page).
      const tog = e.target.closest && e.target.closest(".sub-toggle");
      if(tog){
        e.preventDefault();
        const li = tog.closest(".has-sub");
        if(li){
          const open = li.classList.toggle("open");
          tog.setAttribute("aria-expanded", open);
        }
        return;
      }
      if(e.target.tagName==="A"){ nav.classList.remove("open"); burger.setAttribute("aria-expanded","false"); }
    });
  }

  // Payments "+" disclosure (v48c): hover/focus opens via CSS on desktop;
  // tap toggles .is-open so the popover stays visible after a touch. Tap-away,
  // blur and Esc dismiss. The button keeps aria-expanded in sync so screen
  // readers track the state.
  document.querySelectorAll(".payline .payplus").forEach(function(btn){
    const wrap = btn.closest(".paywrap");
    if(!wrap) return;
    btn.addEventListener("click", function(e){
      e.stopPropagation();
      const open = wrap.classList.toggle("is-open");
      btn.setAttribute("aria-expanded", open ? "true" : "false");
    });
  });
  document.addEventListener("click", function(e){
    document.querySelectorAll(".payline .paywrap.is-open").forEach(function(w){
      if(!w.contains(e.target)){
        w.classList.remove("is-open");
        const b = w.querySelector(".payplus");
        if(b) b.setAttribute("aria-expanded","false");
      }
    });
  });
  document.addEventListener("keydown", function(e){
    if(e.key !== "Escape") return;
    document.querySelectorAll(".payline .paywrap.is-open").forEach(function(w){
      w.classList.remove("is-open");
      const b = w.querySelector(".payplus");
      if(b){ b.setAttribute("aria-expanded","false"); b.focus(); }
    });
  });

  // /about stats band: animate each .n number from 0 to its target the first
  // time the band scrolls into view. Uses requestAnimationFrame with an
  // easeOutCubic curve over ~1.5s; the <sup> suffix (★, +, /7) is preserved
  // by writing only into the inner .num <span>. prefers-reduced-motion: skip
  // the animation and show the final values immediately.
  (function(){
    const band = document.querySelector(".numband");
    if(!band) return;
    const ns = band.querySelectorAll(".n[data-count]");
    if(!ns.length) return;
    const reduce = matchMedia("(prefers-reduced-motion:reduce)").matches;
    function format(val, n){
      const decimals = parseInt(n.dataset.decimals || "0", 10);
      let s = val.toFixed(decimals);
      if(n.dataset.commas === "1"){
        const parts = s.split(".");
        parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ",");
        s = parts.join(".");
      }
      return s;
    }
    function animate(n){
      const target = parseFloat(n.dataset.count);
      const span = n.querySelector(".num");
      if(!span || isNaN(target)) return;
      if(reduce){ span.textContent = format(target, n); return; }
      const duration = 1500;
      const start = performance.now();
      function tick(t){
        const progress = Math.min((t - start) / duration, 1);
        const eased = 1 - Math.pow(1 - progress, 3);
        span.textContent = format(target * eased, n);
        if(progress < 1) requestAnimationFrame(tick);
      }
      requestAnimationFrame(tick);
    }
    if("IntersectionObserver" in window){
      const io = new IntersectionObserver(function(entries){
        entries.forEach(function(e){
          if(e.isIntersecting){
            ns.forEach(animate);
            io.disconnect();
          }
        });
      }, {threshold:0.35});
      io.observe(band);
    } else {
      ns.forEach(animate);
    }
  })();

  // sticky header state + reserve pill
  const header = document.querySelector("header.site");
  if(header){
    const onScroll = ()=> header.classList.toggle("scrolled", window.scrollY > 420);
    window.addEventListener("scroll", onScroll, {passive:true});
    onScroll();
  }

  // reveal on scroll
  const io = ("IntersectionObserver" in window) ? new IntersectionObserver(es=>{
    es.forEach(e=>{ if(e.isIntersecting){ e.target.classList.add("in"); io.unobserve(e.target); }});
  },{threshold:.12}) : null;
  window.umcObserve = n => { if(io) io.observe(n); else n.classList.add("in"); };
  document.querySelectorAll(".rv").forEach(n=>window.umcObserve(n));

  // booking form: segment toggle + WhatsApp dispatch
  const form = document.getElementById("bookForm");
  if(form){
    const seg = form.querySelectorAll(".seg button");
    const toF = document.getElementById("fTo");
    const hrF = document.getElementById("fHours");
    let mode = "transfer";
    seg.forEach(b=>b.addEventListener("click", ()=>{
      mode = b.dataset.mode;
      seg.forEach(x=>x.classList.toggle("on", x===b));
      if(toF && hrF){
        toF.style.display = mode==="transfer" ? "" : "none";
        hrF.style.display = mode==="hourly" ? "" : "none";
        toF.querySelector("input").required = mode==="transfer";
      }
    }));
    form.addEventListener("submit", e=>{
      e.preventDefault();
      const v = id => (document.getElementById(id)||{}).value || "";
      const q = new URLSearchParams({mode, from:v("bFrom"), to:v("bTo"), hours:v("bHours"), date:v("bDate"), time:v("bTime")});
      window.location.href = "/booking?" + q.toString();
    });
  }

  // branded date & time pickers (after all scripts have loaded)
  document.addEventListener("DOMContentLoaded", function(){
    if(!window.flatpickr) return;
    const d = document.getElementById("bDate");
    const t = document.getElementById("bTime");
    if(d) flatpickr(d, {dateFormat:"D, d M Y", minDate:"today", disableMobile:true});
    if(t) flatpickr(t, {enableTime:true, noCalendar:true, dateFormat:"h:i K", minuteIncrement:5, disableMobile:true});
  });

  // back to top
  const tt = document.createElement("button");
  tt.className = "totop"; tt.setAttribute("aria-label","Back to top");
  tt.innerHTML = '<svg viewBox="0 0 24 24"><path d="M12 19V5M5 12l7-7 7 7"/></svg>';
  document.body.appendChild(tt);
  tt.addEventListener("click", ()=>window.scrollTo({top:0,behavior:"smooth"}));
  window.addEventListener("scroll", ()=>tt.classList.toggle("show", window.scrollY > window.innerHeight), {passive:true});

  // contact page: ?vehicle= prefill
  const params = new URLSearchParams(location.search);
  const veh = params.get("vehicle");
  if(veh){
    const t = document.querySelector("[name=vehicle], #cVehicle");
    if(t) t.value = veh;
  }

  // homepage: shared carousel arrow,testimonials + mobile services (v32).
  // v30: activeIndex is the source of truth (modulo wrap). v31: snap-disable
  // during the programmatic scroll so Safari's mandatory snap engine doesn't
  // fight the smooth animation. v32: compute the scroll target in scroll-
  // container-local coords, not in offsetParent (body) coords.
  //
  // The bug v32 fixes: target.offsetLeft is measured from the element's
  // offsetParent,for our cards that's <body>, because no ancestor in the
  // .tcar/.svp chain is positioned. The scroll container's scrollLeft is in
  // its own coordinate system, which differs from body coords by the
  // container's own offset within the document (the ~20px .wrap padding at
  // mid viewports). v30 was rescued by snap re-correction; v31 disabled snap
  // and the misalignment surfaced as a clipped left edge after arrow nav.
  // Subtracting c.offsetLeft (and any container paddingLeft, defensively for
  // future scroll-padding work) converts target.offsetLeft into the value
  // scrollTo expects, landing the card exactly where a swipe + snap would.
  const wireCarousel = (containerId, cardSelector, prevId, nextId) => {
    const c = document.getElementById(containerId);
    if(!c) return;
    const p = document.getElementById(prevId);
    const n = document.getElementById(nextId);
    let restoreTimer = null;
    const snap = (dir) => {
      const cards = c.querySelectorAll(cardSelector);
      const count = cards.length;
      if(!count) return;
      const padLeft = parseFloat(getComputedStyle(c).paddingLeft) || 0;
      const maxScroll = c.scrollWidth - c.clientWidth;
      const cur = c.scrollLeft;
      const leftOf = (i) => Math.max(0, cards[i].offsetLeft - c.offsetLeft - padLeft);
      // Derive the current index from the ACTUAL scroll position (not a drifting
      // counter) so the arrows stay correct after a swipe, and so a click at the
      // clamped end wraps to the first card in ONE press — the old activeIndex
      // kept incrementing past cards that could no longer scroll (with N cards
      // but only 3 in view, "next" from the end took 3 clicks to wrap).
      let idx = 0, best = Infinity;
      for(let i = 0; i < count; i++){ const d = Math.abs(leftOf(i) - cur); if(d < best){ best = d; idx = i; } }
      let next;
      if(dir > 0){
        next = (cur >= maxScroll - 2 || idx + 1 >= count) ? 0 : idx + 1;   // at the end → first
      } else {
        next = (cur <= 2 || idx - 1 < 0) ? count - 1 : idx - 1;            // at the start → last page
      }
      const targetLeft = Math.min(leftOf(next), maxScroll);
      if(restoreTimer){ clearTimeout(restoreTimer); restoreTimer = null; }
      c.style.scrollSnapType = "none";
      c.scrollTo({left: Math.max(0, targetLeft), behavior: "smooth"});
      restoreTimer = setTimeout(() => {
        c.style.scrollSnapType = "";
        restoreTimer = null;
      }, 650);
    };
    if(p) p.addEventListener("click", () => snap(-1));
    if(n) n.addEventListener("click", () => snap(1));
  };
  wireCarousel("svpCar", ".svp-row", "svprev", "svnext");
  wireCarousel("revCar", ".rev-card", "revPrev", "revNext");
  // REV-4: reveal the "Read more on Google" link only on cards whose quote
  // overflows the 4-line clamp. Re-check after web fonts load (line count shifts)
  // and on resize, so it stays correct across breakpoints.
  var wireRevClamp = function(){
    document.querySelectorAll(".rev-card").forEach(function(card){
      var q = card.querySelector(".rev-quote");
      if(q) card.classList.toggle("is-clamped", q.scrollHeight - q.clientHeight > 2);
    });
  };
  if(document.querySelector(".rev-quote")){
    wireRevClamp();
    if(document.fonts && document.fonts.ready){ document.fonts.ready.then(wireRevClamp); }
    var _revClampT;
    window.addEventListener("resize", function(){ clearTimeout(_revClampT); _revClampT = setTimeout(wireRevClamp, 150); });
  }

  // REV-4: hydrate the Google reviews. Fetch the merged set from /api/reviews
  // (curated 5 first, then live API reviews; live rating for the header). On
  // success we rebuild the whole track so curated cards pick up their real
  // avatar + the API cards appear; on any failure the SSR-baked curated cards
  // stay as-is. User-supplied text/name goes in via textContent (never innerHTML).
  var REV_G = '<svg class="rev-g" viewBox="0 0 24 24" role="img" aria-label="Google">'
    + '<path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>'
    + '<path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>'
    + '<path fill="#FBBC05" d="M5.84 14.1c-.22-.66-.35-1.36-.35-2.1s.13-1.44.35-2.1V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.62z"/>'
    + '<path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z"/></svg>';
  var REV_STARS = '<div class="rev-stars" aria-hidden="true">★★★★★</div>';
  var REV_CHECK = '<svg class="rev-check" viewBox="0 0 24 24" role="img" aria-label="Verified">'
    + '<path fill="#4285F4" d="M12 1.6l2.35 1.78 2.94-.2 1 2.78 2.78 1-.2 2.94L23.4 12l-1.73 2.3.2 2.94-2.78 1-1 2.78-2.94-.2L12 22.4l-2.35-1.78-2.94.2-1-2.78-2.78-1 .2-2.94L1.6 12l1.73-2.3-.2-2.94 2.78-1 1-2.78 2.94.2z"/>'
    + '<path fill="#fff" d="M10.6 14.68l-2.28-2.28-1.2 1.2 3.48 3.48 6-6-1.2-1.2z"/></svg>';
  var buildRevCard = function(c, gbp){
    var art = document.createElement("article");
    art.className = "rev-card";
    art.innerHTML =
      '<div class="rev-top">' + REV_G + REV_STARS + '</div>'
      + '<blockquote class="rev-quote"></blockquote>'
      + '<a class="rev-more" target="_blank" rel="noopener"></a>'
      + '<footer class="rev-foot"><span class="rev-av" aria-hidden="true"></span>'
      + '<span class="rev-id"><span class="rev-name"></span><span class="rev-2nd"></span></span></footer>';
    art.querySelector(".rev-quote").textContent = c.text || "";
    var more = art.querySelector(".rev-more");
    more.href = gbp; more.textContent = "Read more on Google";
    var av = art.querySelector(".rev-av");
    av.textContent = ((c.author || "?").trim().charAt(0) || "?").toUpperCase();
    if(c.photoUri){
      var img = document.createElement("img");
      // Eager, not lazy: these avatars sit in a horizontally-scrolling track, and
      // loading="lazy" never fires for cards parked off-screen to the right, so the
      // Google avatars silently never loaded. They're tiny (128px, <=5 of them),
      // so eager loading costs nothing. onerror still falls back to the monogram.
      img.referrerPolicy = "no-referrer"; img.decoding = "async"; img.alt = "";
      img.onerror = function(){ this.remove(); };
      img.src = c.photoUri;
      av.appendChild(img);
    }
    var nameEl = art.querySelector(".rev-name");
    nameEl.appendChild(document.createTextNode(c.author || ""));
    nameEl.insertAdjacentHTML("beforeend", REV_CHECK);
    // REV-4-AMEND: the muted mono second line renders ONLY for curated cards
    // (their context tag). API cards show avatar + name + verified check and
    // nothing dated — drop the node entirely so no relative-time can appear.
    var second = art.querySelector(".rev-2nd");
    if(c.curated){ second.textContent = c.tag || ""; }
    else { second.remove(); }
    return art;
  };
  var revTrack = document.getElementById("revCar");
  if(revTrack && window.fetch){
    fetch("/api/reviews", {headers: {"Accept": "application/json"}})
      .then(function(r){ return r.ok ? r.json() : null; })
      .then(function(d){
        if(!d || !Array.isArray(d.reviews) || !d.reviews.length) return;
        var rt = document.getElementById("revRating");
        if(rt && d.rating){ rt.textContent = (Math.round(d.rating * 10) / 10).toFixed(1); }
        var gbp = d.gbpLink || "https://maps.app.goo.gl/UdPJ9VDBtFegaeX56";
        var frag = document.createDocumentFragment();
        d.reviews.forEach(function(c){ frag.appendChild(buildRevCard(c, gbp)); });
        revTrack.innerHTML = "";
        revTrack.appendChild(frag);
        wireRevClamp();
        if(document.fonts && document.fonts.ready){ document.fonts.ready.then(wireRevClamp); }
      })
      .catch(function(){ /* keep the SSR-baked curated cards */ });
  }

  // phone fields: live filtering + per-country length validation (booking + contact)
  if(window.umcPhone){
    window.umcPhone.wire(document.getElementById("kCC"), document.getElementById("kPhone"));
    window.umcPhone.wire(document.getElementById("cCC"), document.getElementById("cPhone"));
  }
})();

// CONV-WIRE: WhatsApp click → GA4 whatsapp_click (was a dead dataLayer push). This site
// links via api.whatsapp.com/send, not wa.me, so the selector matches both. Delegated once.
document.addEventListener('click', function(e){
  var a = e.target && e.target.closest && e.target.closest('a[href*="wa.me"], a[href*="api.whatsapp.com"]');
  if(!a || typeof gtag !== 'function') return;
  try{ gtag('event','whatsapp_click',{ link_context: (a.closest('[data-vehicle]')?.dataset.vehicle) || document.title.slice(0,60) }); }catch(e2){}
});

// homepage: Google Places on the hero form (ICONS-2.1). Uses the SAME shared
// dropdown as the booking form (window.umcAutocomplete) — branded type icons,
// session tokens, keyboard/ARIA — instead of the plain google Autocomplete
// widget. The hero form only needs the chosen text (it hands off to /booking
// via ?from=&to=), so it runs predictions-only (no getDetails); on select the
// full prediction description is written to the field, so the booking page's
// airport-token + Terminal-3 detection reads the same value it always did.
window.umcHomeMaps = function(){
  try{
    if(!window.umcAutocomplete) return;
    const svc = new google.maps.places.AutocompleteService();
    let session = new google.maps.places.AutocompleteSessionToken();
    ["bFrom","bTo"].forEach(id=>{
      const el = document.getElementById(id);
      if(!el) return;
      window.umcAutocomplete.attach(el, {
        service: svc, country:"ae", which:id,
        getSession: function(){ return session; },
        newSession: function(){ return new google.maps.places.AutocompleteSessionToken(); },
        onSession: function(t){ session = t; },
        detailFields: null,
        onSelect: function(){}
      });
    });
  }catch(e){}
};

// UI-5 item 3: Journal Newest/Oldest sort. No-ops on every page except /blog/
// (guarded by .blog-sort). Re-orders .blog-card by data-date (ISO strings sort
// lexicographically). Default render is already newest-first; this lets the reader flip it.
(function(){
  var sorter = document.querySelector(".blog-sort");
  var grid = document.querySelector(".blog-grid");
  if(!sorter || !grid) return;
  var btns = sorter.querySelectorAll("button");
  function apply(dir){
    var cards = Array.prototype.slice.call(grid.querySelectorAll(".blog-card"));
    cards.sort(function(a,b){
      var da = a.getAttribute("data-date") || "", db = b.getAttribute("data-date") || "";
      if(da === db) return 0;
      var newer = da > db ? -1 : 1;
      return dir === "oldest" ? -newer : newer;
    });
    cards.forEach(function(c){ grid.appendChild(c); });
  }
  btns.forEach(function(btn){
    btn.addEventListener("click", function(){
      btns.forEach(function(b){ b.classList.remove("on"); b.setAttribute("aria-pressed","false"); });
      btn.classList.add("on"); btn.setAttribute("aria-pressed","true");
      apply(btn.getAttribute("data-sort"));
    });
  });
})();

// CONV-WIRE: tel: click → GA4 phone_click (promotable to an Ads conversion later).
// Delegated so it covers header, footer and body links. WhatsApp is handled by the
// dedicated listener above. gtag() is the shared-head shim; no-ops if absent.
(function(){
  document.addEventListener("click", function(e){
    var a = e.target && e.target.closest ? e.target.closest('a[href^="tel:"]') : null;
    if(!a || typeof gtag !== "function") return;
    gtag("event","phone_click",{ link_url: a.getAttribute("href") || "" });
  });
})();
