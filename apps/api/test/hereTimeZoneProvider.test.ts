import assert from "node:assert/strict";
import test from "node:test";
import { parseHereTimeZone } from "../src/services/providers/hereTimeZoneParser.ts";

test("parses HERE IANA zone and UTC offset", () => {
  assert.deepEqual(
    parseHereTimeZone({
      items: [{ timeZone: { name: "America/Los_Angeles", utcOffset: "-07:00" } }],
    }),
    { name: "America/Los_Angeles", utcOffset: "-07:00" },
  );
});

test("rejects missing or malformed HERE time-zone data", () => {
  assert.throws(() => parseHereTimeZone({ items: [] }), /did not include/);
  assert.throws(
    () => parseHereTimeZone({
      items: [{ timeZone: { name: "America/Los_Angeles", utcOffset: "PDT" } }],
    }),
    /invalid UTC offset/,
  );
});