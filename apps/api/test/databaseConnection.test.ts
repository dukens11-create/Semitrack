import assert from "node:assert/strict";
import test from "node:test";
import { secureDatabaseConnectionString } from "../src/lib/databaseConnection.ts";

test("enforces full TLS verification and channel binding for Neon", () => {
  const result = new URL(
    secureDatabaseConnectionString(
      "postgresql://user:password@example.neon.tech/database?sslmode=require",
    ),
  );

  assert.equal(result.searchParams.get("sslmode"), "verify-full");
  assert.equal(result.searchParams.get("channel_binding"), "require");
});

test("leaves non-Neon PostgreSQL URLs unchanged", () => {
  const input = "postgresql://user:password@localhost:5432/database";
  assert.equal(secureDatabaseConnectionString(input), input);
});
