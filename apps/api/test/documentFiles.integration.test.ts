import test, { after } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { randomUUID, createHash } from "node:crypto";
import { requireIsolatedDatabase } from "./isolatedDatabaseGuard.ts";
let disconnect: (() => Promise<void>) | undefined;
after(async () => disconnect?.());
test(
  "private document upload, download, sharing, replacement and deletion lifecycle",
  { skip: !process.env.SUBSCRIPTION_TEST_DATABASE_URL },
  async (t) => {
    process.env.DATABASE_URL = requireIsolatedDatabase(
      process.env.SUBSCRIPTION_TEST_DATABASE_URL
    );
    const { prisma, disconnectDatabase } = await import(
      "../dist/lib/prisma.js"
    );
    disconnect = disconnectDatabase;
    const { DocumentFiles } = await import(
      "../dist/modules/documents/documentFiles.service.js"
    );
    const { storageUnavailable } = await import(
      "../dist/modules/documents/objectStorage.js"
    );
    const { saveDocumentMetadata, documentRouter } = await import(
      "../dist/modules/documents/document.routes.js"
    );
    const stored = new Map<string, Buffer>();
    await t.test(
      "all attachment HTTP endpoints reject unauthenticated access",
      async () => {
        const app = express();
        app.use(express.json());
        app.use("/documents", documentRouter);
        const server = app.listen(0, "127.0.0.1");
        await new Promise<void>((resolve) => server.once("listening", resolve));
        const address = server.address();
        assert(address && typeof address !== "string");
        try {
          for (const [method, path] of [
            ["GET", "/capabilities"],
            ["GET", "/unknown"],
            ["POST", "/unknown/upload-init"],
            ["PUT", "/unknown/attachments/unknown/bytes"],
            ["POST", "/unknown/upload-complete"],
            ["GET", "/unknown/download"],
            ["DELETE", "/unknown"],
            ["DELETE", "/unknown/attachments/unknown"],
            ["POST", "/unknown/share"],
            ["POST", "/unknown/attachment-order"],
          ]) {
            const response = await fetch(
              "http://127.0.0.1:" + address.port + "/documents" + path,
              { method }
            );
            assert.equal(response.status, 401);
            await response.arrayBuffer();
          }
        } finally {
          await new Promise<void>((resolve) => server.close(() => resolve()));
        }
      }
    );
    let failUpload = false,
      failEmail = false,
      sends = 0;
    const storage = {
      configured: true,
      async put(key: string, bytes: Buffer) {
        if (failUpload) throw new Error("test unavailable");
        stored.set(key, bytes);
      },
      async remove(key: string) {
        stored.delete(key);
      },
      async download(key: string, _name: string, seconds: number) {
        assert(stored.has(key));
        assert.equal(seconds, 900);
        return "https://private.example.test/" + key + "?expires=900";
      },
    };
    const delivery = {
      configured: true,
      async send() {
        sends++;
        if (failEmail) throw new Error("test delivery unknown");
        return { providerMessageId: "test-provider-id" };
      },
    };
    const files = new DocumentFiles(prisma, storage, delivery);
    const owner = await prisma.user.create({
      data: {
        email: randomUUID() + "@example.test",
        passwordHash: "synthetic",
        fullName: "Document test",
      },
    });
    const other = await prisma.user.create({
      data: {
        email: randomUUID() + "@example.test",
        passwordHash: "synthetic",
        fullName: "Other test",
      },
    });
    const doc = await saveDocumentMetadata(prisma, owner.id, {
      createOperationId: randomUUID(),
      type: "POD",
      fileName: "Test POD",
    });
    const bytes = Buffer.from("%PDF-1.7\nlocal document fixture");
    const input = {
      operationId: randomUUID(),
      originalFilename: "proof.pdf",
      mimeType: "application/pdf",
      sizeBytes: bytes.length,
      checksum: createHash("sha256").update(bytes).digest("hex"),
    };
    let id = "";
    try {
      await t.test("unconfigured provider refuses persistence", async () => {
        const unavailable = new DocumentFiles(
          prisma,
          storageUnavailable,
          delivery
        );
        await assert.rejects(
          unavailable.init(owner.id, doc.id, input),
          /DOCUMENT_STORAGE_NOT_CONFIGURED/
        );
        assert.equal(stored.size, 0);
      });
      await t.test(
        "cross-user access rejected for every operation",
        async () => {
          for (const action of [
            () => files.detail(other.id, doc.id),
            () => files.init(other.id, doc.id, input),
            () => files.download(other.id, doc.id, randomUUID()),
            () => files.remove(other.id, doc.id),
            () =>
              files.share(other.id, doc.id, {
                operationId: randomUUID(),
                channel: "EMAIL",
                email: "test@example.test",
              }),
            () => files.reorder(other.id, doc.id, []),
          ])
            await assert.rejects(action, /DOCUMENT_NOT_FOUND/);
        }
      );
      await t.test(
        "initialization idempotent, conflicting replay rejected, completion not invented",
        async () => {
          id = (await files.init(owner.id, doc.id, input)).id;
          assert.equal((await files.init(owner.id, doc.id, input)).id, id);
          await assert.rejects(
            files.init(owner.id, doc.id, {
              ...input,
              originalFilename: "changed.pdf",
            }),
            /DOCUMENT_OPERATION_CONFLICT/
          );
          await assert.rejects(
            files.complete(owner.id, doc.id, id),
            /DOCUMENT_UPLOAD_INCOMPLETE/
          );
          assert.equal(stored.size, 0);
        }
      );
      await t.test(
        "failed upload retains retry; wrong bytes rejected; confirmed bytes complete once",
        async () => {
          await assert.rejects(
            files.upload(owner.id, doc.id, id, Buffer.from("bad")),
            /DOCUMENT_CONTENT_MISMATCH/
          );
          failUpload = true;
          await assert.rejects(files.upload(owner.id, doc.id, id, bytes));
          failUpload = false;
          assert.equal(
            (await files.upload(owner.id, doc.id, id, bytes)).status,
            "SAVED"
          );
          await files.upload(owner.id, doc.id, id, bytes);
          assert.equal(stored.size, 1);
          assert.equal(
            (await files.complete(owner.id, doc.id, id)).status,
            "SAVED"
          );
        }
      );
      await t.test(
        "detail excludes object keys, download requires owner, page order exact",
        async () => {
          const detail = await files.detail(owner.id, doc.id);
          assert(!JSON.stringify(detail).includes("storageKey"));
          assert(!JSON.stringify(detail).includes("requestHash"));
          assert.equal(detail.attachments.length, 1);
          assert.equal(
            (await files.download(owner.id, doc.id, id)).expiresIn,
            900
          );
          await assert.rejects(
            files.reorder(owner.id, doc.id, [id, id]),
            /DOCUMENT_ORDER_INVALID/
          );
          await files.reorder(owner.id, doc.id, [id]);
        }
      );
      await t.test(
        "share-sheet does not claim delivery; provider accepts email idempotently",
        async () => {
          assert.equal(
            (
              await files.share(owner.id, doc.id, {
                operationId: randomUUID(),
                channel: "SHARE_SHEET",
              })
            ).status,
            "SHARE_SHEET_OPENED"
          );
          const send = {
            operationId: randomUUID(),
            channel: "EMAIL",
            email: "dispatch@example.test",
          };
          assert.equal(
            (await files.share(owner.id, doc.id, send)).status,
            "SENT_TO_PROVIDER"
          );
          await files.share(owner.id, doc.id, send);
          assert.equal(sends, 1);
          failEmail = true;
          await assert.rejects(
            files.share(owner.id, doc.id, {
              ...send,
              operationId: randomUUID(),
            }),
            /DOCUMENT_SHARE_UNCONFIRMED/
          );
          failEmail = false;
          assert(
            (await files.detail(owner.id, doc.id)).shares.every(
              (s) => s.deliveryStatus !== "DELIVERED"
            )
          );
        }
      );
      await t.test(
        "replacement preserves metadata and old file until successful upload",
        async () => {
          const previous = await prisma.document.findUniqueOrThrow({
            where: { id: doc.id },
          });
          const replacement = await files.init(owner.id, doc.id, {
            ...input,
            operationId: randomUUID(),
            replaceId: id,
          });
          assert.equal(
            (await files.detail(owner.id, doc.id)).attachments.find(
              (a) => a.id === id
            )?.status,
            "SAVED"
          );
          await files.upload(owner.id, doc.id, replacement.id, bytes);
          const after = await prisma.document.findUniqueOrThrow({
            where: { id: doc.id },
          });
          assert.equal(after.type, previous.type);
          assert.equal(after.fileName, previous.fileName);
          assert.deepEqual(after.issuedOn, previous.issuedOn);
          await files.cleanup();
          assert.equal(stored.size, 1);
        }
      );
      await t.test(
        "delete tombstones metadata and cleans bytes; replay cannot resurrect deleted record",
        async () => {
          await files.remove(owner.id, doc.id);
          await files.cleanup();
          assert.equal(stored.size, 0);
          await assert.rejects(
            files.detail(owner.id, doc.id),
            /DOCUMENT_NOT_FOUND/
          );
          assert(
            (await prisma.document.findUniqueOrThrow({ where: { id: doc.id } }))
              .deletedAt
          );
        }
      );
    } finally {
      await prisma.documentShare.deleteMany({ where: { documentId: doc.id } });
      await prisma.documentAttachment.deleteMany({
        where: { documentId: doc.id },
      });
      await prisma.document.deleteMany({ where: { id: doc.id } });
      await prisma.adminAuditLog.deleteMany({
        where: { actorUserId: { in: [owner.id, other.id] } },
      });
      await prisma.user.deleteMany({
        where: { id: { in: [owner.id, other.id] } },
      });
    }
  }
);
