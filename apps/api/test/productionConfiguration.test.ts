import assert from "node:assert/strict";
import test from "node:test";

import { validateProductionConfiguration } from "../dist/config/productionConfig.js";

const valid = {
  NODE_ENV: "production",
  DATABASE_URL: "postgresql://user:test-fixture-only@db.example.com:5432/semitrax?sslmode=require",
  JWT_SECRET: "a-secure-production-secret-with-32-characters",
  ACCESS_TOKEN_MINUTES: "15",
  REFRESH_TOKEN_DAYS: "30",
  PUBLIC_API_URL: "https://api.semitrax.com",
  CORS_ORIGINS: "https://www.semitrax.com,https://admin.semitrax.com",
};

test("development configuration retains local defaults", () => {
  assert.doesNotThrow(() => validateProductionConfiguration({ NODE_ENV: "development" }));
});

for (const name of ["DATABASE_URL", "JWT_SECRET", "ACCESS_TOKEN_MINUTES", "REFRESH_TOKEN_DAYS", "PUBLIC_API_URL", "CORS_ORIGINS"]) {
  test(`production rejects missing ${name}`, () => {
    assert.throws(() => validateProductionConfiguration({ ...valid, [name]: "" }), new RegExp(name));
  });
}

test("production rejects development and non-HTTPS URLs", () => {
  for (const url of ["http://api.semitrax.com", "http://10.0.2.2:4000", "https://localhost:4000"]) {
    assert.throws(() => validateProductionConfiguration({ ...valid, PUBLIC_API_URL: url }), /PUBLIC_API_URL/);
  }
  assert.throws(() => validateProductionConfiguration({ ...valid, CORS_ORIGINS: "http://localhost:5173" }), /CORS_ORIGINS/);
});

test("complete production configuration is accepted", () => {
  assert.doesNotThrow(() => validateProductionConfiguration(valid));
});


test("Render refuses a missing or non-production NODE_ENV", () => {
  for (const nodeEnv of [undefined, "development", "prod", ""]) {
    assert.throws(() => validateProductionConfiguration({ ...valid, RENDER: "true", NODE_ENV: nodeEnv }), /NODE_ENV/);
  }
  assert.doesNotThrow(() => validateProductionConfiguration({ ...valid, RENDER: "true" }));
});

test("production rejects malformed or example database configuration without leaking it", () => {
  for (const databaseUrl of ["postgresql://", "https://example.com/db", "postgresql://USER:PASSWORD@HOST:5432/example", "postgresql://user:pass@db", "postgresql://user:pass@db/example#fragment"]) {
    assert.throws(() => validateProductionConfiguration({ ...valid, DATABASE_URL: databaseUrl }), (error: Error) => {
      assert.match(error.message, /DATABASE_URL/);
      assert.ok(!error.message.includes(databaseUrl));
      return true;
    });
  }
});

test("production rejects placeholder and whitespace-padded JWT secrets", () => {
  for (const secret of ["short", "replace-with-at-least-32-random-characters", "development-" + "x".repeat(32), " " + valid.JWT_SECRET]) {
    assert.throws(() => validateProductionConfiguration({ ...valid, JWT_SECRET: secret }), (error: Error) => {
      assert.match(error.message, /JWT_SECRET/);
      assert.ok(!error.message.includes(secret));
      return true;
    });
  }
});

test("production URL and CORS origins reject ambiguous or non-public destinations", () => {
  for (const origin of ["https://api.semitrax.com/", "https://api.semitrax.com/path", "https://api.semitrax.com?x=1", "https://api.semitrax.com#fragment", "https://user:pass@api.semitrax.com", "https://*.semitrax.com", "https://127.0.0.2", "https://[::1]", "https://10.0.2.2", "https://backend.local", "https://backend.internal", "https://backend", "*"]) {
    assert.throws(() => validateProductionConfiguration({ ...valid, PUBLIC_API_URL: origin }), /PUBLIC_API_URL/);
    assert.throws(() => validateProductionConfiguration({ ...valid, CORS_ORIGINS: origin }), /CORS_ORIGINS/);
  }
  assert.throws(() => validateProductionConfiguration({ ...valid, CORS_ORIGINS: "https://www.semitrax.com," }), /CORS_ORIGINS/);
});

test("production token lifetimes and listen port must be usable integers", () => {
  for (const name of ["ACCESS_TOKEN_MINUTES", "REFRESH_TOKEN_DAYS"]) {
    for (const value of ["0", "-1", "1.5", "NaN", "Infinity", "9007199254740992"]) {
      assert.throws(() => validateProductionConfiguration({ ...valid, [name]: value }), new RegExp(name));
    }
  }
  for (const port of ["", "0", "65536", "1.5", "invalid"]) {
    assert.throws(() => validateProductionConfiguration({ ...valid, PORT: port }), /PORT/);
  }
  assert.doesNotThrow(() => validateProductionConfiguration({ ...valid, PORT: "10000" }));
});
