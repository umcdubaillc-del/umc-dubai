/* © UMC Dubai LLC. All rights reserved. Unauthorised reproduction of this code or design is prohibited and monitored. */
/* UMC Dubai — shared behaviour */

// shared phone utility (must exist before the IIFE wires forms, and before booking.js runs)
window.umcPhone = {
  // strip non-digits; do NOT strip leading zero here — only for length check / output
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
    nav.addEventListener("click", e=>{ if(e.target.tagName==="A"){ nav.classList.remove("open"); burger.setAttribute("aria-expanded","false"); }});
  }

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
      window.location.href = "booking.html?" + q.toString();
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

  // homepage: testimonials carousel — index-based scrollIntoView (v25 redux).
  // Earlier versions did arithmetic on scrollLeft/step which could overshoot into the
  // rubber-band area or land between cards. scrollIntoView always lands on a real
  // card, so the "blank card" class of bug is impossible. We compute the active card
  // from its DOM position, step by the visible card count, and wrap when we run off
  // either end — no maxScroll math, no stale slide counts.
  const tcar = document.getElementById("tcar");
  if(tcar){
    const snap = (dir) => {
      const cards = Array.from(tcar.querySelectorAll(".tc"));
      if(!cards.length) return;
      const left = tcar.scrollLeft;
      const tolerance = 12;
      let active = 0;
      cards.forEach((c, i) => { if(c.offsetLeft <= left + tolerance) active = i; });
      const per = Math.max(1, Math.round(tcar.clientWidth / cards[0].offsetWidth));
      let next = active + dir * per;
      if(next < 0) next = Math.max(0, cards.length - per);     // before first → loop to last page
      else if(next > cards.length - 1) next = 0;               // past last → loop to first
      next = Math.max(0, Math.min(cards.length - 1, next));
      cards[next].scrollIntoView({behavior: "smooth", inline: "start", block: "nearest"});
    };
    const tprev = document.getElementById("tprev");
    const tnext = document.getElementById("tnext");
    if(tprev) tprev.addEventListener("click", () => snap(-1));
    if(tnext) tnext.addEventListener("click", () => snap(1));
  }

  // (v26: services use CSS-only hover animation — no JS handler needed; the .svp-row
  // markup is a plain <a>, so touch follows the link on tap and desktop fires :hover.)

  // phone fields: live filtering + per-country length validation (booking + contact)
  if(window.umcPhone){
    window.umcPhone.wire(document.getElementById("kCC"), document.getElementById("kPhone"));
    window.umcPhone.wire(document.getElementById("cCC"), document.getElementById("cPhone"));
  }
})();

// homepage: Google Places on the hero form
window.umcHomeMaps = function(){
  try{
    const opts = {componentRestrictions:{country:"ae"}, fields:["formatted_address","name"]};
    ["bFrom","bTo"].forEach(id=>{
      const el = document.getElementById(id);
      if(el) new google.maps.places.Autocomplete(el, opts);
    });
  }catch(e){}
};
