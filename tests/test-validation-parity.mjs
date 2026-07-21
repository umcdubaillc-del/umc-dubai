// DF-11 — validation parity across entry paths + per-emirate lead-time at job convert.
// The admin direct-create and lead/job-convert paths must apply the SAME contact-field
// and lead-time rules the public booking form uses (V20/V10). This test cross-checks
// src/admin.js against site/assets/booking.js and mirrors the gate logic.
// Run: node tests/test-validation-parity.mjs
import { readFileSync } from "node:fs";

const admin = readFileSync(new URL("../src/admin.js", import.meta.url), "utf8");
const booking = readFileSync(new URL("../site/assets/booking.js", import.meta.url), "utf8");

// ---- logic mirrors ----
const EMAIL_RX = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
function emailValid(v){ v = String(v==null?"":v).trim(); return v === "" || EMAIL_RX.test(v); }
function phoneValid(v){ v = String(v==null?"":v).trim(); if(v==="") return true; const d = v.replace(/[^0-9]/g,""); return /^\+?[0-9][0-9\s().+-]{5,}$/.test(v) && d.length>=7 && d.length<=15; }
function emirateHours(text){
  const e = String(text||"").toLowerCase();
  if(e.indexOf("dubai")>=0) return 1;
  if(e.indexOf("sharjah")>=0) return 2;
  if(e.indexOf("ajman")>=0) return 2;
  if(e.indexOf("abu dhabi")>=0) return 3;
  if(e.indexOf("fujairah")>=0) return 3;
  if(e.indexOf("ras al khaimah")>=0) return 3;
  if(e.indexOf("umm al quwain")>=0) return 3;
  return 0;
}
// deterministic lead-time check (inject today/now).
function leadTimeOk(pickup, dateIso, timeStr, todayIso, nowMins){
  const h = emirateHours(pickup);
  if(h <= 0) return true;
  if(String(dateIso).slice(0,10) !== todayIso) return true;   // only same-day floored
  const m = String(timeStr).match(/^(\d{1,2}):(\d{2})/); if(!m) return true;
  return ((+m[1])*60 + (+m[2])) >= (nowMins + h*60);
}

let allPass=true;
function check(label,cond){ if(!cond) allPass=false; console.log("  ["+(cond?"PASS":"FAIL")+"] "+label); }

console.log("Cross-file parity (admin mirrors booking):");
check("both files use the SAME EMAIL_RX source",
  admin.includes("/^[^\\s@]+@[^\\s@]+\\.[^\\s@]{2,}$/") && booking.includes("/^[^\\s@]+@[^\\s@]+\\.[^\\s@]{2,}$/"));
// emirate hours in admin match booking's table
for(const [em,hrs] of [["Dubai",1],["Sharjah",2],["Ajman",2],["Abu Dhabi",3],["Fujairah",3]]){
  const re = new RegExp('"'+em+'",?\\s*hours:\\s*'+hrs);
  check(em+" lead-time = "+hrs+"h in booking (reference)", re.test(booking));
}
check("admin defines the same emirate lead-time table", /umcEmirateLeadHours/.test(admin) && /"Dubai", hours: 1/.test(admin) && /"Abu Dhabi", hours: 3/.test(admin));

console.log("Email/phone validators (format when present; empty allowed):");
check("valid email passes", emailValid("guest@example.ae") === true);
check("invalid email fails", emailValid("not-an-email") === false);
check("blank email allowed (optional)", emailValid("") === true);
check("valid E.164 phone passes", phoneValid("+971 50 123 4567") === true);
check("too-short phone fails", phoneValid("12345") === false);
check("blank phone allowed", phoneValid("") === true);

console.log("Per-emirate lead-time gate (same-day floor):");
check("Dubai same-day, 30min out → blocked (needs 60)", leadTimeOk("Dubai Marina","2026-07-24","10:30","2026-07-24", 10*60) === false);
check("Dubai same-day, 90min out → ok", leadTimeOk("Dubai Marina","2026-07-24","11:30","2026-07-24", 10*60) === true);
check("Abu Dhabi same-day, 2h out → blocked (needs 3)", leadTimeOk("Abu Dhabi Corniche","2026-07-24","12:00","2026-07-24", 10*60) === false);
check("future date → unrestricted", leadTimeOk("Abu Dhabi","2026-07-25","06:00","2026-07-24", 10*60) === true);
check("unknown emirate → unrestricted", leadTimeOk("Some Farm","2026-07-24","10:05","2026-07-24", 10*60) === true);

console.log("Source guard (src/admin.js):");
check("direct-create validates email format (parity)", admin.includes("if (!umcEmailValid(b.client_email))"));
check("direct-create validates phone format (parity)", admin.includes("if (!umcPhoneValid(b.client_phone))"));
check("job convert enforces per-emirate lead-time", admin.includes("umcLeadTimeCheck(f.pickup, f.date, f.time)"));
check("lead-time gate is overridable (force_leadtime)", admin.includes("!b.force_leadtime"));

console.log("");
if(allPass){ console.log("ALL ASSERTIONS PASS ✓"); process.exit(0); }
else { console.error("HARNESS FAILED ✗"); process.exit(1); }
