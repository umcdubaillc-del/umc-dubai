/* UMC Dubai — reservation flow */
(function(){
  const $ = id => document.getElementById(id);
  const params = new URLSearchParams(location.search);
  const PHONE = "971586497861";
  const AIRPORT_RX = new RegExp("\\b(airport|dxb|dwc|auh|shj|rkt|al maktoum|maktoum international|zayed international|abu dhabi international|sharjah international|ras al khaimah international|al ain international)\\b","i");

  const state = { service: params.get("mode")==="hourly" ? "hourly5" : "p2p", days:2,
                  from:"", to:"", km:null, mins:null, vehicle:null, fromIsAirport:false, toIsAirport:false };

  // prefill from homepage
  if(params.get("from")) $("kFrom").value = params.get("from");
  if(params.get("to"))   $("kTo").value   = params.get("to");
  if(params.get("hours")==="10 hours") state.service = "hourly10";
  if((params.get("hours")||"").indexOf("Multi")===0) state.service = "fullday";
  if(state.service==="p2p" && AIRPORT_RX.test((params.get("from")||"") + " " + (params.get("to")||""))) state.service = "airport";

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
  function rateFor(v){
    if(!v) return null;
    if(state.service==="hourly5") return v.r5;
    if(state.service==="hourly10"||state.service==="fullday") return v.r10;
    return v.ra; /* airport & point-to-point: flat one-way */
  }
  function rateUnit(){
    if(state.service==="fullday") return "Per day";
    if(state.service==="hourly5") return "5 hours";
    if(state.service==="hourly10") return "10 hours";
    return "One-way";
  }

  function syncConditional(){
    const isAirport = state.fromIsAirport || state.toIsAirport;
    $("rowFlight").classList.toggle("hide", !isAirport);
    var iF=$("incFlight"), iW=$("incWait"), iM=$("incMeetTxt");
    if(iF) iF.classList.toggle("hide", !isAirport);
    if(iW) iW.classList.toggle("hide", !isAirport);
    if(iM) iM.textContent = isAirport ? "Met by your chauffeur" : "Professional chauffeur";
    $("rowSign").classList.toggle("hide", !isAirport);
    const hourly = state.service.startsWith("hourly")||state.service==="fullday";
    $("rowTo").classList.toggle("hide", hourly);
    $("kTo").required = !hourly;
    renderCars();
  }

  function renderCars(){
    const el = $("carList");
    const fleet = getFleet().filter(v=>v.visible!==false);
    el.innerHTML = fleet.map(v=>{
      const r = rateFor(v);
      const price = r ? "AED " + Number(r).toLocaleString() : "On request";
      return `<div class="bk-car${state.vehicle===v.id?" sel":""}" data-id="${v.id}" role="button" tabindex="0" aria-pressed="${state.vehicle===v.id}">
        <img src="${v.img}" alt="" loading="lazy">
        <div><span class="cat">${v.category}</span><h3>${v.name}</h3>
          <div class="cap"><span><svg viewBox="0 0 24 24"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>${v.seats} guests</span><span><svg viewBox="0 0 24 24"><rect x="5" y="7" width="14" height="13" rx="2"/><path d="M9 7V4h6v3"/></svg>${v.luggage} cases</span></div></div>
        <div class="p"><b>${price}</b><span>${r?rateUnit():"24/7 desk"}</span></div>
      </div>`;
    }).join("");
    el.querySelectorAll(".bk-car").forEach(c=>{
      const pick = ()=>{ state.vehicle = c.dataset.id; renderCars(); summary(); $("secDetails").scrollIntoView({behavior:"smooth",block:"start"}); };
      c.addEventListener("click", pick);
      c.addEventListener("keydown", e=>{ if(e.key==="Enter"||e.key===" "){ e.preventDefault(); pick(); }});
    });
    summary();
  }

  function summary(){
    const v = getFleet().find(x=>x.id===state.vehicle);
    const r = rateFor(v);
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
    if(v && r){
      const total = state.service==="fullday" ? r*state.days : r;
      const note = state.service==="fullday" ? ` <span style="font-size:.65rem;color:var(--muted)">(AED ${Number(r).toLocaleString()} a day)</span>` : "";
      tot.innerHTML = `<span class="k">${state.service==="fullday"?"Estimated total":"Your rate"}</span><span class="v">AED ${Number(total).toLocaleString()}${note}</span>`;
      tot.classList.remove("hide");
    } else if(v){
      tot.innerHTML = '<span class="k">Your rate</span><span class="v" style="font-size:.9rem">Quoted on request</span>';
      tot.classList.remove("hide");
    } else { tot.classList.add("hide"); }
    $("btnConfirm").disabled = !state.vehicle;
  }

  ["kFrom","kTo"].forEach(id=>$(id).addEventListener("input", function(){
      state.fromIsAirport = AIRPORT_RX.test($("kFrom").value||"");
      state.toIsAirport = AIRPORT_RX.test($("kTo").value||"");
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

  // phone: our own country-code selector
  function fullPhone(){
    const digits = ($("kPhone").value||"").replace(/[^0-9]/g,"").replace(/^0+/,"");
    return "+" + $("kCC").value + " " + digits;
  }
  function phoneValid(){
    const digits = ($("kPhone").value||"").replace(/[^0-9]/g,"").replace(/^0+/,"");
    return digits.length >= 6 && digits.length <= 12;
  }

  // branded date & time pickers
  let fpD = null, fpT = null;
  if(window.flatpickr){
    fpD = flatpickr($("kDate"), {dateFormat:"D, d M Y", minDate:"today", disableMobile:true,
      onChange:()=>summary()});
    fpT = flatpickr($("kTime"), {enableTime:true, noCalendar:true, dateFormat:"h:i K", minuteIncrement:5, disableMobile:true,
      onChange:()=>summary()});
    if(params.get("date")){ try{ fpD.setDate(params.get("date"), true); }catch(e){} }
    if(params.get("time")){ try{ fpT.setDate(params.get("time"), true, "H:i"); }catch(e){} }
  }

  // ----- Google Maps (graceful if blocked) -----
  let map, dirSvc, dirRen, acFrom, acTo;
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
      const opts = {componentRestrictions:{country:"ae"}, fields:["formatted_address","name","types","geometry"]};
      acFrom = new google.maps.places.Autocomplete($("kFrom"), opts);
      acTo   = new google.maps.places.Autocomplete($("kTo"), opts);
      acFrom.addListener("place_changed", ()=>onPlace(acFrom, "from"));
      acTo.addListener("place_changed",   ()=>onPlace(acTo, "to"));
      if($("kFrom").value){
        state.from = $("kFrom").value;
        state.fromIsAirport = AIRPORT_RX.test(state.from);
        if(state.fromIsAirport && state.service==="p2p") state.service = "airport";
        syncConditional();
      }
      if($("kFrom").value && $("kTo").value) route();
    }catch(e){ $("map").innerHTML = '<p style="padding:1rem;font-size:.85rem;color:#7A6F5F">Map preview unavailable — your reservation still works.</p>'; }
  };
  function onPlace(ac, which){
    const p = ac.getPlace(); if(!p || !p.geometry) return;
    const label = (p.name && p.formatted_address && !p.formatted_address.startsWith(p.name)) ? p.name + ", " + p.formatted_address : (p.formatted_address || p.name);
    const isAirport = (p.types||[]).includes("airport") || AIRPORT_RX.test(p.name||"");
    if(which==="from"){ state.from = label; state.fromIsAirport = isAirport; if(state.service==="p2p" || state.service==="airport"){ state.service = isAirport ? "airport" : "p2p"; } }
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
      $("kPhone").setCustomValidity("Please enter a valid phone number.");
      $("kPhone").reportValidity(); return;
    }
    $("kPhone").setCustomValidity("");
    const v = getFleet().find(x=>x.id===state.vehicle);
    const g = id => ($(id)||{}).value || "";
    const hourly = state.service.startsWith("hourly")||state.service==="fullday";
    let m = "RESERVATION REQUEST — UMC Dubai\n";
    m += "\nService: " + SERVICE_LABEL[state.service];
    m += "\nPick-up: " + g("kFrom");
    if(!hourly) m += "\nDestination: " + g("kTo");
    m += "\nDate: " + g("kDate") + "   Time: " + g("kTime");
    if(state.km) m += "\nRoute: ~" + state.km + " km / " + state.mins + " min";
    if(!$("rowFlight").classList.contains("hide") && g("kFlight")) m += "\nFlight: " + g("kFlight");
    if(!$("rowSign").classList.contains("hide") && g("kSign")) m += "\nWelcome sign: " + g("kSign");
    if(state.service==="fullday") m += "\nDays: " + state.days;
    m += "\nVehicle: " + (v? v.name : "-");
    const r = rateFor(v);
    if(r && state.service==="fullday") m += "\nQuoted rate: AED " + Number(r).toLocaleString() + " per day, AED " + Number(r*state.days).toLocaleString() + " total";
    else if(r) m += "\nQuoted rate: AED " + Number(r).toLocaleString();
    m += "\n\nGuest: " + g("kName");
    m += "\nPhone: " + g("kPhone");
    if(g("kEmail")) m += "\nEmail: " + g("kEmail");
    if(g("kNotes")) m += "\nNotes: " + g("kNotes");
    window.open("https://api.whatsapp.com/send?phone=" + PHONE + "&text=" + encodeURIComponent(m), "_blank", "noopener");
    $("bkDone").classList.remove("hide");
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
