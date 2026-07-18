import assert from "node:assert";
import { capForLeadAlerts, mergeAuthorizedNumbers } from "../src/admin.js";

assert.equal(capForLeadAlerts({ escalation: true }), "cap_watchdog");
assert.equal(capForLeadAlerts({ escalation: false }), "cap_lead_alerts");
assert.equal(capForLeadAlerts(undefined), "cap_lead_alerts");
assert.equal(capForLeadAlerts({}), "cap_lead_alerts");

// empty override ⇒ exactly the cap_approve roster
assert.deepEqual(
  [...mergeAuthorizedNumbers(["971500000001"], "", [])].sort(),
  ["971500000001"]
);
// override ADDS an exceptional number
assert.deepEqual(
  [...mergeAuthorizedNumbers(["971500000001"], "971500000002", [])].sort(),
  ["971500000001", "971500000002"]
);
// a deactivated wa_team number cannot re-enter via the override
assert.deepEqual(
  [...mergeAuthorizedNumbers([], "971500000003", ["971500000003"])],
  []
);
// deactivated exclusion also applies to the roster arg
assert.deepEqual(
  [...mergeAuthorizedNumbers(["971500000003"], "", ["971500000003"])],
  []
);
console.log("test-roster2: OK");
