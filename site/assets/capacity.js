/* © UMC Dubai LLC. All rights reserved. Unauthorised reproduction of this code or design is prohibited and monitored. */
/* CAP-4 / CAP-5-SIMPLE / CAP-6 — capacity module (photographic seating; no tabs, no boot SVG).
   SEATING ships the default scenario <picture> in SSR. ONE STATIC CAMERA — no zoom.
   Two transition modes (CAP-6): a WITHIN-config scenario switch (captain 5<->6, bench 6<->7)
   shares one base render, so it CROSS-FADES seamlessly; a CONFIG toggle (captain<->bench) is
   two different renders, so it FADES THROUGH GROUND (old out to the bone panel, then new in —
   never both visible) to avoid morphing mismatched bodies. Both instant under reduced-motion.
   CAP-7.2: every scenario image is preloaded up front (warm()) and a swap begins only after the
   incoming image has loaded, so the first switch is flicker-free on a cold cache (decode() is
   fired best-effort but never gates — it can hang in some engines). BOOT SPACE is a text section
   whose combo rows are accordion disclosures (one dimension line per size); JS flips aria only. */
(function(){
  "use strict";
  var RM = matchMedia("(prefers-reduced-motion:reduce)").matches;

  function esc(s){ return String(s==null?"":s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;"); }
  function pictureHTML(sc, sizes, widths, ver){
    var q = ver ? "?v="+ver : "";   // cache-bust: mirror the SSR ?v= so swapped seatmaps refetch
    var srcset = widths.map(function(w){ return sc.base+"-"+w+".webp"+q+" "+w+"w"; }).join(",");
    return '<picture><source type="image/webp" srcset="'+srcset+'" sizes="'+esc(sizes)+'">'
      + '<img class="cap-photo" src="'+sc.base+'.png'+q+'" width="'+sc.w+'" height="'+sc.h+'" alt="'+esc(sc.alt)+'" decoding="async"></picture>';
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
      var tmp = document.createElement("div"); tmp.innerHTML = pictureHTML(sc, data.sizes, data.widths, data.v);
      return tmp.firstChild;
    }
    function swapInstant(np){
      while(seatingMedia.firstChild) seatingMedia.removeChild(seatingMedia.firstChild);
      seatingMedia.appendChild(np);
    }
    // The current on-screen picture. If a prior transition was interrupted (rapid toggling) and
    // left in-flight layers, collapse to the most recent one so every swap starts from a single
    // clean picture — no orphan accumulation.
    function currentPicture(){
      var ps = seatingMedia.querySelectorAll("picture");
      for(var i=0;i<ps.length-1;i++){ if(ps[i].parentNode) ps[i].parentNode.removeChild(ps[i]); }
      return ps.length ? ps[ps.length-1] : null;
    }
    // CAP-7.2 preload: warm (load) every scenario up front and gate each swap (in selectScen) on
    // that load, so a swap begins only once the incoming frame is in cache — flicker-free even on
    // a cold cache. preloadWidth() replicates the browser's srcset pick for our `sizes`, so we
    // warm the SAME variant the <picture> will display → the insert is a cache hit → no flash.
    // (We warm a PLAIN Image, not a srcset one: an off-DOM srcset image can't resolve `sizes`.)
    var decoded = {};      // base -> Promise (resolves when the picked variant is decoded)
    var selectToken = 0;   // guards rapid clicks — only the latest applies
    function preloadWidth(){
      var slotCss = (window.innerWidth <= 720) ? window.innerWidth * 0.92 : 800;   // mirrors data.sizes
      var need = slotCss * (window.devicePixelRatio || 1);
      for(var i=0;i<data.widths.length;i++){ if(data.widths[i] >= need) return data.widths[i]; }
      return data.widths[data.widths.length-1];
    }
    // Gate on the load event (universally reliable) and fire decode() best-effort (non-blocking):
    // decode() resolves off the paint path in real browsers but can hang in some engines, so it
    // must never gate the swap. Once loaded, the exact variant is in cache → the <picture> insert
    // paints without a flash.
    function warm(sc){
      if(decoded[sc.base]) return decoded[sc.base];
      var im = new Image();
      decoded[sc.base] = new Promise(function(res){
        var done = function(){ if(im.decode){ try { im.decode().then(function(){}, function(){}); } catch(e){} } res(im); };
        im.onload = done; im.onerror = function(){ res(im); };
        im.src = sc.base+"-"+preloadWidth()+".webp"+(data.v?"?v="+data.v:"");
        if(im.complete) done();
      });
      return decoded[sc.base];
    }
    // WITHIN-config scenario switch (captain 5<->6, bench 6<->7): same base render, so a
    // direct cross-fade is seamless — old and new briefly overlap while the new fades in.
    function crossfade(sc){
      if(!seatingMedia) return;
      var old = currentPicture();
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
    // bone panel, THEN fade the new one in — the two are never on screen together. The box has a
    // fixed aspect-ratio (CAP-7.3) so height holds regardless of which render is current.
    function fadeThroughGround(sc){
      if(!seatingMedia) return;
      var old = currentPicture();
      if(RM || !old){ swapInstant(newPicture(sc)); return; }
      var np = newPicture(sc);
      np.className = "cap-photo-layer cap-photo-layer--ground";  // absolute, opacity 0
      seatingMedia.appendChild(np);            // appended now (invisible) so it is ready to reveal
      old.classList.add("cap-photo-out");      // phase 1: fade the old body out to the ground
      void old.offsetWidth;
      var phase2 = function(){
        if(phase2.done) return; phase2.done = true;
        old.removeEventListener("transitionend", phase2);
        void np.offsetWidth;
        np.classList.add("is-in");             // phase 2: fade the new body in over the ground
        var fin = function(){
          if(fin.done) return; fin.done = true;
          if(old && old.parentNode) old.parentNode.removeChild(old);
          np.className = ""; np.removeEventListener("transitionend", fin);
        };
        np.addEventListener("transitionend", fin);
        setTimeout(fin, 260);
      };
      old.addEventListener("transitionend", phase2);
      setTimeout(phase2, 170);                 // fallback ≈ fade-out duration
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
      markRows(cid, sid);                  // reflect the selection immediately (snappy)
      if(!transition) return;
      var token = ++selectToken;
      warm(sc).then(function(){            // swap only once the incoming variant is loaded+decoded
        if(token !== selectToken) return; // a newer selection superseded this one
        if(transition==="ground") fadeThroughGround(sc);
        else crossfade(sc);
      });
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

    // CAP-7.2: warm (load + decode) EVERY scenario for this card right after init, so the very
    // first switch is seamless. Swaps also await warm(sc) individually, so correctness holds
    // even if a click lands before this finishes.
    function warmAll(){ configs.forEach(function(c){ c.scenarios.forEach(warm); }); }
    if("requestIdleCallback" in window) requestIdleCallback(warmAll); else setTimeout(warmAll, 200);
  }

  function start(){ document.querySelectorAll("[data-cap]").forEach(initCard); }
  if(document.readyState === "loading") document.addEventListener("DOMContentLoaded", start);
  else start();
})();
