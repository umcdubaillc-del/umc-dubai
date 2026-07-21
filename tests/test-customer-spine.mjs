// DF-10 — customer spine. Documents dedupe onto ONE customer by E.164 phone (primary)
// then email at create/convert, so the same client's paperwork shares an identity
// instead of fragmenting (V19). Origin badges accumulate (never overwritten).
// Run: node tests/test-customer-spine.mjs
import { readFileSync } from "node:fs";

// ---- logic mirror (matches waMeNumber + resolveCustomer) ----
function e164(phone){ let d=String(phone==null?"":phone).replace(/\D/g,""); if(d.indexOf("00")===0)d=d.slice(2); if(d.charAt(0)==="0")return ""; if(d.length<8||d.length>15)return ""; return d; }
function makeStore(){ return { rows: [], nextId: 1 }; }
function resolveCustomer(store, info){
  const p = e164(info.phone) || "";
  const email = String(info.email||"").trim().toLowerCase();
  const name = String(info.name||"").trim();
  const origin = String(info.origin||"").trim();
  if(!p && !email) return null;
  let row = p ? store.rows.find(r=>r.phone_e164===p) : null;
  if(!row && email) row = store.rows.find(r=>r.email===email);
  if(row){
    if(origin && !row.origins.includes(origin)) row.origins.push(origin);
    if(!row.phone_e164 && p) row.phone_e164 = p;
    if(!row.email && email) row.email = email;
    if(!row.name && name) row.name = name;
    return row.id;
  }
  const id = store.nextId++;
  store.rows.push({ id, phone_e164: p||null, email: email||null, name: name||null, origins: origin?[origin]:[] });
  return id;
}

let allPass=true;
function check(label,cond){ if(!cond) allPass=false; console.log("  ["+(cond?"PASS":"FAIL")+"] "+label); }

console.log("Dedupe by E.164 phone (primary) then email:");
{
  const s = makeStore();
  const a = resolveCustomer(s, { phone:"+971 50 123 4567",   email:"aisha@x.com", name:"Aisha", origin:"lead" });
  const b = resolveCustomer(s, { phone:"00971-50-123-4567",  email:"different@x.com", name:"Aisha K", origin:"admin" }); // same number, 00-prefixed intl format
  check("same phone (different formatting) → same customer", a === b);
  check("only one customer row created", s.rows.length === 1);

  const c = resolveCustomer(s, { phone:"+971 55 999 0000", email:"aisha@x.com", origin:"admin" }); // new phone, SAME email
  check("different phone + same email → same customer (email fallback)", c === a);

  const d = resolveCustomer(s, { phone:"+971 55 111 2222", email:"omar@x.com", origin:"booking" });
  check("new phone + new email → NEW customer", d !== a && s.rows.length === 2);
}

console.log("Never fragments on nothing; origin badges accumulate:");
{
  const s = makeStore();
  check("no phone AND no email → null (no fragment)", resolveCustomer(s, { name:"Ghost" }) === null && s.rows.length === 0);

  const id = resolveCustomer(s, { phone:"+971501112233", origin:"lead" });
  resolveCustomer(s, { phone:"+971501112233", origin:"admin" });
  resolveCustomer(s, { phone:"+971501112233", origin:"lead" });   // duplicate origin
  const row = s.rows.find(r=>r.id===id);
  check("origins accumulated (both preserved)", row.origins.includes("lead") && row.origins.includes("admin"));
  check("duplicate origin not double-counted", row.origins.filter(o=>o==="lead").length === 1);
}

console.log("Source guard (src/admin.js):");
{
  const src = readFileSync(new URL("../src/admin.js", import.meta.url), "utf8");
  check("customers table created", src.includes("CREATE TABLE IF NOT EXISTS customers"));
  check("customer_id column on billing_documents", src.includes('"customer_id INTEGER"'));
  check("resolveCustomer helper exists (dedupe by phone then email)", src.includes("async function resolveCustomer("));
  check("phone dedupe primary", src.includes("SELECT * FROM customers WHERE phone_e164 = ?"));
  check("email dedupe fallback", src.includes("SELECT * FROM customers WHERE email = ?"));
  check("direct-create resolves a customer", src.includes("const customerId = await resolveCustomer(env,"));
  check("convert inherits the customer", src.includes("src.customer_id"));
}

console.log("");
if(allPass){ console.log("ALL ASSERTIONS PASS ✓"); process.exit(0); }
else { console.error("HARNESS FAILED ✗"); process.exit(1); }
