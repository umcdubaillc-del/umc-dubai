/* © UMC Dubai LLC. All rights reserved. Unauthorised reproduction of this code or design is prohibited and monitored. */
/* CAP-2 (addendum) — capacity module progressive enhancement.
   Geometry is traced from the owner-approved vectors (design/capacity/). SSR ships
   the full seat plan (viewBox 0 0 228 560) with the default scenario occupied; this
   wires the SEATING | LUGGAGE tabs, scenario cards (SEATING scope) and luggage combo
   chips (LUGGAGE scope). ONE STATIC CAMERA — no zoom: the Luggage view dims the
   occupants (CSS .mode-luggage) and renders amber-selected cases in the rear deck.
   Case geometry here is the single source of truth (the deck is empty in SSR and
   only ever populated on the client when the Luggage tab is active). */
(function(){
  "use strict";
  var SVGNS = "http://www.w3.org/2000/svg";
  // Case footprints [w,h] from umc-capacity-glyphs.svg — C/M/L/XL read true to scale.
  var CASE = { C:[26,20], M:[31,24], L:[36,28], XL:[40,31] };
  // Rear deck (case zone): centred on (114,518) between x36..192, y492..544.
  var DECK = { cx:114, cy:518, maxW:156, gap:6 };

  function dims(s){ return CASE[s] || CASE.M; }
  // Pack case sizes into centred rows within the deck; return positioned rects.
  function layoutCases(sizes){
    var rows=[], cur=[], curW=0, i, s, w, add;
    for(i=0;i<sizes.length;i++){
      s=sizes[i]; w=dims(s)[0]; add = w + (cur.length ? DECK.gap : 0);
      if(cur.length && curW+add > DECK.maxW){ rows.push(cur); cur=[]; curW=0; add=w; }
      cur.push(s); curW+=add;
    }
    if(cur.length) rows.push(cur);
    var rowHs = rows.map(function(r){ return Math.max.apply(null, r.map(function(x){ return dims(x)[1]; })); });
    var totalH = rowHs.reduce(function(a,b){ return a+b; }, 0) + DECK.gap*(rows.length-1);
    var y = DECK.cy - totalH/2, out=[], ri, r, rowW, x, rh, k, h, cy;
    for(ri=0; ri<rows.length; ri++){
      r=rows[ri];
      rowW = r.reduce(function(a,x){ return a + dims(x)[0]; }, 0) + DECK.gap*(r.length-1);
      x = DECK.cx - rowW/2; rh = rowHs[ri];
      for(k=0; k<r.length; k++){
        s=r[k]; w=dims(s)[0]; h=dims(s)[1]; cy = y + (rh-h)/2;
        out.push({ x:Math.round(x*10)/10, y:Math.round(cy*10)/10, w:w, h:h, s:s });
        x += w + DECK.gap;
      }
      y += rh + DECK.gap;
    }
    return out;
  }
  function clear(node){ while(node && node.firstChild) node.removeChild(node.firstChild); }
  function el(name, attrs){ var n=document.createElementNS(SVGNS,name); for(var k in attrs) n.setAttribute(k, attrs[k]); return n; }
  // Amber-selected case glyph (rect + handle + seam + letter), matching the glyph sheet.
  function renderCase(g, c){
    var hx0=c.x+c.w*0.32, hx1=c.x+c.w*0.42, hx2=c.x+c.w*0.58, hx3=c.x+c.w*0.68, hy=c.y-6;
    g.appendChild(el("path", {d:"M "+hx0+" "+c.y+" Q "+hx0+" "+hy+" "+hx1+" "+hy+" L "+hx2+" "+hy+" Q "+hx3+" "+hy+" "+hx3+" "+c.y,
      fill:"none", stroke:"#C75B12", "stroke-width":"1.2", "stroke-opacity":"0.6"}));
    g.appendChild(el("rect", {x:c.x, y:c.y, width:c.w, height:c.h, rx:"4.5",
      fill:"#C75B12", "fill-opacity":"0.14", stroke:"#C75B12", "stroke-width":"1.5"}));
    var sy=c.y+c.h*0.42;
    g.appendChild(el("line", {x1:c.x+2.5, y1:sy, x2:c.x+c.w-2.5, y2:sy, stroke:"#C75B12", "stroke-width":"0.9", "stroke-opacity":"0.35"}));
    var t=el("text", {x:c.x+c.w/2, y:c.y+c.h*0.78, "text-anchor":"middle", "font-size":"9",
      fill:"#A84B0C", "font-family":"ui-monospace,Menlo,monospace"});
    t.textContent=c.s; g.appendChild(t);
  }
  function renderDeck(g, sizes){ clear(g); layoutCases(sizes).forEach(function(c){ renderCase(g, c); }); }

  function initCard(card){
    var dataEl = card.querySelector(".cap-data");
    if(!dataEl) return;
    var data; try { data = JSON.parse(dataEl.textContent); } catch(e){ return; }
    var svg = card.querySelector(".cap-svg");
    var deck = svg ? svg.querySelector(".boot-cases") : null;
    var seats = {};
    if(svg) svg.querySelectorAll(".seat").forEach(function(s){ seats[s.getAttribute("data-seat")] = s; });
    // Selection is held in closure vars — NOT as data-* on the card, which would
    // make e.target.closest("[data-scen]") match the card for every child click
    // and swallow the luggage-chip handler.
    var curScen = data.defaultScenario, curCombo = data.defaultCombo;

    function find(list, id){ for(var i=0;i<list.length;i++){ if(list[i].id===id) return list[i]; } return null; }

    function applyScenario(id){
      var sc = find(data.scenarios, id); if(!sc) return;
      Object.keys(seats).forEach(function(k){ seats[k].classList.toggle("occupied", sc.occupied.indexOf(k) >= 0); });
      card.querySelectorAll(".cap-scen").forEach(function(el){
        var on = el.getAttribute("data-scen")===id;
        el.classList.toggle("on", on); el.setAttribute("aria-pressed", on ? "true" : "false");
      });
      curScen = id;
    }
    function applyCombo(id){
      var cb = find(data.luggage, id); if(!cb) return;
      if(deck) renderDeck(deck, cb.cases);
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
      else { applyScenario(curScen); if(deck) clear(deck); }
    }

    card.addEventListener("click", function(e){
      var tab = e.target.closest("[data-tab]");   if(tab){ setTab(tab.getAttribute("data-tab")); return; }
      var scen = e.target.closest("[data-scen]");  if(scen){ applyScenario(scen.getAttribute("data-scen")); return; }
      var chip = e.target.closest("[data-combo]"); if(chip){ applyCombo(chip.getAttribute("data-combo")); return; }
    });
  }

  function start(){ document.querySelectorAll("[data-cap]").forEach(initCard); }
  if(document.readyState === "loading") document.addEventListener("DOMContentLoaded", start);
  else start();
})();
