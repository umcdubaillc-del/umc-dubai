/* © UMC Dubai LLC. All rights reserved. Unauthorised reproduction of this code or design is prohibited and monitored. */
/* CAP-3 — capacity module (photographic seating).
   SEATING ships the default scenario <picture> in SSR; selecting a scenario row (or,
   on the Yukon, switching the captain/bench segmented toggle) cross-fades the image.
   ONE STATIC CAMERA — no zoom. Non-default images are prefetched after init. The
   LUGGAGE tab (S-Class only) keeps the boot SVG: occupants dim and amber cases render
   in the rear deck. */
(function(){
  "use strict";
  var SVGNS = "http://www.w3.org/2000/svg";
  var RM = matchMedia("(prefers-reduced-motion:reduce)").matches;

  // ---- boot cases (S-Class luggage tab), 228x560 viewBox ----
  var CASE = { C:[26,20], M:[31,24], L:[36,28], XL:[40,31] };
  var DECK = { cx:114, cy:518, maxW:156, gap:6 };
  function cdims(s){ return CASE[s] || CASE.M; }
  function layoutCases(sizes){
    var rows=[], cur=[], curW=0, i, s, w, add;
    for(i=0;i<sizes.length;i++){
      s=sizes[i]; w=cdims(s)[0]; add = w + (cur.length ? DECK.gap : 0);
      if(cur.length && curW+add > DECK.maxW){ rows.push(cur); cur=[]; curW=0; add=w; }
      cur.push(s); curW+=add;
    }
    if(cur.length) rows.push(cur);
    var rowHs = rows.map(function(r){ return Math.max.apply(null, r.map(function(x){ return cdims(x)[1]; })); });
    var totalH = rowHs.reduce(function(a,b){ return a+b; }, 0) + DECK.gap*(rows.length-1);
    var y = DECK.cy - totalH/2, out=[], ri, r, rowW, x, rh, k, h, cy;
    for(ri=0; ri<rows.length; ri++){
      r=rows[ri];
      rowW = r.reduce(function(a,x){ return a + cdims(x)[0]; }, 0) + DECK.gap*(r.length-1);
      x = DECK.cx - rowW/2; rh = rowHs[ri];
      for(k=0; k<r.length; k++){
        s=r[k]; w=cdims(s)[0]; h=cdims(s)[1]; cy = y + (rh-h)/2;
        out.push({ x:Math.round(x*10)/10, y:Math.round(cy*10)/10, w:w, h:h, s:s });
        x += w + DECK.gap;
      }
      y += rh + DECK.gap;
    }
    return out;
  }
  function clear(node){ while(node && node.firstChild) node.removeChild(node.firstChild); }
  function svgEl(name, attrs){ var n=document.createElementNS(SVGNS,name); for(var k in attrs) n.setAttribute(k, attrs[k]); return n; }
  function renderCase(g, c){
    var hx0=c.x+c.w*0.32, hx1=c.x+c.w*0.42, hx2=c.x+c.w*0.58, hx3=c.x+c.w*0.68, hy=c.y-6;
    g.appendChild(svgEl("path", {d:"M "+hx0+" "+c.y+" Q "+hx0+" "+hy+" "+hx1+" "+hy+" L "+hx2+" "+hy+" Q "+hx3+" "+hy+" "+hx3+" "+c.y,
      fill:"none", stroke:"#C75B12", "stroke-width":"1.2", "stroke-opacity":"0.6"}));
    g.appendChild(svgEl("rect", {x:c.x, y:c.y, width:c.w, height:c.h, rx:"4.5",
      fill:"#C75B12", "fill-opacity":"0.14", stroke:"#C75B12", "stroke-width":"1.5"}));
    var sy=c.y+c.h*0.42;
    g.appendChild(svgEl("line", {x1:c.x+2.5, y1:sy, x2:c.x+c.w-2.5, y2:sy, stroke:"#C75B12", "stroke-width":"0.9", "stroke-opacity":"0.35"}));
    var t=svgEl("text", {x:c.x+c.w/2, y:c.y+c.h*0.78, "text-anchor":"middle", "font-size":"9",
      fill:"#A84B0C", "font-family":"ui-monospace,Menlo,monospace"});
    t.textContent=c.s; g.appendChild(t);
  }
  function renderDeck(g, sizes){ clear(g); layoutCases(sizes).forEach(function(c){ renderCase(g, c); }); }

  // ---- photographic seating ----
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
    var curConfig = data.defaultConfig, curScen = cfgById(curConfig).default;

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
      if(RM || !old){ clear(seatingMedia); seatingMedia.appendChild(np); return; }
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
      curConfig = cid; curScen = sid;
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

    // luggage (S-Class only)
    var svg = card.querySelector(".cap-media__luggage .cap-svg");
    var deck = svg ? svg.querySelector(".boot-cases") : null;
    var curCombo = data.luggage ? data.luggage.defaultCombo : null;
    function findCombo(id){ var L=data.luggage.combos, i; for(i=0;i<L.length;i++) if(L[i].id===id) return L[i]; }
    function applyCombo(id){
      var cb = findCombo(id); if(!cb) return;
      if(deck) renderDeck(deck, cb.cases);
      card.querySelectorAll(".cap-chip").forEach(function(el){
        var on = el.getAttribute("data-combo")===id;
        el.classList.toggle("on", on); el.setAttribute("aria-pressed", on?"true":"false");
      });
      curCombo = id;
    }
    function setTab(tab){
      var luggage = tab==="luggage";
      card.classList.toggle("mode-luggage", luggage);
      card.querySelectorAll(".cap-tab").forEach(function(b){
        var on = b.getAttribute("data-tab")===tab;
        b.classList.toggle("on", on); b.setAttribute("aria-selected", on?"true":"false");
      });
      card.querySelectorAll("[data-media]").forEach(function(m){ m.hidden = m.getAttribute("data-media")!==tab; });
      card.querySelectorAll(".cap-panel").forEach(function(p){ p.hidden = p.getAttribute("data-panel")!==tab; });
      if(luggage) applyCombo(curCombo);
    }

    card.addEventListener("click", function(e){
      var tab = e.target.closest("[data-tab]");            if(tab){ setTab(tab.getAttribute("data-tab")); return; }
      var seg = e.target.closest(".cap-seg__btn");         if(seg){ switchConfig(seg.getAttribute("data-config")); return; }
      var row = e.target.closest(".cap-scen");             if(row){ selectScen(row.getAttribute("data-config"), row.getAttribute("data-scen"), true); return; }
      var chip = e.target.closest("[data-combo]");         if(chip){ applyCombo(chip.getAttribute("data-combo")); return; }
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
