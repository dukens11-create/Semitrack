import { createHash, randomUUID } from "node:crypto";
import type { PrismaClient, Prisma } from "@prisma/client";
import { z } from "zod";
import {
  DOCUMENT_FILE_LIMITS,
  validateDocumentFile,
  validateDocumentFiles,
} from "../../contracts/documentFiles.js";
import { DocumentError, type PrivateObjectStorage } from "./objectStorage.js";
import type { DocumentDelivery } from "./documentDelivery.js";
type Db = PrismaClient | Prisma.TransactionClient;
type Attachment = {
  id: string;
  documentId: string;
  operationId: string;
  requestHash: string;
  storageKey: string;
  originalFilename: string;
  mimeType: string;
  sizeBytes: number;
  checksum: string;
  pageOrder: number;
  status: string;
  replaceId: string | null;
  createdAt: Date;
  completedAt: Date | null;
};
const digest = (value: string | Buffer) =>
  createHash("sha256").update(value).digest("hex");
const descriptor = z
  .object({
    operationId: z.string().uuid(),
    originalFilename: z.string(),
    mimeType: z.string(),
    sizeBytes: z.number(),
    checksum: z.string(),
    replaceId: z.string().uuid().nullable().optional(),
  })
  .strict();
const shareInput = z
  .object({
    operationId: z.string().uuid(),
    channel: z.enum(["EMAIL", "SHARE_SHEET"]),
    email: z.string().email().max(254).optional(),
    subject: z.string().trim().min(1).max(150).default("SemiTraX document"),
    message: z
      .string()
      .max(2000)
      .default("Please find the requested document from SemiTraX."),
  })
  .strict();
function checked<T>(fn: () => T): T {
  try {
    return fn();
  } catch (e) {
    if (e instanceof Error && e.message.startsWith("DOCUMENT_"))
      throw new DocumentError(e.message);
    throw e;
  }
}
export function verifyDocumentBytes(
  file: { mimeType: string; sizeBytes: number; checksum: string },
  bytes: Buffer
) {
  if (
    !Buffer.isBuffer(bytes) ||
    bytes.length !== file.sizeBytes ||
    digest(bytes) !== file.checksum
  )
    throw new DocumentError("DOCUMENT_CONTENT_MISMATCH");
  const mime =
    bytes.subarray(0, 5).toString() === "%PDF-"
      ? "application/pdf"
      : bytes.length > 3 &&
        bytes[0] === 255 &&
        bytes[1] === 216 &&
        bytes[2] === 255
      ? "image/jpeg"
      : bytes
          .subarray(0, 8)
          .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
      ? "image/png"
      : null;
  if (mime !== file.mimeType)
    throw new DocumentError("DOCUMENT_TYPE_UNSUPPORTED");
  // Magic checks are format admission, never a malware-scan claim.
}
export class DocumentFiles {
  constructor(
    private db: PrismaClient,
    private storage: PrivateObjectStorage,
    private delivery: DocumentDelivery
  ) {}
  capabilities() {
    return {
      storageAvailable: this.storage.configured,
      emailAvailable: this.storage.configured && this.delivery.configured,
      scanStatus: "NOT_CONFIGURED",
      limits: DOCUMENT_FILE_LIMITS,
      unavailableCode: this.storage.configured
        ? null
        : "DOCUMENT_STORAGE_NOT_CONFIGURED",
    };
  }
  private storageReady() {
    if (!this.storage.configured)
      throw new DocumentError("DOCUMENT_STORAGE_NOT_CONFIGURED", 503);
  }
  private async owned(db: Db, owner: string, id: string, lock = false) {
    if (lock) {
      await db.$queryRawUnsafe(
        'SELECT id FROM "User" WHERE id=$1 FOR UPDATE',
        owner
      );
      await db.$queryRawUnsafe(
        'SELECT id FROM "Document" WHERE id=$1 AND "userId"=$2 FOR UPDATE',
        id,
        owner
      );
    }
    const rows = await db.$queryRawUnsafe<
      Array<{ id: string; revision: number; truckId: string | null }>
    >(
      'SELECT d.id,d.revision,d."truckId" FROM "Document" d JOIN "User" u ON u.id=d."userId" WHERE d.id=$1 AND d."userId"=$2 AND d."deletedAt" IS NULL AND u."disabledAt" IS NULL',
      id,
      owner
    );
    if (!rows[0]) throw new DocumentError("DOCUMENT_NOT_FOUND", 404);
    return rows[0];
  }
  private audit(db: Db, owner: string, id: string, action: string) {
    return db.adminAuditLog.create({
      data: {
        actorUserId: owner,
        targetType: "DOCUMENT",
        targetId: id,
        action,
      },
    });
  }
  private attachments(db: Db, id: string) {
    return db.$queryRawUnsafe<Attachment[]>(
      'SELECT * FROM "DocumentAttachment" WHERE "documentId"=$1 AND status IN (\'PENDING\',\'SAVED\',\'FAILED\') ORDER BY "pageOrder","createdAt"',
      id
    );
  }
  async detail(owner: string, id: string) {
    await this.owned(this.db, owner, id);
    const attachments = await this.attachments(this.db, id);
    const shares = await this.db.$queryRawUnsafe<
      Array<Record<string, unknown>>
    >(
      'SELECT id,"recipientType","recipientValue","deliveryStatus","createdAt","failedAt","failureReason" FROM "DocumentShare" WHERE "documentId"=$1 ORDER BY "createdAt" DESC LIMIT 50',
      id
    );
    return {
      attachments: attachments.map(
        ({
          storageKey,
          requestHash,
          operationId,
          documentId,
          ...publicFields
        }) => publicFields
      ),
      shares,
      scanStatus: "NOT_CONFIGURED",
    };
  }
  async init(owner: string, id: string, raw: unknown) {
    this.storageReady();
    const input = descriptor.parse(raw);
    checked(() => validateDocumentFile(input));
    const requestHash = digest(JSON.stringify(input));
    return this.db.$transaction(async (tx) => {
      await this.owned(tx, owner, id, true);
      const rows = await this.attachments(tx, id);
      const previous = rows.find((r) => r.operationId === input.operationId);
      if (previous) {
        if (previous.requestHash !== requestHash)
          throw new DocumentError("DOCUMENT_OPERATION_CONFLICT", 409);
        return { id: previous.id, status: previous.status };
      }
      if (
        input.replaceId &&
        !rows.some((r) => r.id === input.replaceId && r.status === "SAVED")
      )
        throw new DocumentError("DOCUMENT_ATTACHMENT_NOT_FOUND", 404);
      checked(() =>
        validateDocumentFiles([
          ...rows.filter((r) => r.id !== input.replaceId),
          input,
        ])
      );
      const attachmentId = randomUUID(),
        key = "documents/" + randomUUID() + "/" + attachmentId,
        pageOrder = input.replaceId
          ? rows.find((r) => r.id === input.replaceId)!.pageOrder
          : Math.max(-1, ...rows.map((r) => r.pageOrder)) + 1;
      await tx.$executeRawUnsafe(
        'INSERT INTO "DocumentAttachment" (id,"documentId","operationId","requestHash","storageKey","originalFilename","mimeType","sizeBytes",checksum,"pageOrder","replaceId") VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)',
        attachmentId,
        id,
        input.operationId,
        requestHash,
        key,
        input.originalFilename,
        input.mimeType,
        input.sizeBytes,
        input.checksum,
        pageOrder,
        input.replaceId ?? null
      );
      await tx.document.update({ where: { id }, data: { fileUrl: "private" } });
      await tx.$executeRawUnsafe(
        'INSERT INTO "DocumentObjectCleanup" ("storageKey","notBefore") VALUES ($1,NOW()+INTERVAL \'1 day\')',
        key
      );
      await this.audit(tx, owner, id, "DOCUMENT_UPLOAD_STARTED");
      return { id: attachmentId, status: "PENDING" };
    });
  }
  async upload(owner: string, id: string, attachmentId: string, bytes: Buffer) {
    this.storageReady();
    // Durable before external I/O: rollback cannot erase orphan cleanup tracking.
    await this.db.$transaction(async (tx) => {
      await this.owned(tx, owner, id, true);
      const file = (await this.attachments(tx, id)).find(
        (f) => f.id === attachmentId
      );
      if (!file) throw new DocumentError("DOCUMENT_ATTACHMENT_NOT_FOUND", 404);
      verifyDocumentBytes(file, bytes);
      if (file.status !== "SAVED")
        await tx.$executeRawUnsafe(
          'INSERT INTO "DocumentObjectCleanup" ("storageKey","notBefore") VALUES ($1,NOW()+INTERVAL \'1 day\') ON CONFLICT ("storageKey") DO UPDATE SET "notBefore"=EXCLUDED."notBefore"',
          file.storageKey
        );
    });
    try {
      return await this.db.$transaction(
        async (tx) => {
          const doc = await this.owned(tx, owner, id, true);
          const rows = await this.attachments(tx, id),
            file = rows.find((r) => r.id === attachmentId);
          if (!file)
            throw new DocumentError("DOCUMENT_ATTACHMENT_NOT_FOUND", 404);
          verifyDocumentBytes(file, bytes);
          if (file.status === "SAVED") return { id: file.id, status: "SAVED" };
          await this.storage.put(file.storageKey, bytes, file.mimeType);
          if (file.replaceId) {
            const old = rows.find(
              (r) => r.id === file.replaceId && r.status === "SAVED"
            );
            if (!old)
              throw new DocumentError("DOCUMENT_REPLACEMENT_CHANGED", 409);
            await tx.$executeRawUnsafe(
              "UPDATE \"DocumentAttachment\" SET status='REPLACED' WHERE id=$1",
              old.id
            );
            await tx.$executeRawUnsafe(
              'INSERT INTO "DocumentObjectCleanup" ("storageKey","retentionHold") VALUES ($1,$2) ON CONFLICT ("storageKey") DO UPDATE SET "retentionHold"=$2',
              old.storageKey,
              Boolean(doc.truckId)
            );
            await this.audit(tx, owner, id, "DOCUMENT_REPLACED");
          }
          await tx.$executeRawUnsafe(
            'UPDATE "DocumentAttachment" SET status=\'SAVED\',"completedAt"=NOW() WHERE id=$1',
            file.id
          );
          await tx.$executeRawUnsafe(
            'DELETE FROM "DocumentObjectCleanup" WHERE "storageKey"=$1',
            file.storageKey
          );
          await this.audit(tx, owner, id, "DOCUMENT_UPLOAD_COMPLETED");
          return { id: file.id, status: "SAVED" };
        },
        { timeout: 90000 }
      );
    } catch (e) {
      await this.db
        .$transaction(async (tx) => {
          await this.owned(tx, owner, id, true);
          await tx.$executeRawUnsafe(
            "UPDATE \"DocumentAttachment\" SET status='FAILED' WHERE id=$1 AND \"documentId\"=$2 AND status IN ('PENDING','FAILED')",
            attachmentId,
            id
          );
          await this.audit(tx, owner, id, "DOCUMENT_UPLOAD_FAILED");
        })
        .catch(() => {});
      throw e;
    }
  }
  async complete(owner: string, id: string, attachmentId: string) {
    await this.owned(this.db, owner, id);
    const file = (await this.attachments(this.db, id)).find(
      (a) => a.id === attachmentId
    );
    if (file?.status !== "SAVED")
      throw new DocumentError("DOCUMENT_UPLOAD_INCOMPLETE", 409);
    return { id: file.id, status: "SAVED" };
  }
  async download(owner: string, id: string, attachmentId: string) {
    this.storageReady();
    return this.db.$transaction(async (tx) => {
      await this.owned(tx, owner, id, true);
      const file = (await this.attachments(tx, id)).find(
        (a) => a.id === attachmentId && a.status === "SAVED"
      );
      if (!file) throw new DocumentError("DOCUMENT_ATTACHMENT_NOT_FOUND", 404);
      const url = await this.storage.download(
        file.storageKey,
        file.originalFilename,
        DOCUMENT_FILE_LIMITS.downloadSeconds
      );
      await this.audit(tx, owner, id, "DOCUMENT_VIEWED");
      return {
        url,
        expiresIn: DOCUMENT_FILE_LIMITS.downloadSeconds,
        filename: file.originalFilename,
        mimeType: file.mimeType,
        sizeBytes: file.sizeBytes,
        checksum: file.checksum,
      };
    });
  }
  async reorder(owner: string, id: string, ids: string[]) {
    if (
      ids.length > DOCUMENT_FILE_LIMITS.attachments ||
      new Set(ids).size !== ids.length
    )
      throw new DocumentError("DOCUMENT_ORDER_INVALID");
    return this.db.$transaction(async (tx) => {
      await this.owned(tx, owner, id, true);
      const files = await this.attachments(tx, id);
      if (files.length !== ids.length || files.some((f) => !ids.includes(f.id)))
        throw new DocumentError("DOCUMENT_ORDER_CHANGED", 409);
      for (const [i, key] of ids.entries())
        await tx.$executeRawUnsafe(
          'UPDATE "DocumentAttachment" SET "pageOrder"=$1 WHERE id=$2 AND "documentId"=$3',
          i,
          key,
          id
        );
      return { updated: true };
    });
  }
  async remove(owner: string, id: string, attachmentId?: string) {
    return this.db.$transaction(async (tx) => {
      const doc = await this.owned(tx, owner, id, true),
        files = await this.attachments(tx, id),
        selected = attachmentId
          ? files.filter((f) => f.id === attachmentId)
          : files;
      if (attachmentId && !selected.length)
        throw new DocumentError("DOCUMENT_ATTACHMENT_NOT_FOUND", 404);
      for (const f of selected) {
        await tx.$executeRawUnsafe(
          "UPDATE \"DocumentAttachment\" SET status='DELETED' WHERE id=$1",
          f.id
        );
        await tx.$executeRawUnsafe(
          'INSERT INTO "DocumentObjectCleanup" ("storageKey","retentionHold") VALUES ($1,$2) ON CONFLICT ("storageKey") DO UPDATE SET "retentionHold"=$2,"notBefore"=NOW()',
          f.storageKey,
          Boolean(doc.truckId)
        );
      }
      if (!attachmentId)
        await tx.$executeRawUnsafe(
          'UPDATE "Document" SET "deletedAt"=NOW(),revision=revision+1 WHERE id=$1',
          id
        );
      await this.audit(tx, owner, id, "DOCUMENT_DELETED");
      return {
        deleted: true,
        cleanup: doc.truckId ? "POLICY_REQUIRED" : "PENDING",
      };
    });
  }
  async share(owner: string, id: string, raw: unknown) {
    this.storageReady();
    const input = shareInput.parse(raw);
    if (input.channel === "EMAIL" && !input.email)
      throw new DocumentError("DOCUMENT_EMAIL_REQUIRED");
    if (input.channel === "EMAIL" && !this.delivery.configured)
      throw new DocumentError("DOCUMENT_EMAIL_NOT_CONFIGURED", 503);
    const requestHash = digest(JSON.stringify(input));
    const prepared = await this.db.$transaction(async (tx) => {
      await this.owned(tx, owner, id, true);
      const rows = await tx.$queryRawUnsafe<
        Array<{
          id: string;
          requestHash: string;
          deliveryStatus: string;
          createdAt: Date;
        }>
      >(
        'SELECT * FROM "DocumentShare" WHERE "documentId"=$1 AND "operationId"=$2',
        id,
        input.operationId
      );
      if (rows[0]) {
        if (rows[0].requestHash !== requestHash)
          throw new DocumentError("DOCUMENT_OPERATION_CONFLICT", 409);
        return { ...rows[0], existing: true };
      }
      const files = (await this.attachments(tx, id)).filter(
        (f) => f.status === "SAVED"
      );
      if (!files.length)
        throw new DocumentError("DOCUMENT_UPLOAD_INCOMPLETE", 409);
      const shareId = randomUUID();
      await tx.$executeRawUnsafe(
        'INSERT INTO "DocumentShare" (id,"documentId","sharedByUserId","operationId","requestHash","recipientType","recipientValue","deliveryProvider","deliveryStatus") VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)',
        shareId,
        id,
        owner,
        input.operationId,
        requestHash,
        input.channel,
        input.email ?? null,
        input.channel === "EMAIL" ? "RESEND" : "DEVICE",
        input.channel === "EMAIL" ? "SEND_PENDING" : "SHARE_SHEET_OPENED"
      );
      await this.audit(tx, owner, id, "DOCUMENT_SHARED");
      return {
        id: shareId,
        deliveryStatus:
          input.channel === "EMAIL" ? "SEND_PENDING" : "SHARE_SHEET_OPENED",
        existing: false,
        createdAt: new Date(),
      };
    });
    if (input.channel === "SHARE_SHEET" || prepared.existing)
      return { id: prepared.id, status: prepared.deliveryStatus };
    try {
      const files = (await this.detail(owner, id)).attachments.filter(
        (f) => f.status === "SAVED"
      );
      const links = await Promise.all(
        files.map(async (f) => (await this.download(owner, id, f.id)).url)
      );
      const accepted = await this.delivery.send({
        id: prepared.id,
        email: input.email!,
        subject: input.subject,
        message: input.message,
        links,
      });
      await this.db.$executeRawUnsafe(
        'UPDATE "DocumentShare" SET "deliveryStatus"=\'SENT_TO_PROVIDER\',"providerMessageId"=$1 WHERE id=$2',
        accepted.providerMessageId,
        prepared.id
      );
      return { id: prepared.id, status: "SENT_TO_PROVIDER" };
    } catch {
      await this.db.$executeRawUnsafe(
        'UPDATE "DocumentShare" SET "deliveryStatus"=\'FAILED\',"failedAt"=NOW(),"failureReason"=\'DOCUMENT_SHARE_UNCONFIRMED\' WHERE id=$1',
        prepared.id
      );
      await this.audit(this.db, owner, id, "DOCUMENT_SHARE_FAILED");
      throw new DocumentError("DOCUMENT_SHARE_UNCONFIRMED", 503);
    }
  }
  /** Durable cleanup; each key is retained until object deletion succeeds. Fleet-linked files require approved retention review. */
  async cleanup() {
    if (!this.storage.configured) return;
    const rows = await this.db.$queryRawUnsafe<Array<{ storageKey: string }>>(
      'SELECT "storageKey" FROM "DocumentObjectCleanup" WHERE "retentionHold"=false AND "notBefore"<=NOW() LIMIT 10'
    );
    for (const row of rows) {
      try {
        await this.db.$transaction(
          async (tx) => {
            const files = await tx.$queryRawUnsafe<Attachment[]>(
              'SELECT * FROM "DocumentAttachment" WHERE "storageKey"=$1',
              row.storageKey
            );
            const f = files[0];
            if (f) {
              await tx.$queryRawUnsafe(
                'SELECT id FROM "Document" WHERE id=$1 FOR UPDATE',
                f.documentId
              );
              // A retry or retention decision may have changed this job after the sweep
              // selected it. Recheck under the same document lock as uploads/deletes.
              const due = await tx.$queryRawUnsafe<
                Array<{ storageKey: string }>
              >(
                'SELECT "storageKey" FROM "DocumentObjectCleanup" WHERE "storageKey"=$1 AND "retentionHold"=false AND "notBefore"<=NOW() FOR UPDATE',
                row.storageKey
              );
              if (!due.length) return;
              const current = (
                await tx.$queryRawUnsafe<Attachment[]>(
                  'SELECT * FROM "DocumentAttachment" WHERE id=$1',
                  f.id
                )
              )[0];
              if (current?.status === "SAVED") {
                await tx.$executeRawUnsafe(
                  'DELETE FROM "DocumentObjectCleanup" WHERE "storageKey"=$1',
                  row.storageKey
                );
                return;
              }
            }
            await this.storage.remove(row.storageKey);
            await tx.$executeRawUnsafe(
              'DELETE FROM "DocumentObjectCleanup" WHERE "storageKey"=$1',
              row.storageKey
            );
          },
          { timeout: 20000 }
        );
      } catch {
        /* no object keys or upstream errors in logs; next sweep retries */
      }
    }
  }
}
