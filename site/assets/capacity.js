/* © UMC Dubai LLC. All rights reserved. Unauthorised reproduction of this code or design is prohibited and monitored. */
/* CAP-4 / CAP-5-SIMPLE / CAP-6 — capacity module (photographic seating; no tabs, no boot SVG).
   SEATING ships the default scenario <picture> in SSR. ONE STATIC CAMERA — no zoom.
   Two transition modes (CAP-6): a WITHIN-config scenario switch (captain 5<->6, bench 6<->7)
   shares one base render, so it CROSS-FADES seamlessly; a CONFIG toggle (captain<->bench) is
   two different renders, so it FADES THROUGH GROUND (old out to the bone panel, then new in —
   never both visible) to avoid morphing mismatched bodies. Both instant under reduced-motion.
   Non-default images are prefetched after init. BOOT SPACE is a text section whose combo rows
   are accordion disclosures (one dimension line per size); JS only flips aria-expanded. */
(function(){
  "use strict";
  var RM = matchMedia("(prefers-reduced-motion:reduce)").matches;

  function esc(s){ return String(s==null?"":s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;"); }
  function pictureHTML(sc, sizes, widths){
    var srcset = widths.map(function(w){ return sc.base+"-"+w+".webp "+w+"w"; }).join(",");
    return '<picture><source type="image/webp" srcset="'+srcset+'" sizes="'+esc(sizes)+'">'
      + '<img class="cap-photo" src="'+sc.base+'.png" width="'+sc.w+'" height="'+sc.h+'" alt="'+esc(sc.alt)+'" decoding="async"></picture>';
  }

  function initCard(card){
    var dataEl = card.querySelector(".cap-data"); if(!dataEl) return;
    var data; try { data = JSON.parse(dataEl.textContent); } catch(e){ return; }
    var configs = data.configs || [];
    if(!configs.length) return;
    function cfgById(id){ for(var i=0;i<configs.length;i++) if(configs[i].id===id) return configs[i]; return configs[0]; }
    function scenById(cfg,id){ for(var i=0;i<cfg.scenarios.length;i++) if(cfg.scenarios[i].id===id) return cfg.scenarios[i]; return cfg.scenarios[0]; }
    var seatingMedia = card.querySelector(".cap-media__seating");
    var rowsWrap = card.querySelector(".cap-rows");
    var curConfig = data.defaultConfig;

    var CHEV = '<svg class="cap-scen__chev" viewBox="0 0 24 24" aria-hidden="true"><path d="M9 6l6 6-6 6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
    function rowHTML(cid, s, on){
      return '<button type="button" class="cap-scen'+(on?" on":"")+'" role="radio" aria-checked="'+(on?"true":"false")+'" data-config="'+cid+'" data-scen="'+s.id+'">'
        + '<span class="cap-scen__txt"><span class="cap-scen__t">'+esc(s.title)+'</span><span class="cap-scen__d">'+esc(s.desc)+'</span></span>'+CHEV+'</button>';
    }
    function newPicture(sc){
      var tmp = document.createElement("div"); tmp.innerHTML = pictureHTML(sc, data.sizes, data.widths);
      return tmp.firstChild;
    }
    function swapInstant(np){
      while(seatingMedia.firstChild) seatingMedia.removeChild(seatingMedia.firstChild);
      seatingMedia.appendChild(np);
    }
    // WITHIN-config scenario switch (captain 5<->6, bench 6<->7): same base render, so a
    // direct cross-fade is seamless — old and new briefly overlap while the new fades in.
    function crossfade(sc){
      if(!seatingMedia) return;
      var old = seatingMedia.querySelector("picture");
      var np = newPicture(sc);
      if(RM || !old){ swapInstant(np); return; }
      np.className = "cap-photo-layer";
      seatingMedia.appendChild(np);
      void np.offsetWidth;                     // reflow so the transition runs
      np.classList.add("is-in");
      var done = function(){
        if(old && old.parentNode) old.parentNode.removeChild(old);
        np.className = ""; np.removeEventListener("transitionend", done);
      };
      np.addEventListener("transitionend", done);
      setTimeout(done, 450);                   // fallback if transitionend never fires
    }
    // CONFIG toggle (captain<->bench): the two configs are DIFFERENT renders, so a cross-fade
    // would morph two mismatched bodies (visible wobble). Instead fade the old body out to the
    // bone panel, THEN fade the new one in — the two are never on screen together. The outgoing
    // picture stays in flow (at opacity 0) until the incoming one is in flow, so height holds.
    function fadeThroughGround(sc){
      if(!seatingMedia) return;
      var old = seatingMedia.querySelector("picture");
      if(RM || !old){ swapInstant(newPicture(sc)); return; }
      old.classList.add("cap-photo-out");      // phase 1: fade out to the ground
      void old.offsetWidth;
      var swapped = false;
      var phase2 = function(){
        if(swapped) return; swapped = true;
        old.removeEventListener("transitionend", phase2);
        var np = newPicture(sc);
        np.className = "cap-photo-layer cap-photo-layer--ground";  // absolute, opacity 0
        seatingMedia.appendChild(np);          // old (opacity 0) still holds the height
        void np.offsetWidth;
        np.classList.add("is-in");             // phase 2: fade in over the ground
        var fin = function(){
          if(fin.done) return; fin.done = true;
          if(old && old.parentNode) old.parentNode.removeChild(old);
          np.className = ""; np.removeEventListener("transitionend", fin);
        };
        np.addEventListener("transitionend", fin);
        setTimeout(fin, 260);
      };
      old.addEventListener("transitionend", phase2);
      setTimeout(phase2, 150);                 // fallback ≈ fade-out duration
    }
    function markRows(cid, sid){
      card.querySelectorAll(".cap-rows .cap-scen").forEach(function(el){
        var on = el.getAttribute("data-config")===cid && el.getAttribute("data-scen")===sid;
        el.classList.toggle("on", on); el.setAttribute("aria-checked", on?"true":"false");
      });
    }
    function selectScen(cid, sid, transition){
      var sc = scenById(cfgById(cid), sid);
      curConfig = cid;
      if(transition==="ground") fadeThroughGround(sc);
      else if(transition==="cross") crossfade(sc);
      markRows(cid, sid);
    }
    function switchConfig(cid){
      if(cid===curConfig || !rowsWrap) return;
      var cfg = cfgById(cid);
      card.querySelectorAll(".cap-seg__btn").forEach(function(b){
        var on = b.getAttribute("data-config")===cid;
        b.classList.toggle("on", on); b.setAttribute("aria-checked", on?"true":"false");
      });
      rowsWrap.innerHTML = cfg.scenarios.map(function(s){ return rowHTML(cid, s, s.id===cfg.default); }).join("");
      selectScen(cid, cfg.default, "ground");   // config change => fade through ground
    }

    // Boot Space accordion: each combo row is a disclosure; opening one closes the others
    // (one thing at a time). CSS drives the reveal off aria-expanded — JS only flips state.
    var bootRows = card.querySelectorAll(".cap-boot__row");
    function toggleBoot(btn){
      var open = btn.getAttribute("aria-expanded")==="true";
      for(var i=0;i<bootRows.length;i++){ if(bootRows[i]!==btn) bootRows[i].setAttribute("aria-expanded","false"); }
      btn.setAttribute("aria-expanded", open ? "false" : "true");
    }

    card.addEventListener("click", function(e){
      var seg = e.target.closest(".cap-seg__btn"); if(seg){ switchConfig(seg.getAttribute("data-config")); return; }
      var row = e.target.closest(".cap-scen");      if(row){ selectScen(row.getAttribute("data-config"), row.getAttribute("data-scen"), "cross"); return; }
      var boot = e.target.closest(".cap-boot__row"); if(boot && card.contains(boot)){ toggleBoot(boot); return; }
    });

    // prefetch non-default seating images (1024w webp) once idle
    var pf = []; var dcfg = cfgById(data.defaultConfig);
    configs.forEach(function(c){ c.scenarios.forEach(function(s){
      if(!(c.id===data.defaultConfig && s.id===dcfg.default)) pf.push(s.base+"-1024.webp");
    }); });
    function prefetch(){ pf.forEach(function(u){ var im=new Image(); im.src=u; }); }
    if("requestIdleCallback" in window) requestIdleCallback(prefetch); else setTimeout(prefetch, 700);
  }

  function start(){ document.querySelectorAll("[data-cap]").forEach(initCard); }
  if(document.readyState === "loading") document.addEventListener("DOMContentLoaded", start);
  else start();
})();
