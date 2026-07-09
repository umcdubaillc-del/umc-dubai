/* © UMC Dubai LLC. All rights reserved. Unauthorised reproduction of this code or design is prohibited and monitored. */
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
    let activeIndex = 0;
    let restoreTimer = null;
    const snap = (dir) => {
      const cards = c.querySelectorAll(cardSelector);
      const count = cards.length;
      if(!count) return;
      activeIndex = ((activeIndex + dir) % count + count) % count;
      const target = cards[activeIndex];
      const padLeft = parseFloat(getComputedStyle(c).paddingLeft) || 0;
      const targetLeft = target.offsetLeft - c.offsetLeft - padLeft;
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
  wireCarousel("tcar", ".tc", "tprev", "tnext");
  wireCarousel("svpCar", ".svp-row", "svprev", "svnext");

  // phone fields: live filtering + per-country length validation (booking + contact)
  if(window.umcPhone){
    window.umcPhone.wire(document.getElementById("kCC"), document.getElementById("kPhone"));
    window.umcPhone.wire(document.getElementById("cCC"), document.getElementById("cPhone"));
  }
})();

// WhatsApp click signal for GTM (A2). This site links via api.whatsapp.com/send,
// not wa.me, so the selector matches both. Delegated + attached once globally.
document.addEventListener('click', function(e){
  var a = e.target && e.target.closest && e.target.closest('a[href*="wa.me"], a[href*="api.whatsapp.com"]');
  if(!a) return;
  try{
    window.dataLayer = window.dataLayer || [];
    window.dataLayer.push({ event: 'whatsapp_click', link_context: (a.closest('[data-vehicle]')?.dataset.vehicle) || document.title.slice(0,60) });
  }catch(e2){}
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
