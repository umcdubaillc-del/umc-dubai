/* © UMC Dubai LLC. All rights reserved. Unauthorised reproduction of this code or design is prohibited and monitored. */
/* CAP-4 / CAP-5-SIMPLE — capacity module (photographic seating; no tabs, no boot SVG).
   SEATING ships the default scenario <picture> in SSR; selecting a scenario row (or,
   on the Yukon, switching the captain/bench segmented toggle) cross-fades the image.
   ONE STATIC CAMERA — no zoom. Non-default images are prefetched after init. BOOT SPACE
   is a text section whose combo rows are accordion disclosures (one dimension line per
   size); JS only flips aria-expanded and enforces exclusivity — CSS drives the reveal. */
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
    function crossfade(sc){
      if(!seatingMedia) return;
      var old = seatingMedia.querySelector("picture");
      var tmp = document.createElement("div"); tmp.innerHTML = pictureHTML(sc, data.sizes, data.widths);
      var np = tmp.firstChild;
      if(RM || !old){ while(seatingMedia.firstChild) seatingMedia.removeChild(seatingMedia.firstChild); seatingMedia.appendChild(np); return; }
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
    function markRows(cid, sid){
      card.querySelectorAll(".cap-rows .cap-scen").forEach(function(el){
        var on = el.getAttribute("data-config")===cid && el.getAttribute("data-scen")===sid;
        el.classList.toggle("on", on); el.setAttribute("aria-checked", on?"true":"false");
      });
    }
    function selectScen(cid, sid, fade){
      var sc = scenById(cfgById(cid), sid);
      curConfig = cid;
      if(fade) crossfade(sc);
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
      selectScen(cid, cfg.default, true);
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
      var row = e.target.closest(".cap-scen");      if(row){ selectScen(row.getAttribute("data-config"), row.getAttribute("data-scen"), true); return; }
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
