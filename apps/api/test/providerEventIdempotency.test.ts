import assert from "node:assert/strict";
import test from "node:test";
import { registerProviderEvent } from "../dist/modules/billing/providerEvent.service.js";

test("provider event registration is idempotent and detects event-ID payload changes", async () => {
  let stored: Record<string, unknown> | null = null;
  const fakeDb = {
    providerEvent: {
      createMany: async ({ data }: { data: Array<Record<string, unknown>> }) => {
        if (stored) return { count: 0 };
        stored = { id: "event-row", status: "RECEIVED", ...data[0] };
        return { count: 1 };
      },
      findUniqueOrThrow: async () => stored,
    },
  };

  const input = {
    provider: "STRIPE" as const,
    providerEventId: "evt_test_123",
    eventType: "customer.subscription.updated",
    rawPayload: "payload-one",
  };
  const first = await registerProviderEvent(input, fakeDb as never);
  assert.equal(first.duplicate, false);
  assert.equal(first.payloadMatches, true);

  const duplicate = await registerProviderEvent(input, fakeDb as never);
  assert.equal(duplicate.duplicate, true);
  assert.equal(duplicate.payloadMatches, true);

  const collision = await registerProviderEvent({ ...input, rawPayload: "different-payload" }, fakeDb as never);
  assert.equal(collision.duplicate, true);
  assert.equal(collision.payloadMatches, false);
});
