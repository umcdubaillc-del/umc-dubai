// PAY-PAGE hardening (W1 return loop, W2 expired/archived, W4 telemetry) — logic harness.
// Functions extracted/mirrored VERBATIM from src/admin.js. Run: node tests/test-pay-page-hardening.mjs

function payEsc(s){ return String(s==null?"":s).replace(/[&<>"']/g, function(c){ return {"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]; }); }
function payShell(inner, doctype){ return "[[DOC:"+doctype+"]]"+inner; } // stub — assert inner content
// ===== VERBATIM — payStateNotice =====
function payStateNotice(title, sub){
  return payShell(
    "<section class=\"service\"><h1>"+payEsc(title)+"</h1>"+(sub?"<p class=\"note\">"+payEsc(sub)+"</p>":"")+"<div class=\"service-rule\"></div></section>"+
    "<p class=\"taxline\" style=\"margin-top:1.2rem\">Our concierge is here to help.<br>"+
    "<a class=\"taxbtn\" href=\"https://api.whatsapp.com/send?phone=971586497861\">Message us on WhatsApp</a></p>"+
    "<p class=\"taxline\" style=\"margin-top:.55rem\">or call <a href=\"tel:+971586497861\" style=\"color:inherit\">+971 58 649 7861</a></p><div style=\"height:.4rem\"></div>",
    "Payment");
}
// ===== VERBATIM — W2 expiry decision (from handlePayPage) =====
function isExpired(link, nowMs){
  var paidNow = String(link.payment_status||"").toLowerCase() === "paid";
  if(paidNow) return false;                 // a paid link always shows its receipt
  if(!link.expiry_date) return false;
  var expRaw = String(link.expiry_date);
  var expMs = Date.parse(expRaw.length <= 10 ? (expRaw + "T23:59:59+04:00") : expRaw);
  return !isNaN(expMs) && nowMs > expMs;
}
// ===== VERBATIM — W1 return-loop URL =====
const PUBLIC_ORIGIN = "https://umcdubai.ae";
const returnUrl = (token) => PUBLIC_ORIGIN + "/pay/" + token;
// ===== VERBATIM — W4 lkAgo (admin display) =====
function fmtDate(iso){ return "01 Jan 2026"; } // stub
function lkAgo(iso, nowMs){
  var t = Date.parse(iso); if(isNaN(t)) return "";
  var s = Math.max(0, Math.floor((nowMs-t)/1000));
  if(s < 60) return "just now";
  var m = Math.floor(s/60); if(m < 60) return m+"m ago";
  var h = Math.floor(m/60); if(h < 24) return h+"h ago";
  var d = Math.floor(h/24); if(d < 30) return d+"d ago";
  return fmtDate(iso);
}

let allPass = true;
function check(label, cond, extra){ if(!cond) allPass=false; console.log("  ["+(cond?"PASS":"FAIL")+"] "+label); if(!cond&&extra) extra(); }
function eq(label,a,b){ check(label,a===b,()=>{console.log("        expected: "+JSON.stringify(b));console.log("        actual:   "+JSON.stringify(a));}); }

const NOW = Date.UTC(2026, 6, 21, 8, 0, 0); // 2026-07-21 12:00 GST

// ═══ W1 — return loop ═══
console.log("W1 — return-loop URLs:");
eq("(W1) success/failure → /pay/{token}", returnUrl("abc123_-XY"), "https://umcdubai.ae/pay/abc123_-XY");

// ═══ W2 — expiry decision ═══
console.log("W2 — expired decision:");
check("(W2) unpaid, expiry yesterday → EXPIRED", isExpired({ payment_status:"unpaid", expiry_date:"2026-07-20" }, NOW) === true);
check("(W2) unpaid, expiry today → still valid (through GST day)", isExpired({ payment_status:"unpaid", expiry_date:"2026-07-21" }, NOW) === false);
check("(W2) unpaid, expiry tomorrow → valid", isExpired({ payment_status:"unpaid", expiry_date:"2026-07-22" }, NOW) === false);
check("(W2) PAID + expired → NOT expired (receipt wins)", isExpired({ payment_status:"paid", expiry_date:"2026-07-01" }, NOW) === false);
check("(W2) no expiry_date → never expires", isExpired({ payment_status:"unpaid" }, NOW) === false);

// ═══ W2 — notice content (expired + archived share it) ═══
console.log("W2 — state notice content:");
{
  const exp = payStateNotice("This payment link has expired.", "Please contact our concierge to arrange payment.");
  check("(W2) title present", /This payment link has expired\./.test(exp));
  check("(W2) concierge WhatsApp → api.whatsapp.com/send?phone=971586497861", /api.whatsapp.com\/send\?phone=971586497861/.test(exp));
  check("(W2) phone tel: link", /tel:\+971586497861/.test(exp));
  check("(W2) NO pay button on state notice", exp.indexOf("paybtn") === -1);
  const arch = payStateNotice("This payment link is no longer active.", "Please contact our concierge if you still need to complete this payment.");
  check("(W2) archived headline", /no longer active/.test(arch));
}

// ═══ W4 — relative time ═══
console.log("W4 — view telemetry relative time:");
eq("(W4) 30s → just now", lkAgo(new Date(NOW-30*1000).toISOString(), NOW), "just now");
eq("(W4) 5m → 5m ago", lkAgo(new Date(NOW-5*60*1000).toISOString(), NOW), "5m ago");
eq("(W4) 3h → 3h ago", lkAgo(new Date(NOW-3*3600*1000).toISOString(), NOW), "3h ago");
eq("(W4) 2d → 2d ago", lkAgo(new Date(NOW-2*86400*1000).toISOString(), NOW), "2d ago");
eq("(W4) 60d → falls back to date", lkAgo(new Date(NOW-60*86400*1000).toISOString(), NOW), "01 Jan 2026");

console.log("");
if (allPass) { console.log("ALL ASSERTIONS PASS ✓"); process.exit(0); }
else { console.error("HARNESS FAILED ✗"); process.exit(1); }
