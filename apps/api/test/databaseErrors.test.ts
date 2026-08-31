import assert from "node:assert/strict";
import test from "node:test";
import { isDatabaseUnavailableError } from "../src/lib/databaseErrors.ts";

test("recognizes the Windows native TLS database failure", () => {
  assert.equal(
    isDatabaseUnavailableError(
      new Error(
        "Error opening a TLS connection: No credentials are available in the security package",
      ),
    ),
    true,
  );
});

test("does not classify ordinary application errors as database outages", () => {
  assert.equal(isDatabaseUnavailableError(new Error("Invalid credentials")), false);
});
