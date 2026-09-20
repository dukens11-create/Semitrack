import test from "node:test";
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import {
  validateDocumentFiles,
  DOCUMENT_FILE_LIMITS,
} from "../src/contracts/documentFiles.ts";
import {
  S3DocumentStorage,
  configuredDocumentStorage,
  assertStorageKey,
} from "../dist/modules/documents/objectStorage.js";
import { verifyDocumentBytes } from "../dist/modules/documents/documentFiles.service.js";
const bytes = Buffer.from("%PDF-1.7\nsynthetic local test");
const file = {
  originalFilename: "test.pdf",
  mimeType: "application/pdf",
  sizeBytes: bytes.length,
  checksum: createHash("sha256").update(bytes).digest("hex"),
};
test("document admission validates extension, MIME, checksum, bytes and central limits", () => {
  validateDocumentFiles([file]);
  verifyDocumentBytes(file, bytes);
  for (const change of [
    { originalFilename: "../test.pdf" },
    { originalFilename: "test.exe" },
    { mimeType: "text/html" },
    { sizeBytes: DOCUMENT_FILE_LIMITS.singleBytes + 1 },
    { checksum: "bad" },
  ])
    assert.throws(() => validateDocumentFiles([{ ...file, ...change }]));
  assert.throws(() =>
    validateDocumentFiles(Array.from({ length: 21 }, () => file))
  );
  assert.throws(() =>
    validateDocumentFiles(
      Array.from({ length: 4 }, () => ({
        ...file,
        sizeBytes: DOCUMENT_FILE_LIMITS.singleBytes,
      }))
    )
  );
  assert.throws(() => verifyDocumentBytes(file, Buffer.from("not a PDF")));
  assert.throws(() =>
    verifyDocumentBytes({ ...file, mimeType: "image/png" }, bytes)
  );
});
test("storage configuration fails closed and keys cannot traverse or select arbitrary endpoints", () => {
  assert.equal(configuredDocumentStorage({}).configured, false);
  for (const key of [
    "../private",
    "documents/../../secret",
    "https://bad.test/a",
    "documents/a/b",
  ])
    assert.throws(() => assertStorageKey(key));
  assert.throws(
    () =>
      new S3DocumentStorage({
        bucket: "https://bad.test",
        region: "us-west-2",
        accessKey: "fixture",
        secretKey: "fixture",
      })
  );
});
test("private links expire and signature covers encryption/checksum headers; no public upload URL", async () => {
  const storage = new S3DocumentStorage({
    bucket: "test-private-bucket",
    region: "us-west-2",
    accessKey: "fixture",
    secretKey: "fixture",
  });
  const key = "documents/" + randomUUID() + "/" + randomUUID(),
    url = new URL(
      storage.sign("GET", key, 900, {}, new Date("2026-09-20T00:00:00Z"))
    );
  assert.equal(url.protocol, "https:");
  assert.equal(url.searchParams.get("X-Amz-Expires"), "900");
  assert.equal(url.searchParams.get("X-Amz-Date"), "20260920T000000Z");
  assert(url.searchParams.get("X-Amz-Signature"));
  const put = new URL(
    storage.sign("PUT", key, 120, {}, new Date(), {
      "x-amz-checksum-sha256": "fixture",
      "x-amz-server-side-encryption": "AES256",
      "if-none-match": "*",
    })
  );
  assert.equal(
    put.searchParams.get("X-Amz-SignedHeaders"),
    "host;if-none-match;x-amz-checksum-sha256;x-amz-server-side-encryption"
  );
  assert.throws(() => storage.sign("GET", key, 86400));
});
test("storage retry verifies existing object checksum and length rather than treating 412 as success", async () => {
  const key = "documents/" + randomUUID() + "/" + randomUUID(),
    checksum = createHash("sha256").update(bytes).digest("base64");
  let calls = 0;
  const request = (async () =>
    ++calls % 2 === 1
      ? new Response(null, { status: 412 })
      : new Response(null, {
          status: 200,
          headers: {
            "content-length": String(bytes.length),
            "x-amz-checksum-sha256": checksum,
          },
        })) as typeof fetch;
  const storage = new S3DocumentStorage(
    {
      bucket: "test-private-bucket",
      region: "us-west-2",
      accessKey: "fixture",
      secretKey: "fixture",
    },
    request
  );
  await storage.put(key, bytes, "application/pdf");
  assert.equal(calls, 2);
  const corrupt = new S3DocumentStorage(
    {
      bucket: "test-private-bucket",
      region: "us-west-2",
      accessKey: "fixture",
      secretKey: "fixture",
    },
    (async () => new Response(null, { status: 412 })) as typeof fetch
  );
  await assert.rejects(
    corrupt.put(key, bytes, "application/pdf"),
    /DOCUMENT_UPLOAD_FAILED/
  );
});
