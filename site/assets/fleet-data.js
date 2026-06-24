/* © UMC Dubai LLC. All rights reserved. Unauthorised reproduction of this code or design is prohibited and monitored. */
/* UMC Dubai,fleet data + renderer (single source of truth) */
const UMC_FLEET_KEY = "umc_fleet";

/* v56: per-emirate × per-vehicle rates [airport, 5h, 10h] in AED, all-inclusive.
   Sourced verbatim from umcdubai.ae live pricing. Sprinter & King Long are
   quote-only on every emirate, so they're omitted here and fall back to the
   vehicle's own null rates (renders as "On request"). Fujairah has no live
   prices on source, so it's omitted (would-be invented numbers blocked). */
const UMC_EMIRATES = [
  ["dubai", "Dubai"],
  ["abu-dhabi", "Abu Dhabi"],
  ["sharjah", "Sharjah"],
  ["rak", "Ras Al Khaimah"],
  ["al-ain", "Al Ain"],
  ["umm-al-quwain", "Umm Al Quwain"]
];
const UMC_RATES = {
  "dubai": {
    "bmw-7":             [600, 1300, 2000],
    "mb-s-class":        [850, 1800, 2400],
    "gmc-yukon-xl":      [550,  900, 1400],
    "mb-v-class":        [500, 1000, 1400],
    "lexus-es":          [350,  700, 1000],
    "mb-e-class":        [400, 1150, 1600],
    "cadillac-escalade": [850, 1800, 2400]
  },
  "abu-dhabi": {
    "bmw-7":             [800, 1500, 2200],
    "mb-s-class":        [1300, 2000, 2600],
    "gmc-yukon-xl":      [750, 1100, 1600],
    "mb-v-class":        [650, 1150, 1550],
    "lexus-es":          [500,  850, 1150],
    "mb-e-class":        [650, 1350, 1800],
    "cadillac-escalade": [1200, 2000, 2600]
  },
  "sharjah": {
    "bmw-7":             [800, 1500, 2200],
    "mb-s-class":        [1050, 1900, 2500],
    "gmc-yukon-xl":      [750, 1100, 1600],
    "mb-v-class":        [550, 1050, 1450],
    "lexus-es":          [450,  800, 1100],
    "mb-e-class":        [600, 1300, 1750],
    "cadillac-escalade": [1050, 1900, 2500]
  },
  "rak": {
    "bmw-7":             [800, 1500, 2200],
    "mb-s-class":        [1300, 2000, 2600],
    "gmc-yukon-xl":      [750, 1100, 1600],
    "mb-v-class":        [700, 1200, 1600],
    "lexus-es":          [550,  900, 1200],
    "mb-e-class":        [600, 1350, 1800],
    "cadillac-escalade": [1200, 2000, 2600]
  },
  "al-ain": {
    "bmw-7":             [800, 1500, 2200],
    "mb-s-class":        [1300, 2000, 2600],
    "gmc-yukon-xl":      [750, 1100, 1600],
    "mb-v-class":        [700, 1200, 1600],
    "lexus-es":          [500,  850, 1150],
    "mb-e-class":        [650, 1350, 1800],
    "cadillac-escalade": [1200, 2000, 2600]
  },
  "umm-al-quwain": {
    "bmw-7":             [850, 1600, 2300],
    "mb-s-class":        [1300, 2050, 2650],
    "gmc-yukon-xl":      [800, 1200, 1700],
    "mb-v-class":        [700, 1200, 1600],
    "lexus-es":          [600,  950, 1250],
    "mb-e-class":        [650, 1450, 1900],
    "cadillac-escalade": [1300, 2050, 2650]
  }
};
function umcRatesFor(vid, em){
  if(em && UMC_RATES[em] && UMC_RATES[em][vid]){
    const t = UMC_RATES[em][vid];
    return {ra:t[0], r5:t[1], r10:t[2]};
  }
  return null;
}

const DEFAULT_FLEET = [
  {id:"mb-s-class",marque:"/assets/marques/mercedes.png",name:"Mercedes Benz S-Class",category:"Flagship Sedan",year:2024,seats:4,luggage:2,
   r10:2400,r5:1800,ra:850,visible:true,page:"/fleet/s-class",
   /* TEMPORARY,replace with real UMC S-Class photography when supplied.
      flipImg flips the source horizontally so the car faces left, matching the
      other fleet cards. */
   img:"/assets/fleet/s-class/card.webp",photo:true,flipImg:true,
   desc:"The reference point for executive travel. Reclining rear seats, supreme quiet."},
  {id:"bmw-7",marque:"/assets/marques/bmw.png",name:"BMW 7 Series",category:"Flagship Sedan",year:2024,seats:4,luggage:2,
   r10:2000,r5:1300,ra:600,visible:true,page:"/fleet/bmw-7-series",
   /* TEMPORARY,replace with real UMC BMW 7 Series photography when supplied. */
   img:"/assets/fleet/bmw-7/card.png",photo:true,
   desc:"Commanding presence with a lounge-grade rear cabin."},
  {id:"cadillac-escalade",marque:"/assets/marques/cadillac.jpg",name:"Cadillac Escalade",category:"Luxury SUV",year:2024,seats:6,luggage:4,
   r10:2400,r5:1800,ra:850,visible:true,page:"/fleet/cadillac-escalade",
   img:"/assets/fleet/cadillac-escalade/cadillac-escalade.jpg",
   desc:"Seven seats of unmistakable American luxury."},
  {id:"gmc-yukon-xl",marque:"/assets/marques/gmc.png",name:"GMC Yukon Elevation XL",category:"Executive SUV",year:2025,seats:6,luggage:5,
   r10:1400,r5:900,ra:550,visible:true,page:"/fleet/gmc-yukon-xl",
   img:"/assets/fleet/gmc-yukon-xl/gmc-yukon-xl.png",
   desc:"Generous space for passengers and luggage alike."},
  {id:"mb-e-class",marque:"/assets/marques/mercedes.png",name:"Mercedes Benz E-Class",category:"Business Sedan",year:2025,seats:4,luggage:2,
   r10:1600,r5:1150,ra:400,visible:true,page:"/fleet/e-class",
   /* TEMPORARY,replace with real UMC E-Class photography when supplied. */
   img:"/assets/fleet/e-class/card.png",photo:true,
   desc:"The businessman's benchmark, refined again."},
  {id:"lexus-es",marque:"/assets/marques/lexus.jpg",name:"Lexus ES",category:"Business Sedan",year:2024,seats:4,luggage:2,
   r10:1000,r5:700,ra:350,visible:true,page:"/fleet/lexus-es",
   img:"/assets/fleet/lexus-es/lexus-es.png",
   desc:"Quiet confidence and remarkable comfort."},
  {id:"mb-v-class",marque:"/assets/marques/mercedes.png",name:"Mercedes Benz V-Class",category:"Luxury Van",year:2024,seats:7,luggage:5,
   r10:1400,r5:1000,ra:500,visible:true,page:"/fleet/v-class",
   img:"/assets/fleet/v-class/v-class.png",
   desc:"First-class travel for up to seven, face to face."},
  {id:"mb-sprinter",marque:"/assets/marques/mercedes.png",name:"Mercedes Benz Sprinter",category:"Executive Van",year:2025,seats:19,luggage:10,
   r10:null,r5:null,ra:null,visible:true,page:"/fleet/sprinter",
   img:"/assets/fleet/sprinter/sprinter.png",
   desc:"10, 13 or 19 seats for delegations and crews."},
  {id:"luxury-coach",marque:"/assets/marques/king-long.png",name:"Luxury Coach",category:"Luxury Coach",year:2025,seats:55,luggage:30,
   r10:null,r5:null,ra:null,visible:true,page:"/fleet/luxury-coach",
   img:"/assets/fleet/king-long/king-long.png",
   desc:"35 or 55 seats for events and group movements."}
];

function getFleet(){
  try{
    const s = localStorage.getItem(UMC_FLEET_KEY);
    if(s){ const a = JSON.parse(s); if(Array.isArray(a) && a.length) return a; }
  }catch(e){}
  return DEFAULT_FLEET.map(v=>({...v}));
}
function saveFleet(a){ localStorage.setItem(UMC_FLEET_KEY, JSON.stringify(a)); }
function resetFleet(){ localStorage.removeItem(UMC_FLEET_KEY); }
function fmtRate(n){ return (n===null||n===undefined||n==="") ? "On request" : "AED " + Number(n).toLocaleString(); }
function fromRate(v){
  const xs = [v.ra, v.r5, v.r10].filter(n=>n!==null && n!==undefined && n!=="");
  return xs.length ? "AED " + Math.min(...xs.map(Number)).toLocaleString() : null;
}
function esc(s){ return String(s??"").replace(/[&<>"]/g, c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c])); }
// Raster cards (png/jpg/jpeg/webp) emit srcset to the 360w + 720w variants
// generated by build_pages.py; SVG placeholders are vector and need no variants.
// width/height + the CSS aspect-ratio on .vcard .vimg img reserve the 16:10 box
// from the very first paint so the card layout doesn't shift as images decode.
function cardImg(v){
  const src = esc(v.img);
  const alt = esc(v.name) + ",chauffeur driven in Dubai with UMC";
  const m = String(v.img||"").match(/^(.*)\.(png|jpe?g|webp)$/i);
  if(!m) return `<img src="${src}" width="1200" height="750" alt="${alt}" loading="lazy" decoding="async">`;
  const base = m[1], ext = m[2];
  const v360  = `${base}-360.${ext}`;
  const v720  = `${base}-720.${ext}`;
  const v1080 = `${base}-1080.${ext}`;
  // Phase-1.x — bumped sizes from 320px to 380px so the browser picks the
  // 1080w / 1200w source on retina (was choosing 720w and upscaling it).
  return `<img src="${src}" srcset="${v360} 360w, ${v720} 720w, ${v1080} 1080w, ${src} 1200w" sizes="(max-width:560px) 92vw, (max-width:980px) 45vw, 380px" width="1200" height="750" alt="${alt}" loading="lazy" decoding="async">`;
}

/* v56: row-mate stretch fix. CSS grid forces cards in the same row to
   match the tallest one,so when one expands its rates, neighbours grew
   to the same height but showed empty space. Solution: when one card
   opens, find every visible sibling whose top edge matches (same grid
   row) and open them together. They each render their OWN rates, so the
   stretched space is now filled, not blank. */
function umcRowMates(card){
  const parent = card.parentElement;
  if(!parent) return [card];
  const top = card.offsetTop;
  return Array.from(parent.children).filter(c =>
    c.classList && c.classList.contains("vcard") &&
    c.style.display !== "none" &&
    Math.abs(c.offsetTop - top) < 3
  );
}

function renderFleet(el, opts){
  if(!el) return;
  opts = opts || {};
  const defaultEm = opts.emirate || "dubai";
  let fleet = getFleet().filter(v=>v.visible!==false);
  if(opts.featured) fleet = opts.featured.map(id=>fleet.find(v=>v.id===id)).filter(Boolean);
  if(opts.limit) fleet = fleet.slice(0, opts.limit);
  el.innerHTML = fleet.map(v=>{
    const ovr = umcRatesFor(v.id, defaultEm);
    const rv = ovr ? {ra:ovr.ra, r5:ovr.r5, r10:ovr.r10, name:v.name, seats:v.seats, luggage:v.luggage, category:v.category, page:v.page, marque:v.marque, img:v.img, photo:v.photo, flipImg:v.flipImg, id:v.id} : v;
    const from = fromRate(rv);
    const bk = "booking.html?vehicle=" + encodeURIComponent(v.id);
    const opts = UMC_EMIRATES.map(p =>
      `<option value="${p[0]}"${p[0]===defaultEm?" selected":""}>${p[1]}</option>`
    ).join("");
    return `<article class="vcard rv" data-cat="${esc(v.category)}" data-vid="${esc(v.id)}">
      <div class="vimg${v.photo?" photo":""}${v.flipImg?" flip":""}">${cardImg(v)}</div>
      <div class="vbody">
        <div class="vtitle"><h3>${v.page?`<a href="${esc(v.page)}">${esc(v.name)}</a>`:esc(v.name)}</h3>${v.marque?`<img class="marque" src="${esc(v.marque)}" alt="" loading="lazy">`:""}</div>
        <div class="vmeta"><span>${esc(v.category)}</span><span>${v.seats} guests</span><span>${v.luggage} cases</span></div>
        <div class="vprice">${ from
          ? `<span class="from">From</span><b>${from}</b><span class="from">all-inclusive</span>`
          : `<b style="font-size:1rem">Rates on request</b>` }</div>
        <div class="vdetail">
          <label class="em-switch"><span class="em-lbl">Rates for</span><select class="em-select" aria-label="Choose emirate for rates">${opts}</select></label>
          <div class="r" data-rate="ra"><span>Airport transfer</span><b>${fmtRate(rv.ra)}</b></div>
          <div class="r" data-rate="r5"><span>5 hours at disposal</span><b>${fmtRate(rv.r5)}</b></div>
          <div class="r" data-rate="r10"><span>10 hours at disposal</span><b>${fmtRate(rv.r10)}</b></div>
          <p class="inc">Includes chauffeur, fuel, Salik &amp; parking, unlimited city mileage, water and chargers. Free cancellation up to 48 hours.</p>
        </div>
        <div class="vactions">
          <button class="vtoggle" type="button" aria-expanded="false">View rates
            <svg viewBox="0 0 24 24" style="width:11px;height:11px;stroke:currentColor;fill:none;stroke-width:2;margin-left:.35rem;transition:transform .25s"><path d="M5 9l7 7 7-7"/></svg>
          </button>
          <span class="vctas">
            <a class="ico" target="_blank" rel="noopener" aria-label="WhatsApp about the ${esc(v.name)}" href="https://api.whatsapp.com/send?phone=971586497861&text=${encodeURIComponent("Hello UMC Dubai, I would like to reserve the " + v.name + ".")}"><svg viewBox="0 0 24 24"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/></svg></a>
            <a class="ico" aria-label="Call about the ${esc(v.name)}" href="tel:+971586497861"><svg viewBox="0 0 24 24" style="fill:none;stroke:currentColor;stroke-width:1.7"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 22 16.92z"/></svg></a>
            <a class="btn btn-ink vcta" href="${bk}">Reserve</a>
          </span>
        </div>
      </div>
    </article>`;
  }).join("");
  el.querySelectorAll(".vtoggle").forEach(b=>{
    b.addEventListener("click", ()=>{
      const card = b.closest(".vcard");
      const willOpen = !card.classList.contains("openx");
      umcRowMates(card).forEach(m => {
        m.classList.toggle("openx", willOpen);
        const btn = m.querySelector(".vtoggle");
        if(btn) btn.setAttribute("aria-expanded", willOpen ? "true" : "false");
      });
    });
  });
  // v59: dropdown selector (was pill bar). Same data, cleaner control.
  el.querySelectorAll(".em-select").forEach(sel=>{
    sel.addEventListener("change", (ev)=>{
      ev.stopPropagation();
      const card = sel.closest(".vcard");
      if(!card) return;
      const em = sel.value;
      const vid = card.dataset.vid;
      const baseV = getFleet().find(x=>x.id===vid) || {ra:null,r5:null,r10:null};
      const ovr = umcRatesFor(vid, em);
      const rates = ovr ? ovr : {ra:baseV.ra, r5:baseV.r5, r10:baseV.r10};
      const setR = (k, val)=>{
        const b = card.querySelector('.r[data-rate="'+k+'"] b');
        if(b) b.textContent = fmtRate(val);
      };
      setR("ra", rates.ra); setR("r5", rates.r5); setR("r10", rates.r10);
      const xs = [rates.ra, rates.r5, rates.r10].filter(n=>n!==null && n!==undefined && n!=="");
      const priceEl = card.querySelector(".vprice");
      if(priceEl){
        if(xs.length){
          const min = Math.min(...xs.map(Number));
          priceEl.innerHTML = '<span class="from">From</span><b>AED ' + min.toLocaleString() + '</b><span class="from">all-inclusive</span>';
        } else {
          priceEl.innerHTML = '<b style="font-size:1rem">Rates on request</b>';
        }
      }
    });
    // Stop label clicks bubbling to vtoggle when the user opens the select.
    const lbl = sel.closest(".em-switch");
    if(lbl) lbl.addEventListener("click", e => e.stopPropagation());
  });
  if(window.umcObserve) el.querySelectorAll(".rv").forEach(n=>window.umcObserve(n));
  else el.querySelectorAll(".rv").forEach(n=>n.classList.add("in"));
}
