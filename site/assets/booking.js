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

  const state = { service: params.get("mode")==="hourly" ? "hourly5" : "p2p", days:2,
                  from:"", to:"", km:null, mins:null, vehicle:null, fromIsAirport:false, toIsAirport:false,
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

  function syncConditional(){
    const isAirport = state.fromIsAirport || state.toIsAirport;
    // Flight number: airport in EITHER direction (unchanged).
    $("rowFlight").classList.toggle("hide", !isAirport);
    var iF=$("incFlight"), iW=$("incWait"), iM=$("incMeetTxt");
    if(iF) iF.classList.toggle("hide", !isAirport);
    if(iW) iW.classList.toggle("hide", !isAirport);
    if(iM) iM.textContent = isAirport ? "Met by your chauffeur" : "Professional chauffeur";
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
    el.innerHTML = fleet.map(v=>{
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
    $("bkSummary").innerHTML = h || '<div class="bp-empty">Your journey details appear here as you type.</div>';
    const tot = $("bpTotal");
    if(v){
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
  function acEsc(s){ return String(s==null?"":s).replace(/[&<>"]/g,function(c){return {"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c];}); }
  const AC_ICONS = {
    airport: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M17.8 19.2 16 11l3.5-3.5c1-1 1-2.5 0-3s-2.5-1-3 0L13 8 4.8 6.2c-.4-.1-.7.4-.4.7l3.9 4.2-2.2 2.2-1.9-.3-.9.9 2.4 1.5L8 18.4l.9-.9-.3-1.9 2.2-2.2 4.2 3.9c.3.3.8 0 .7-.4z"/></svg>',
    lodging: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 20v-8a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v8M3 14h18M4 20v-2M20 20v-2M7 10V8.4A1.4 1.4 0 0 1 8.4 7h3.2A1.4 1.4 0 0 1 13 8.4V10"/></svg>',
    establishment: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 21V4.5A1.5 1.5 0 0 1 7.5 3h6A1.5 1.5 0 0 1 15 4.5V21M15 10h2.5A1.5 1.5 0 0 1 19 11.5V21M4 21h16M9 7h3M9 11h3M9 15h3"/></svg>',
    pin: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 21s-6-5.7-6-10a6 6 0 1 1 12 0c0 4.3-6 10-6 10z"/><circle cx="12" cy="11" r="2.3"/></svg>'
  };
  function acIconFor(types){
    types = types || [];
    if(types.indexOf("airport") >= 0) return AC_ICONS.airport;
    if(types.indexOf("lodging") >= 0) return AC_ICONS.lodging;
    if(types.indexOf("establishment") >= 0) return AC_ICONS.establishment;
    return AC_ICONS.pin;
  }
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
      attachAutocomplete($("kFrom"), "from");
      attachAutocomplete($("kTo"), "to");
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

  function attachAutocomplete(input, which){
    if(!input || !acSvc) return;
    const wrap = input.closest(".f") || input.parentNode;
    wrap.classList.add("ac-wrap");
    const drop = document.createElement("div");
    drop.className = "ac-drop"; drop.setAttribute("role","listbox"); drop.id = "acdrop-"+which; drop.hidden = true;
    wrap.appendChild(drop);
    input.setAttribute("role","combobox");
    input.setAttribute("aria-autocomplete","list");
    input.setAttribute("aria-expanded","false");
    input.setAttribute("aria-controls", drop.id);
    let preds = [], active = -1, tmr = null;

    function close(){ drop.hidden = true; drop.innerHTML = ""; preds = []; active = -1; input.setAttribute("aria-expanded","false"); input.removeAttribute("aria-activedescendant"); }
    function setActive(i){
      const items = drop.querySelectorAll(".ac-item");
      active = i;
      items.forEach(function(el, idx){ el.classList.toggle("on", idx===i); el.setAttribute("aria-selected", idx===i?"true":"false"); });
      if(i>=0 && items[i]){ input.setAttribute("aria-activedescendant", items[i].id); items[i].scrollIntoView({block:"nearest"}); }
      else input.removeAttribute("aria-activedescendant");
    }
    function render(){
      if(!preds.length){ close(); return; }
      drop.innerHTML = preds.map(function(p, i){
        const m = p.structured_formatting || {};
        const main = acEsc(m.main_text || p.description);
        const sec = m.secondary_text ? '<span class="ac-sec">'+acEsc(m.secondary_text)+'</span>' : '';
        return '<div class="ac-item" role="option" aria-selected="false" id="acopt-'+which+'-'+i+'" data-i="'+i+'">'
          + '<span class="ac-ic">'+acIconFor(p.types)+'</span>'
          + '<span class="ac-tx"><span class="ac-main">'+main+'</span>'+sec+'</span></div>';
      }).join("");
      drop.hidden = false;
      input.setAttribute("aria-expanded","true");
      setActive(-1);
    }
    function query(){
      const val = (input.value||"").trim();
      if(val.length < 2){ close(); return; }
      acSvc.getPlacePredictions(
        { input: val, componentRestrictions:{country:"ae"}, sessionToken: acSession },
        function(res, status){
          if(status !== google.maps.places.PlacesServiceStatus.OK || !res || !res.length){ close(); return; }
          preds = res.slice(0, 6); render();
        });
    }
    function choose(i){
      const p = preds[i]; if(!p) return;
      input.value = p.description;            // full text -> airport/T3 detection + directions read this
      close();
      placesSvc.getDetails(
        { placeId: p.place_id, fields:["formatted_address","name","types","geometry","address_components"], sessionToken: acSession },
        function(place, status){
          acSession = new google.maps.places.AutocompleteSessionToken();   // end the billed session
          const ok = status === google.maps.places.PlacesServiceStatus.OK && place;
          onPlaceResolved(ok ? place : { name:p.description, formatted_address:p.description, types:p.types||[] }, which, p);
        });
    }
    input.addEventListener("input", function(){ if(tmr) clearTimeout(tmr); tmr = setTimeout(query, 160); });
    input.addEventListener("keydown", function(e){
      if(drop.hidden){ if(e.key==="ArrowDown") query(); return; }
      if(e.key==="ArrowDown"){ e.preventDefault(); setActive(Math.min(active+1, preds.length-1)); }
      else if(e.key==="ArrowUp"){ e.preventDefault(); setActive(active<=0 ? preds.length-1 : active-1); }
      else if(e.key==="Enter" && active>=0){ e.preventDefault(); choose(active); }
      else if(e.key==="Escape"){ close(); }
    });
    drop.addEventListener("mousedown", function(e){ const it = e.target.closest(".ac-item"); if(it){ e.preventDefault(); choose(parseInt(it.getAttribute("data-i"),10)); } });
    input.addEventListener("blur", function(){ setTimeout(close, 150); });   // let a click register first
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
      vehicle: (v ? v.name : ""),
      days: state.service === "fullday" ? String(state.days) : "",
      flight: g("kFlight"), sign: g("kSign"), notes: g("kNotes"),
      page: location.pathname, ts: new Date().toISOString()
    };
    const waUrl = "https://api.whatsapp.com/send?phone=" + PHONE + "&text=" + encodeURIComponent(m);
    const form = $("bkForm"), done = $("bkDone");
    (async () => {
      let ok = false;
      try {
        const r = await fetch("/api/lead", { method:"POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify(payload) });
        ok = r.ok;
      } catch(_) { ok = false; }
      if (ok) trackLead('booking', state.service);
      if (form) form.classList.add("hide");
      if (done) {
        if (!ok) {
          // Backend did not confirm — be honest, do not claim receipt.
          const lede = done.querySelector(".lede");
          if (lede) lede.textContent = "Please tap Send in WhatsApp to reach our concierge directly — we'll confirm your reservation from there.";
        }
        done.classList.remove("hide");
        done.scrollIntoView({ behavior:"smooth", block:"start" });
      }
      setTimeout(() => { window.open(waUrl, "_blank", "noopener"); }, 600);
    })();
  });

  // terms dialog
  const dlg = document.getElementById("termsDlg");
  const opener = document.getElementById("openTerms");
  if(dlg && opener){
    opener.addEventListener("click", e=>{ e.preventDefault(); dlg.showModal(); });
    dlg.querySelector(".x").addEventListener("click", ()=>dlg.close());
  }

  // vehicle preselect via ?vehicle=
  if(params.get("vehicle")) state.vehicle = params.get("vehicle");
  syncConditional();
})();
