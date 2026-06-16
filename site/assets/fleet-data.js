/* © UMC Dubai LLC. All rights reserved. Unauthorised reproduction of this code or design is prohibited and monitored. */
/* UMC Dubai — fleet data + renderer (single source of truth) */
const UMC_FLEET_KEY = "umc_fleet";

const DEFAULT_FLEET = [
  {id:"mb-s-class",marque:"https://umcdubai.ae/wp-content/uploads/2024/10/mercedes.png",name:"Mercedes-Benz S-Class",category:"Flagship Sedan",year:2024,seats:4,luggage:2,
   r10:2400,r5:1800,ra:850,visible:true,page:"fleet/s-class",
   /* TEMPORARY — replace with real UMC S-Class photography when supplied.
      flipImg flips the source horizontally so the car faces left, matching the
      other fleet cards. */
   img:"assets/fleet/s-class/card.webp",photo:true,flipImg:true,
   desc:"The reference point for executive travel. Reclining rear seats, supreme quiet."},
  {id:"bmw-7",marque:"https://umcdubai.ae/wp-content/uploads/2024/10/bmw.png",name:"BMW 7 Series",category:"Flagship Sedan",year:2024,seats:4,luggage:2,
   r10:2000,r5:1300,ra:600,visible:true,page:"fleet/bmw-7-series",
   /* TEMPORARY — replace with real UMC BMW 7 Series photography when supplied. */
   img:"assets/fleet/bmw-7/card.png",photo:true,
   desc:"Commanding presence with a lounge-grade rear cabin."},
  {id:"cadillac-escalade",marque:"https://umcdubai.ae/wp-content/uploads/2024/10/Cadillac-Logo-scaled.jpg",name:"Cadillac Escalade",category:"Luxury SUV",year:2024,seats:6,luggage:4,
   r10:2400,r5:1800,ra:850,visible:true,page:"fleet/cadillac-escalade",
   img:"https://shop.vipautoaccessories.com/cdn/shop/products/Profile_a3cdee2d-dcae-45a1-9ac0-67df4e3c3965_540x.jpg?v=1676323971",
   desc:"Seven seats of unmistakable American luxury."},
  {id:"gmc-yukon-xl",marque:"https://umcdubai.ae/wp-content/uploads/2024/12/gmc.png",name:"GMC Yukon Elevation XL",category:"Executive SUV",year:2025,seats:6,luggage:5,
   r10:1400,r5:900,ra:550,visible:true,page:"fleet/gmc-yukon-xl",
   img:"https://cgi.gmc.com/mmgprod-us/dynres/prove/image.gen?i=2025/TK10906/TK10906__4SA/GBAgmds2.jpg&v=deg43&std=true&country=US&removeCat=&BYO=true&background=&transparentBackgroundPng=true",
   desc:"Generous space for passengers and luggage alike."},
  {id:"mb-e-class",marque:"https://umcdubai.ae/wp-content/uploads/2024/10/mercedes.png",name:"Mercedes-Benz E-Class",category:"Business Sedan",year:2025,seats:4,luggage:2,
   r10:1600,r5:1150,ra:400,visible:true,page:"fleet/e-class",
   /* TEMPORARY — replace with real UMC E-Class photography when supplied. */
   img:"assets/fleet/e-class/card.png",photo:true,
   desc:"The businessman's benchmark, refined again."},
  {id:"lexus-es",marque:"https://umcdubai.ae/wp-content/uploads/2024/09/lexus.jpg",name:"Lexus ES",category:"Business Sedan",year:2024,seats:4,luggage:2,
   r10:1000,r5:700,ra:350,visible:true,page:"fleet/lexus-es",
   img:"https://www.lexusmontgomery.com/static/brand-lexus/vehicle/2024/LSh/LEX-LSH-MY24-0006.06.png",
   desc:"Quiet confidence and remarkable comfort."},
  {id:"mb-v-class",marque:"https://umcdubai.ae/wp-content/uploads/2024/10/mercedes.png",name:"Mercedes-Benz V-Class",category:"Luxury Van",year:2024,seats:7,luggage:5,
   r10:1400,r5:1000,ra:500,visible:true,page:"fleet/v-class",
   img:"https://corfuviptransfers.com/wp-content/uploads/2022/03/Mercedes-Benz-E-Class.png",
   desc:"First-class travel for up to seven, face to face."},
  {id:"mb-sprinter",marque:"https://umcdubai.ae/wp-content/uploads/2024/10/mercedes.png",name:"Mercedes-Benz Sprinter",category:"Executive Van",year:2025,seats:19,luggage:10,
   r10:null,r5:null,ra:null,visible:true,page:"fleet/sprinter",
   img:"https://vehicle-images.carscommerce.inc/stock-images/chrome/3ebcb3939f837a801fdf17729968a53f.png",
   desc:"10, 13 or 19 seats for delegations and crews."},
  {id:"king-long",marque:"https://umcdubai.ae/wp-content/uploads/2025/04/kinglong.png",name:"King Long Coach",category:"Luxury Coach",year:2025,seats:55,luggage:30,
   r10:null,r5:null,ra:null,visible:true,page:"fleet/king-long",
   img:"https://www.king-long.com/upload/image/2025-09/col29/1757570468794.png",
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

function renderFleet(el, opts){
  if(!el) return;
  opts = opts || {};
  let fleet = getFleet().filter(v=>v.visible!==false);
  if(opts.featured) fleet = opts.featured.map(id=>fleet.find(v=>v.id===id)).filter(Boolean);
  if(opts.limit) fleet = fleet.slice(0, opts.limit);
  el.innerHTML = fleet.map(v=>{
    const from = fromRate(v);
    const bk = "booking.html?vehicle=" + encodeURIComponent(v.id);
    return `<article class="vcard rv" data-cat="${esc(v.category)}">
      <div class="vimg${v.photo?" photo":""}${v.flipImg?" flip":""}"><img src="${esc(v.img)}" alt="${esc(v.name)} — chauffeur-driven in Dubai with UMC" loading="lazy"></div>
      <div class="vbody">
        <div class="vtitle"><h3>${v.page?`<a href="${esc(v.page)}">${esc(v.name)}</a>`:esc(v.name)}</h3>${v.marque?`<img class="marque" src="${esc(v.marque)}" alt="" loading="lazy">`:""}</div>
        <div class="vmeta"><span>${esc(v.category)}</span><span>${v.seats} guests</span><span>${v.luggage} cases</span></div>
        <div class="vprice">${ from
          ? `<span class="from">From</span><b>${from}</b><span class="from">all-inclusive</span>`
          : `<b style="font-size:1rem">Rates on request</b>` }</div>
        <div class="vdetail">
          <div class="r"><span>Airport transfer</span><b>${fmtRate(v.ra)}</b></div>
          <div class="r"><span>5 hours at disposal</span><b>${fmtRate(v.r5)}</b></div>
          <div class="r"><span>10 hours at disposal</span><b>${fmtRate(v.r10)}</b></div>
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
      const open = card.classList.toggle("openx");
      b.setAttribute("aria-expanded", open);
    });
  });
  if(window.umcObserve) el.querySelectorAll(".rv").forEach(n=>window.umcObserve(n));
  else el.querySelectorAll(".rv").forEach(n=>n.classList.add("in"));
}
