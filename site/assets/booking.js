/* © UMC Dubai LLC. All rights reserved. Unauthorised reproduction of this code or design is prohibited and monitored. */
/* UMC Dubai,reservation flow */

function trackLead(formId, service){
  try{
    window.dataLayer = window.dataLayer || [];
    window.dataLayer.push({ event: 'lead_submit', form_id: formId, service: service || '' });
  }catch(e){}
}

// Turnstile: render explicitly. The async api.js in <head> runs its one-time
// auto-scan before #bkTs is parsed, so implicit auto-render is unreliable. The
// cf-turnstile class was removed from #bkTs so only this explicit render runs.
(function(){
  function renderTs(){
    var el = document.getElementById('bkTs');
    if(!window.turnstile || !el) return false;
    if(el.getAttribute('data-rendered') === '1') return true;
    try {
      window.turnstile.render(el, {
        sitekey: el.getAttribute('data-sitekey'),
        callback: function(){},
        'error-callback': function(){ return true; }
      });
      el.setAttribute('data-rendered','1');
      return true;
    } catch(e){ return false; }
  }
  if(!renderTs()){
    var n=0, iv=setInterval(function(){ if(renderTs() || ++n>50) clearInterval(iv); }, 200);
  }
})();

(function(){
  const $ = id => document.getElementById(id);
  const params = new URLSearchParams(location.search);
  const PHONE = "971586497861";
  // FAQ-2-REV C: airport detection token set — MIRRORED with the server's
  // LEAD_AIRPORT_RX in src/admin.js. Keep the two token lists in step (no drift).
  const AIRPORT_RX = new RegExp("\\b(airport|terminal|arrivals|departures|dxb|dwc|auh|shj|rkt|dubai international|al maktoum|maktoum international|zayed international|abu dhabi international|sharjah international|ras al khaimah international|al ain international)\\b","i");
  // DXB Terminal 3 is board-free (the chauffeur confirms the meeting point on
  // WhatsApp), so the Welcome-sign field is suppressed when the PICKUP is T3.
  // Word-bounded so "DXB Terminal 3 Parking" / "DXB T3" match but "part3" won't.
  const T3_RX = new RegExp("\\bterminal 3\\b|\\bt3\\b","i");

  // BOOK-P3 §F: vehicle preference is OPTIONAL. The default selection is the
  // concierge, so the form is never blocked on picking a car; a ?vehicle= param
  // (from a fleet page's "Reserve") still preselects a specific car below.
  const CONCIERGE = "concierge";
  const state = { service: params.get("mode")==="hourly" ? "hourly5" : "p2p", days:2,
                  from:"", to:"", km:null, mins:null, vehicle:CONCIERGE, fromIsAirport:false, toIsAirport:false,
                  fromIsT3:false, pickupEmirate:"", earliestMin:null };

  // prefill from homepage
  if(params.get("from")) $("kFrom").value = params.get("from");
  if(params.get("to"))   $("kTo").value   = params.get("to");
  if(params.get("hours")==="10 hours") state.service = "hourly10";
  if((params.get("hours")||"").indexOf("Multi")===0) state.service = "fullday";
  if(state.service==="p2p" && AIRPORT_RX.test((params.get("from")||"") + " " + (params.get("to")||""))) state.service = "airport";
  // Seed the airport flags from any prefilled values so the conditional fields
  // reflect a handed-off airport pickup even before Maps/typing (sign follows T3).
  state.fromIsAirport = AIRPORT_RX.test($("kFrom").value||"");
  state.toIsAirport   = AIRPORT_RX.test($("kTo").value||"");
  state.fromIsT3      = T3_RX.test($("kFrom").value||"");

  // segmented Transfer / By the hour (consistent with homepage)
  const seg = document.querySelectorAll("#bkSeg button");
  function applySeg(){
    const hourly = state.service.startsWith("hourly") || state.service==="fullday";
    seg.forEach(b=>b.classList.toggle("on", (b.dataset.mode==="hourly")===hourly));
    $("rowDur").classList.toggle("hide", !hourly);
    $("rowDays").classList.toggle("hide", state.service!=="fullday");
    if(hourly) $("kDur").value = state.service;
  }
  seg.forEach(b=>b.addEventListener("click", ()=>{
    if(b.dataset.mode==="hourly"){ state.service = $("kDur").value || "hourly5"; }
    else { state.service = state.fromIsAirport ? "airport" : "p2p"; }
    applySeg(); syncConditional();
  }));
  $("kDur").addEventListener("change", e=>{ state.service = e.target.value; applySeg(); syncConditional(); });
  $("kDays").addEventListener("input", e=>{ state.days = Math.max(2, parseInt(e.target.value||"2",10)); summary(); });
  applySeg();

  const SERVICE_LABEL = {p2p:"Transfer", airport:"Airport transfer", hourly5:"By the hour, 5 hours", hourly10:"By the hour, 10 hours", fullday:"By the hour, multiple days"};

  // BOOK-P3 §D: the sixth "Included in every journey" slot SWAPS (never hides) so
  // the grid stays a clean 3x2 in every state. SSR renders the concierge default
  // (booking opens non-airport); this flips to flight tracking when an airport is
  // detected in the pickup OR destination. Icon markup mirrors the SSR span.
  const INC_FLIGHT_HTML = '<svg viewBox="0 0 24 24"><path d="M21.5 4.6c.8-.8.6-2-.5-2.1-.9-.1-1.9.2-2.6.9l-3.5 3.4-9.3-2.4a1 1 0 0 0-1 .3l-.8.9 7.4 4.5-3.3 3.4-2.7-.4-.9.9 3 1.9 1.9 3 .9-.9-.4-2.7 3.4-3.3 4.5 7.4.9-.8a1 1 0 0 0 .3-1l-2.4-9.3z"/></svg>Flight tracking on airport pickups';
  const INC_CONCIERGE_HTML = '<svg viewBox="0 0 24 24"><path d="M4 13v-1a8 8 0 0 1 16 0v1"/><rect x="2.4" y="12.6" width="3.8" height="6.4" rx="1.4"/><rect x="17.8" y="12.6" width="3.8" height="6.4" rx="1.4"/><path d="M20 19v.4a3 3 0 0 1-3 3h-3"/></svg>24/7 concierge support';

  function syncConditional(){
    const isAirport = state.fromIsAirport || state.toIsAirport;
    // Flight number: airport in EITHER direction (unchanged).
    $("rowFlight").classList.toggle("hide", !isAirport);
    var iM=$("incMeetTxt");
    if(iM) iM.textContent = isAirport ? "Met by your chauffeur" : "Professional chauffeur";
    // BOOK-P3 §D: swap the sixth inclusion in place (never hide it).
    var iS=$("incSwap");
    if(iS) iS.innerHTML = isAirport ? INC_FLIGHT_HTML : INC_CONCIERGE_HTML;
    // Welcome sign: only when the PICKUP is an airport (a drop-off never needs a
    // sign) AND the pickup is not DXB Terminal 3 (T3 greetings are board-free).
    const showSign = state.fromIsAirport && !state.fromIsT3;
    $("rowSign").classList.toggle("hide", !showSign);
    const hourly = state.service.startsWith("hourly")||state.service==="fullday";
    $("rowTo").classList.toggle("hide", hourly);
    $("kTo").required = !hourly;
    renderCars();
  }

  function renderCars(){
    const el = $("carList");
    const fleet = getFleet().filter(v=>v.visible!==false);
    // BOOK-P3 §F: the default "Concierge recommends" tile leads the list, so the
    // vehicle field is optional (no layout redesign — the chips idea stays parked).
    const conciergeCard = `<div class="bk-car bk-car-concierge${state.vehicle===CONCIERGE?" sel":""}" data-id="${CONCIERGE}" role="button" tabindex="0" aria-pressed="${state.vehicle===CONCIERGE}">
        <span class="bcimg"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3.5l1.9 3.9 4.3.6-3.1 3 .7 4.3-3.8-2-3.8 2 .7-4.3-3.1-3 4.3-.6z"/></svg></span>
        <div><span class="cat">No preference</span><h3>Concierge recommends</h3></div>
        <div class="vcap2"><span>We match the car to your journey</span></div>
      </div>`;
    el.innerHTML = conciergeCard + fleet.map(v=>{
      return `<div class="bk-car${state.vehicle===v.id?" sel":""}" data-id="${v.id}" role="button" tabindex="0" aria-pressed="${state.vehicle===v.id}">
        <span class="bcimg"><img src="${v.img}" alt="" loading="lazy"></span>
        <div><span class="cat">${v.category}</span><h3>${v.name}</h3></div>
        <div class="vcap2">
          <span><svg viewBox="0 0 24 24"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>${v.seats} guests</span>
          <span><svg viewBox="0 0 24 24"><rect x="5" y="7" width="14" height="13" rx="2"/><path d="M9 7V4h6v3"/></svg>${v.luggage} luggage</span>
        </div>
      </div>`;
    }).join("");
    el.querySelectorAll(".bk-car").forEach(c=>{
      const pick = ()=>{
        state.vehicle = c.dataset.id;
        renderCars();
        summary();
        // rAF: wait for the post-render reflow before measuring; subtract the live sticky-
        // header height (was hard-coded scrollIntoView, which dropped #secDetails behind the header).
        requestAnimationFrame(()=>{
          const el = $("secDetails"); if(!el) return;
          const hdr = document.querySelector("header.site");
          const offset = (hdr ? hdr.offsetHeight : 0) + 24;
          const top = el.getBoundingClientRect().top + window.scrollY - offset;
          window.scrollTo({ top, behavior:"smooth" });
        });
      };
      c.addEventListener("click", pick);
      c.addEventListener("keydown", e=>{ if(e.key==="Enter"||e.key===" "){ e.preventDefault(); pick(); }});
    });
    summary();
  }

  function summary(){
    const v = getFleet().find(x=>x.id===state.vehicle);
    const hourly = state.service.startsWith("hourly")||state.service==="fullday";
    const row = (k,val)=>`<div class="bp-row"><span class="k">${k}</span><span class="v">${val}</span></div>`;
    let h = "";
    h += row("Service", state.service==="fullday" ? `By the hour, ${state.days} days` : SERVICE_LABEL[state.service]);
    if($("kFrom").value) h += row("From", $("kFrom").value);
    if(!hourly && $("kTo").value) h += row("To", $("kTo").value);
    if($("kDate").value) h += row("Date", $("kDate").value + ($("kTime").value? "" : ""));
    if($("kTime").value) h += row("Time", $("kTime").value);
    if(state.km && !hourly) h += row("Route", `${state.km} km, about ${state.mins} min`);
    if(v) h += row("Vehicle", `<b>${v.name}</b>`);
    else if(state.vehicle===CONCIERGE) h += row("Vehicle", `<b>Concierge recommends</b>`);
    $("bkSummary").innerHTML = h || '<div class="bp-empty">Your journey details appear here as you type.</div>';
    const tot = $("bpTotal");
    if(v || state.vehicle===CONCIERGE){
      tot.innerHTML = '<span class="k">Your quote</span><span class="v" style="font-size:.9rem">Confirmed by our team within minutes</span>';
      tot.classList.remove("hide");
    } else { tot.classList.add("hide"); }
    $("btnConfirm").disabled = !state.vehicle;
  }

  ["kFrom","kTo"].forEach(id=>$(id).addEventListener("input", function(){
      state.fromIsAirport = AIRPORT_RX.test($("kFrom").value||"");
      state.toIsAirport = AIRPORT_RX.test($("kTo").value||"");
      state.fromIsT3 = T3_RX.test($("kFrom").value||"");
      const hourly = state.service.startsWith("hourly")||state.service==="fullday";
      if(!hourly) state.service = state.fromIsAirport ? "airport" : "p2p";
      syncConditional();
    summary();
  }));
  ["kDate","kTime"].forEach(id=>$(id).addEventListener("input", summary));

  // live email validation
  const EMAIL_RX = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
  $("kEmail").addEventListener("input", function(){
    const bad = this.value.length > 0 && !EMAIL_RX.test(this.value);
    this.closest(".f").classList.toggle("bad", bad);
  });
  $("kEmail").addEventListener("blur", function(){
    const bad = this.value.length > 0 && !EMAIL_RX.test(this.value);
    this.closest(".f").classList.toggle("bad", bad);
  });

  // phone: our own country-code selector,validation delegated to window.umcPhone
  function fullPhone(){
    const digits = ($("kPhone").value||"").replace(/[^0-9]/g,"").replace(/^0+/,"");
    return "+" + $("kCC").value + " " + digits;
  }
  function phoneValid(){
    return window.umcPhone ? window.umcPhone.valid($("kPhone"), $("kCC")) : true;
  }

  // branded date & time pickers
  let fpD = null, fpT = null;
  if(window.flatpickr){
    fpD = flatpickr($("kDate"), {dateFormat:"D, d M Y", minDate:"today", disableMobile:true,
      onChange:()=>{ applyTimeRestriction(); summary(); }});
    fpT = flatpickr($("kTime"), {enableTime:true, noCalendar:true, dateFormat:"h:i K", minuteIncrement:5, disableMobile:true,
      onChange:()=>{ enforceTimeFloor(); summary(); }});
    if(params.get("date")){ try{ fpD.setDate(params.get("date"), true); }catch(e){} }
    if(params.get("time")){ try{ fpT.setDate(params.get("time"), true, "H:i"); }catch(e){} }
  }

  // ----- Minimum lead-time by pickup emirate -----
  // Detect the pickup's emirate (primary: Places address_components
  // administrative_area_level_1; fallback: emirate-name substring in the
  // formatted address), map it to a minimum-notice buffer, and — only when the
  // chosen date is TODAY in Asia/Dubai — forbid any time slot earlier than
  // (Dubai now + buffer), rounded up to the next 15 minutes. Future dates are
  // already more than the buffer away, so they carry no restriction.
  function pad2(n){ return (n<10?"0":"") + n; }
  function emirateFromPlace(p){
    const comps = (p && p.address_components) || [];
    for(let i=0;i<comps.length;i++){
      const c = comps[i];
      if((c.types||[]).indexOf("administrative_area_level_1") >= 0) return c.long_name || c.short_name || "";
    }
    // Fallback when address_components is absent/unpopulated: substring-match.
    return emirateFromString(((p && p.formatted_address)||"") + " " + ((p && p.name)||""));
  }
  function emirateFromString(s){
    s = (s||"").toLowerCase();
    const names = ["Dubai","Sharjah","Ajman","Abu Dhabi","Fujairah","Ras Al Khaimah","Umm Al Quwain"];
    for(let i=0;i<names.length;i++){ if(s.indexOf(names[i].toLowerCase()) >= 0) return names[i]; }
    return "";
  }
  function emirateInfo(raw){
    const e = (raw||"").toLowerCase();
    if(e.indexOf("dubai") >= 0) return {name:"Dubai", hours:1};
    if(e.indexOf("sharjah") >= 0) return {name:"Sharjah", hours:2};
    if(e.indexOf("ajman") >= 0) return {name:"Ajman", hours:2};                 // ASSUMPTION: matched to Sharjah — confirm
    if(e.indexOf("abu dhabi") >= 0) return {name:"Abu Dhabi", hours:3};
    if(e.indexOf("fujairah") >= 0) return {name:"Fujairah", hours:3};
    if(e.indexOf("ras al khaimah") >= 0 || e.indexOf("ras al-khaimah") >= 0) return {name:"Ras Al Khaimah", hours:3};
    if(e.indexOf("umm al quwain") >= 0 || e.indexOf("umm al-quwain") >= 0 || e.indexOf("umm al qaiwain") >= 0) return {name:"Umm Al Quwain", hours:3};
    return {name:"", hours:0};   // unknown emirate -> no restriction (don't block the flow)
  }
  function dubaiTodayYMD(){
    try { return new Date().toLocaleDateString("en-CA", {timeZone:"Asia/Dubai"}); }   // YYYY-MM-DD
    catch(e){ const d=new Date(); return d.getFullYear()+"-"+pad2(d.getMonth()+1)+"-"+pad2(d.getDate()); }
  }
  function dubaiNowMinutes(){
    let s;
    try { s = new Date().toLocaleString("en-GB", {timeZone:"Asia/Dubai", hour12:false, hour:"2-digit", minute:"2-digit"}); }
    catch(e){ const d=new Date(); s = pad2(d.getHours())+":"+pad2(d.getMinutes()); }
    const m = s.match(/(\d{1,2}):(\d{2})/);
    return m ? (parseInt(m[1],10)*60 + parseInt(m[2],10)) : null;
  }
  function selectedYMD(){
    if(!fpD || !fpD.selectedDates || !fpD.selectedDates.length) return "";
    const d = fpD.selectedDates[0];
    return d.getFullYear() + "-" + pad2(d.getMonth()+1) + "-" + pad2(d.getDate());
  }
  function fmt12(hhmm){
    const p = hhmm.split(":"); let h = parseInt(p[0],10); const mm = p[1];
    const ap = h >= 12 ? "PM" : "AM"; h = h % 12; if(h === 0) h = 12;
    return h + ":" + mm + " " + ap;
  }
  // Clear an already-picked time that's now below the floor (step 5).
  function enforceTimeFloor(){
    if(state.earliestMin == null) return;
    if(fpT && fpT.selectedDates && fpT.selectedDates.length){
      const t = fpT.selectedDates[0];
      if(t.getHours()*60 + t.getMinutes() < state.earliestMin){
        fpT.clear();
        if($("kTime")) $("kTime").value = "";
      }
    }
  }
  function applyTimeRestriction(){
    const note = $("timeNote");
    const info = emirateInfo(state.pickupEmirate);
    const isToday = selectedYMD() && selectedYMD() === dubaiTodayYMD();
    // No restriction: pickup emirate unknown/undetected, no date, or a future date.
    if(!info.hours || !isToday){
      state.earliestMin = null;
      if(fpT) fpT.set("minTime", "00:00");
      if(note){ note.textContent = ""; note.classList.add("hide"); }
      return;
    }
    const nowMin = dubaiNowMinutes();
    if(nowMin == null){ state.earliestMin = null; if(fpT) fpT.set("minTime","00:00"); if(note) note.classList.add("hide"); return; }
    let earliest = Math.ceil((nowMin + info.hours*60) / 15) * 15;   // round up to next 15 min (>= the 5-min picker step)
    state.earliestMin = earliest;
    if(earliest >= 24*60){
      // Buffer pushes the earliest slot past midnight — nothing bookable today.
      if(fpT) fpT.set("minTime", "23:59");
      enforceTimeFloor();
      if(note){ note.textContent = "Pickups from " + info.name + " need at least " + info.hours + " hours' notice — no times remain today, please choose another date."; note.classList.remove("hide"); }
      return;
    }
    const minTimeStr = pad2(Math.floor(earliest/60)) + ":" + pad2(earliest%60);
    if(fpT) fpT.set("minTime", minTimeStr);
    enforceTimeFloor();
    if(note){
      note.textContent = "Pickups from " + info.name + " require at least " + info.hours + " hour" + (info.hours===1?"":"s") + " notice today — earliest " + fmt12(minTimeStr) + ".";
      note.classList.remove("hide");
    }
  }

  // ----- Google Maps (graceful if blocked) -----
  // BOOK-P1.8: the pickup/destination fields use the Places AutocompleteService (the suggestion
  // API) with our OWN dropdown, not the google.maps.places.Autocomplete widget. This lets us brand
  // the list and prefix each suggestion with a type icon. One AutocompleteSessionToken groups the
  // predictions + the getDetails lookup into a single billed session. On select we set the input's
  // .value to the prediction description, so the airport-token + Terminal-3 text detection (which
  // reads the input value) keeps working unchanged, then fetch details for the emirate/geometry.
  let map, dirSvc, dirRen, acSvc, placesSvc, acSession;
  window.umcMapsInit = function(){
    try{
      const BRAND_MAP = [
        {elementType:"geometry",stylers:[{color:"#EFE8D9"}]},
        {elementType:"labels.text.fill",stylers:[{color:"#6B5F4D"}]},
        {elementType:"labels.text.stroke",stylers:[{color:"#F6F1E7"}]},
        {featureType:"road",elementType:"geometry",stylers:[{color:"#FBF8F1"}]},
        {featureType:"road",elementType:"geometry.stroke",stylers:[{color:"#DCD2BC"}]},
        {featureType:"road.highway",elementType:"geometry",stylers:[{color:"#F3EBD9"}]},
        {featureType:"road.highway",elementType:"geometry.stroke",stylers:[{color:"#CdbFA2".toLowerCase()}]},
        {featureType:"water",stylers:[{color:"#D9CFBA"}]},
        {featureType:"poi",stylers:[{visibility:"off"}]},
        {featureType:"transit",stylers:[{visibility:"off"}]},
        {featureType:"landscape.man_made",elementType:"geometry",stylers:[{color:"#EAE2D0"}]}
      ];
      map = new google.maps.Map($("map"), {center:{lat:25.2048,lng:55.2708}, zoom:10, disableDefaultUI:true, zoomControl:true, styles:BRAND_MAP});
      dirSvc = new google.maps.DirectionsService();
      dirRen = new google.maps.DirectionsRenderer({map, suppressMarkers:false, polylineOptions:{strokeColor:"#C75B12",strokeWeight:3}});
      acSvc = new google.maps.places.AutocompleteService();
      placesSvc = new google.maps.places.PlacesService(map);
      acSession = new google.maps.places.AutocompleteSessionToken();
      attachAc($("kFrom"), "from");
      attachAc($("kTo"), "to");
      if($("kFrom").value){
        state.from = $("kFrom").value;
        state.fromIsAirport = AIRPORT_RX.test(state.from);
        state.fromIsT3 = T3_RX.test(state.from);
        if(state.fromIsAirport && state.service==="p2p") state.service = "airport";
        syncConditional();
      }
      if($("kFrom").value && $("kTo").value) route();
    }catch(e){ $("map").innerHTML = '<p style="padding:1rem;font-size:.85rem;color:#7A6F5F">Map preview unavailable, your reservation still works.</p>'; }
  };

  // BOOK-P1.8 / ICONS-2.1: the dropdown, icon set and keyboard/ARIA live in the
  // shared window.umcAutocomplete module (site/assets/autocomplete.js), used by
  // the homepage hero form too. Here we bind it with the booking-specific wiring:
  // one rotating session token and a getDetails lookup whose place feeds
  // onPlaceResolved (emirate + geometry + directions).
  function attachAc(input, which){
    if(!input || !acSvc || !window.umcAutocomplete) return;
    window.umcAutocomplete.attach(input, {
      service: acSvc, placesService: placesSvc, country:"ae", which: which,
      getSession: function(){ return acSession; },
      newSession: function(){ return new google.maps.places.AutocompleteSessionToken(); },
      onSession: function(t){ acSession = t; },
      detailFields: ["formatted_address","name","types","geometry","address_components"],
      onSelect: function(p, place){
        onPlaceResolved(place || { name:p.description, formatted_address:p.description, types:p.types||[] }, which, p);
      }
    });
  }

  // Apply a resolved place (from getDetails) — same effect the widget's place_changed had.
  function onPlaceResolved(p, which, pred){
    const inputVal = ((which==="from") ? $("kFrom") : $("kTo")).value || "";
    const label = (p.name && p.formatted_address && !p.formatted_address.startsWith(p.name)) ? p.name + ", " + p.formatted_address : (p.formatted_address || p.name || inputVal);
    const isAirport = (p.types||[]).includes("airport") || (pred && (pred.types||[]).includes("airport")) || AIRPORT_RX.test(p.name||"") || AIRPORT_RX.test(inputVal);
    if(which==="from"){ state.from = label; state.fromIsAirport = isAirport; state.fromIsT3 = T3_RX.test(inputVal); if(state.service==="p2p" || state.service==="airport"){ state.service = isAirport ? "airport" : "p2p"; } state.pickupEmirate = emirateFromPlace(p); applyTimeRestriction(); }
    else { state.to = label; state.toIsAirport = isAirport; }
    syncConditional(); route();
  }
  function route(){
    if(!dirSvc) return;
    const o = $("kFrom").value, d = $("kTo").value;
    if(!o || !d || $("rowTo").classList.contains("hide")) return;
    dirSvc.route({origin:o, destination:d, travelMode:"DRIVING"}, (res, status)=>{
      if(status!=="OK") return;
      dirRen.setDirections(res);
      const leg = res.routes[0].legs[0];
      state.km = Math.round(leg.distance.value/1000);
      state.mins = Math.round(leg.duration.value/60);
      summary();
    });
  }

  // ----- confirm -> WhatsApp -----
  $("bkForm").addEventListener("submit", e=>{
    e.preventDefault();
    const email = ($("kEmail")||{}).value || "";
    if(!EMAIL_RX.test(email)){
      $("kEmail").setCustomValidity("Please enter a valid email address.");
      $("kEmail").reportValidity(); return;
    }
    $("kEmail").setCustomValidity("");
    if(!phoneValid()){
      const msg = window.umcPhone ? window.umcPhone.errMsg($("kCC")) : "Please enter a valid phone number.";
      const wrap = $("kPhone").closest(".f");
      if(wrap){ wrap.classList.add("bad"); const err = wrap.querySelector(".phone-err"); if(err) err.textContent = msg; }
      $("kPhone").setCustomValidity(msg);
      $("kPhone").reportValidity(); return;
    }
    $("kPhone").setCustomValidity("");
    const v = getFleet().find(x=>x.id===state.vehicle);
    const g = id => ($(id)||{}).value || "";
    const hourly = state.service.startsWith("hourly")||state.service==="fullday";
    // Polished institutional WhatsApp pre-fill (v22). Compose as plain text with newlines;
    // encodeURIComponent below encodes everything once. Skip any line whose value is empty
    // so the message never carries "Service: Event" stubs or "Pickup: -" placeholders.
    const lines = ["Hello UMC Dubai, I'd like to request a reservation.", ""];
    lines.push("Name: " + g("kName"));
    const contactBits = [g("kPhone")];
    if(g("kEmail")) contactBits.push(g("kEmail"));
    lines.push("Contact: " + contactBits.join(" · "));
    lines.push("Service: " + SERVICE_LABEL[state.service]);
    if(v) lines.push("Vehicle: " + v.name);
    else if(state.vehicle===CONCIERGE) lines.push("Vehicle: Concierge to recommend");
    if(g("kFrom")) lines.push("Pickup: " + g("kFrom"));
    if(!hourly && g("kTo")) lines.push("Destination: " + g("kTo"));
    const dt = [g("kDate"), g("kTime")].filter(Boolean).join(" at ");
    if(dt) lines.push("Date: " + dt);
    if(state.service === "fullday") lines.push("Days: " + state.days);
    if(!$("rowFlight").classList.contains("hide") && g("kFlight")) lines.push("Flight: " + g("kFlight"));
    if(!$("rowSign").classList.contains("hide") && g("kSign")) lines.push("Welcome sign: " + g("kSign"));
    if(g("kNotes")) lines.push("Notes: " + g("kNotes"));
    lines.push("", "Please confirm availability. Thank you.");
    const m = lines.join("\n");

    // ----- non-blocking capture before WhatsApp -----
    const phoneOut = window.umcPhone ? window.umcPhone.significantDigits(g("kPhone")) : g("kPhone");
    const bkTok = (document.querySelector('#bkTs [name="cf-turnstile-response"]') || {}).value || "";
    const payload = {
      source: "booking",
      turnstileToken: bkTok,
      name: g("kName"), phone: "+" + $("kCC").value + " " + phoneOut, email: g("kEmail"),
      service: SERVICE_LABEL[state.service], pickup: g("kFrom"), destination: hourly ? "" : g("kTo"),
      date: g("kDate"), time: g("kTime"),
      vehicle: (v ? v.name : (state.vehicle===CONCIERGE ? "Concierge recommends" : "")),
      days: state.service === "fullday" ? String(state.days) : "",
      flight: g("kFlight"), sign: g("kSign"), notes: g("kNotes"),
      page: location.pathname, ts: new Date().toISOString()
    };
    // WA-3 J: no on-submission auto-open to WhatsApp. The concierge reaches out; the
    // floating WhatsApp button remains for anyone who wants to message directly.
    const form = $("bkForm"), done = $("bkDone");
    const hasEmail = !!(g("kEmail") && g("kEmail").trim());
    (async () => {
      let ok = false;
      try {
        const r = await fetch("/api/lead", { method:"POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify(payload) });
        ok = r.ok;
      } catch(_) { ok = false; }
      if (ok) trackLead('booking', state.service);
      if (form) form.classList.add("hide");
      if (done) {
        // Conditional confirmation: only claim the email summary when an email was given
        // AND capture succeeded; if capture failed, stay honest (no receipt claim).
        const lede = done.querySelector(".lede");
        if (lede) {
          // WA-4 §ADD1 — unified confirmation copy, no auto-open wording. The email
          // clause is only claimed when an email was actually provided (stay honest).
          lede.textContent = (ok && hasEmail)
            ? "Thank you — your request has been received. A summary has been sent to your email, and our concierge team will contact you shortly on WhatsApp or phone."
            : "Thank you — your request has been received. Our concierge team will contact you shortly on WhatsApp or phone.";
        }
        done.classList.remove("hide");
        done.scrollIntoView({ behavior:"smooth", block:"start" });
      }
    })();
  });

  // terms dialog
  const dlg = document.getElementById("termsDlg");
  const openers = document.querySelectorAll("#openTerms, .js-openterms");
  if(dlg && openers.length){
    openers.forEach(o=>o.addEventListener("click", e=>{ e.preventDefault(); dlg.showModal(); }));
    dlg.querySelector(".x").addEventListener("click", ()=>dlg.close());
  }

  // vehicle preselect via ?vehicle=
  if(params.get("vehicle")) state.vehicle = params.get("vehicle");
  syncConditional();
})();
