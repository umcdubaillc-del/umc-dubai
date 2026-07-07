/* © UMC Dubai LLC. All rights reserved. Unauthorised reproduction of this code or design is prohibited and monitored. */
/* FLEET-UX-1-DESIGN — capacity module progressive enhancement.
   SSR ships the full SVG + the default seating scenario already marked occupied;
   this wires the SEATING | LUGGAGE tabs, the scenario cards, and the luggage
   combination chips. The boot-case layout algorithm here is the single source of
   truth for case geometry (no server mirror needed — the boot is empty in SSR and
   only ever populated on the client when the Luggage tab is active). */
(function(){
  "use strict";
  var SVGNS = "http://www.w3.org/2000/svg";
  // Relative case footprints [w,h] in the 190x340 viewBox — S/M/L/XL read true.
  var CASE = { S:[22,28], M:[28,34], L:[34,42], XL:[40,48] };
  var BOOT = { cx:95, cy:282, maxW:106, gap:8 };

  function dims(s){ return CASE[s] || CASE.M; }
  // Pack case sizes into centred rows within the boot zone; return positioned rects.
  function layoutCases(sizes){
    var rows=[], cur=[], curW=0, i, s, w, add;
    for(i=0;i<sizes.length;i++){
      s=sizes[i]; w=dims(s)[0]; add = w + (cur.length ? BOOT.gap : 0);
      if(cur.length && curW+add > BOOT.maxW){ rows.push(cur); cur=[]; curW=0; add=w; }
      cur.push(s); curW+=add;
    }
    if(cur.length) rows.push(cur);
    var rowHs = rows.map(function(r){ return Math.max.apply(null, r.map(function(x){ return dims(x)[1]; })); });
    var totalH = rowHs.reduce(function(a,b){ return a+b; }, 0) + BOOT.gap*(rows.length-1);
    var y = BOOT.cy - totalH/2, out=[], ri, r, rowW, x, rh, k, h, cy;
    for(ri=0; ri<rows.length; ri++){
      r=rows[ri];
      rowW = r.reduce(function(a,x){ return a + dims(x)[0]; }, 0) + BOOT.gap*(r.length-1);
      x = BOOT.cx - rowW/2; rh = rowHs[ri];
      for(k=0; k<r.length; k++){
        s=r[k]; w=dims(s)[0]; h=dims(s)[1]; cy = y + (rh-h)/2;
        out.push({ x:Math.round(x*10)/10, y:Math.round(cy*10)/10, w:w, h:h, s:s });
        x += w + BOOT.gap;
      }
      y += rh + BOOT.gap;
    }
    return out;
  }
  function clear(node){ while(node && node.firstChild) node.removeChild(node.firstChild); }
  function renderBoot(g, sizes){
    clear(g);
    layoutCases(sizes).forEach(function(c){
      var rect = document.createElementNS(SVGNS, "rect");
      rect.setAttribute("x", c.x); rect.setAttribute("y", c.y);
      rect.setAttribute("width", c.w); rect.setAttribute("height", c.h);
      rect.setAttribute("rx", "3"); rect.setAttribute("fill", "none");
      rect.setAttribute("stroke", "#7A6F5F"); rect.setAttribute("stroke-width", "1.3");
      g.appendChild(rect);
      var t = document.createElementNS(SVGNS, "text");
      t.setAttribute("x", c.x + c.w/2); t.setAttribute("y", c.y + c.h/2 + 3);
      t.setAttribute("text-anchor", "middle"); t.setAttribute("font-size", "8");
      t.setAttribute("fill", "#7A6F5F"); t.setAttribute("letter-spacing", "1");
      t.setAttribute("font-family", "ui-monospace,Menlo,monospace");
      t.textContent = c.s;
      g.appendChild(t);
    });
  }

  function initCard(card){
    var dataEl = card.querySelector(".cap-data");
    if(!dataEl) return;
    var data; try { data = JSON.parse(dataEl.textContent); } catch(e){ return; }
    var svg = card.querySelector(".cap-svg");
    var boot = svg ? svg.querySelector(".boot-cases") : null;
    var seats = {};
    if(svg) svg.querySelectorAll(".seat").forEach(function(s){ seats[s.getAttribute("data-seat")] = s; });
    // Current selection is held in closure vars — NOT as data-* on the card,
    // which would make e.target.closest("[data-scen]") match the card for every
    // child click and swallow the luggage-chip handler.
    var curScen = data.defaultScenario, curCombo = data.defaultCombo;

    function find(list, id){ for(var i=0;i<list.length;i++){ if(list[i].id===id) return list[i]; } return null; }

    function applyScenario(id){
      var sc = find(data.scenarios, id); if(!sc) return;
      Object.keys(seats).forEach(function(k){ seats[k].classList.toggle("occupied", sc.occupied.indexOf(k) >= 0); });
      card.querySelectorAll(".cap-scen").forEach(function(el){
        var on = el.getAttribute("data-scen")===id;
        el.classList.toggle("on", on); el.setAttribute("aria-selected", on ? "true" : "false");
      });
      curScen = id;
    }
    function applyCombo(id){
      var cb = find(data.luggage, id); if(!cb) return;
      if(boot) renderBoot(boot, cb.cases);
      card.querySelectorAll(".cap-chip").forEach(function(el){
        var on = el.getAttribute("data-combo")===id;
        el.classList.toggle("on", on); el.setAttribute("aria-pressed", on ? "true" : "false");
      });
      curCombo = id;
    }
    function setTab(tab){
      var luggage = tab==="luggage";
      card.classList.toggle("mode-luggage", luggage);
      card.querySelectorAll(".cap-tab").forEach(function(b){
        var on = b.getAttribute("data-tab")===tab;
        b.classList.toggle("on", on); b.setAttribute("aria-selected", on ? "true" : "false");
      });
      card.querySelectorAll(".cap-panel").forEach(function(p){ p.hidden = p.getAttribute("data-panel")!==tab; });
      if(luggage){ applyCombo(curCombo); }
      else { clear(boot); applyScenario(curScen); }
    }

    card.addEventListener("click", function(e){
      var tab = e.target.closest("[data-tab]");   if(tab){ setTab(tab.getAttribute("data-tab")); return; }
      var scen = e.target.closest("[data-scen]");  if(scen){ applyScenario(scen.getAttribute("data-scen")); return; }
      var chip = e.target.closest("[data-combo]"); if(chip){ applyCombo(chip.getAttribute("data-combo")); return; }
    });
  }

  function boot(){ document.querySelectorAll("[data-cap]").forEach(initCard); }
  if(document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
