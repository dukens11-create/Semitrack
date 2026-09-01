import assert from "node:assert/strict";
import test from "node:test";
import {
  createPilotInvitationToken,
  hashPilotInvitationToken,
} from "../dist/modules/billing/pilot.service.js";

test("pilot invitation tokens are high-entropy, unique and stored as one-way hashes", () => {
  const first = createPilotInvitationToken();
  const second = createPilotInvitationToken();
  assert.notEqual(first, second);
  assert.ok(first.length >= 43);
  const hash = hashPilotInvitationToken(first);
  assert.match(hash, /^[a-f0-9]{64}$/);
  assert.notEqual(hash, first);
  assert.equal(hashPilotInvitationToken(first), hash);
});
