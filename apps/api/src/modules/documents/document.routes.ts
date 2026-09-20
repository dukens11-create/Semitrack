import { createHash } from "node:crypto";
import { Router, raw } from "express";
import { DocumentFiles } from "./documentFiles.service.js";
import { configuredDocumentStorage, DocumentError } from "./objectStorage.js";
import { configuredDocumentDelivery } from "./documentDelivery.js";
import { DOCUMENT_FILE_LIMITS } from "../../contracts/documentFiles.js";
import type { Document, PrismaClient } from "@prisma/client";
import { z } from "zod";
import { requireAuth } from "../../middleware/auth.js";
import { prisma } from "../../lib/prisma.js";
import { deny } from "../admin/operationalPolicy.js";
const date = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine(
    (v) =>
      Number.isFinite(Date.parse(v)) &&
      new Date(v).toISOString().slice(0, 10) === v
  )
  .nullable()
  .optional();
export const documentMetadataSchema = z
  .object({
    createOperationId: z.string().uuid().optional(),
    type: z.enum([
      "CDL",
      "MEDICAL",
      "REGISTRATION",
      "INSURANCE",
      "PERMIT",
      "IFTA",
      "BOL",
      "POD",
      "RATE_CONFIRMATION",
      "GENERAL",
    ]),
    fileName: z.string().trim().min(1).max(150),
    truckId: z.string().min(1).max(128).nullable().optional(),
    issuedOn: date,
    expiresOn: date,
  })
  .strict()
  .refine(
    (v) => !v.issuedOn || !v.expiresOn || v.issuedOn <= v.expiresOn,
    "Expiration precedes issue date"
  );
export function publicDocument(
  d: Document & { attachments?: Array<{ status: string }> }
) {
  return {
    id: d.id,
    type: d.type,
    fileName: d.fileName,
    truckId: d.truckId,
    issuedOn: d.issuedOn,
    expiresOn: d.expiresOn,
    verificationState: d.verificationState,
    revision: d.revision,
    createdAt: d.createdAt,
    expired:
      !!d.expiresOn &&
      d.expiresOn < new Date(new Date().toISOString().slice(0, 10)),
    fileAvailable: !!d.attachments?.some((a) => a.status === "SAVED"),
    attachmentCount:
      d.attachments?.filter((a) => a.status === "SAVED").length ?? 0,
  };
}
export async function saveDocumentMetadata(
  db: PrismaClient,
  userId: string,
  input: unknown,
  id?: string
) {
  const outer = id
    ? z
        .object({
          expectedRevision: z.number().int().positive(),
          metadata: documentMetadataSchema,
        })
        .strict()
        .parse(input)
    : {
        metadata: documentMetadataSchema.parse(input),
        expectedRevision: undefined,
      };
  const b = outer.metadata;
  return db.$transaction(
    async (tx) => {
      if (
        b.truckId &&
        !(await tx.truck.findFirst({
          where: { id: b.truckId, userId },
          select: { id: true },
        }))
      )
        deny("TRUCK_NOT_FOUND", 404);
      const data = {
        type: b.type,
        fileName: b.fileName,
        truckId: b.truckId ?? null,
        issuedOn: b.issuedOn ? new Date(b.issuedOn) : null,
        expiresOn: b.expiresOn ? new Date(b.expiresOn) : null,
        verificationState: "UNVERIFIED",
      };
      if (!id) {
        if (!b.createOperationId) deny("CREATE_OPERATION_REQUIRED", 400);
        const auditId =
          "document-create:" +
          createHash("sha256")
            .update(JSON.stringify([userId, b.createOperationId]))
            .digest("hex");
        const requestHash = createHash("sha256")
          .update(JSON.stringify(data))
          .digest("hex");
        const prior = await tx.adminAuditLog.findUnique({
          where: { id: auditId },
        });
        if (prior) {
          if (
            prior.actorUserId !== userId ||
            (prior.metadataJson as { requestHash?: string } | null)
              ?.requestHash !== requestHash ||
            !prior.targetId
          )
            deny("CREATE_OPERATION_CONFLICT", 409);
          const original = await tx.document.findFirst({
            where: { id: prior.targetId, userId, deletedAt: null },
          });
          if (!original) deny("DOCUMENT_NOT_FOUND", 404);
          return original;
        }
        const result = await tx.document.create({
          data: { ...data, userId, fileUrl: "" },
        });
        await tx.adminAuditLog.create({
          data: {
            id: auditId,
            actorUserId: userId,
            action: "DOCUMENT_CREATED",
            targetType: "DOCUMENT",
            targetId: result.id,
            metadataJson: { requestHash },
          },
        });
        return result;
      }
      const current = await tx.document.findFirst({
        where: { id, userId, deletedAt: null },
      });
      if (!current) deny("DOCUMENT_NOT_FOUND", 404);
      if (current.revision !== outer.expectedRevision)
        deny("DOCUMENT_CHANGED", 409);
      const changed = await tx.document.updateMany({
        where: { id, userId, revision: outer.expectedRevision },
        data: { ...data, revision: { increment: 1 } },
      });
      if (changed.count !== 1) deny("DOCUMENT_CHANGED", 409);
      return tx.document.findUniqueOrThrow({
        where: { id },
        include: { attachments: { select: { status: true } } },
      });
    },
    { isolationLevel: "Serializable" }
  );
}
export const documentRouter = Router();
export const documentFiles = new DocumentFiles(
  prisma,
  configuredDocumentStorage(),
  configuredDocumentDelivery()
);
documentRouter.use(requireAuth);
documentRouter.use((_req, res, next) => {
  res.setHeader("cache-control", "private, no-store");
  next();
});
const wrap =
  (fn: (req: any, res: any) => Promise<unknown>) =>
  (req: any, res: any, next: any) =>
    void fn(req, res).catch(next);
documentRouter.get(
  "/",
  wrap(async (req, res) =>
    res.json({
      items: (
        await prisma.document.findMany({
          where: { userId: req.user.userId, deletedAt: null },
          orderBy: { createdAt: "desc" },
          include: { attachments: { select: { status: true } } },
          take: 100,
        })
      ).map(publicDocument),
      uploadAvailable: documentFiles.capabilities().storageAvailable,
    })
  )
);
documentRouter.post(
  "/",
  wrap(async (req, res) =>
    res
      .status(201)
      .json(
        publicDocument(
          await saveDocumentMetadata(prisma, req.user.userId, req.body)
        )
      )
  )
);
documentRouter.patch(
  "/:id",
  wrap(async (req, res) =>
    res.json(
      publicDocument(
        await saveDocumentMetadata(
          prisma,
          req.user.userId,
          req.body,
          String(req.params.id)
        )
      )
    )
  )
);

/** Metadata routes stay backward compatible; bytes use authenticated bounded uploads. */
export function mountDocumentFiles(
  router: ReturnType<typeof Router>,
  files: DocumentFiles
) {
  router.use((req, res, next) => {
    res.setHeader("cache-control", "private, no-store");
    res.once("finish", () => {
      if (req.method !== "GET") void files.cleanup().catch(() => {});
    });
    next();
  });
  const handle =
    (fn: (req: any, res: any) => Promise<unknown>) =>
    (req: any, res: any, next: any) =>
      void fn(req, res).catch((e: unknown) => {
        if (e instanceof DocumentError)
          res
            .status(e.httpStatus)
            .json({
              error: {
                code: e.code,
                message: "The document operation could not be completed.",
              },
            });
        else next(e);
      });
  router.get("/capabilities", (_req, res) => res.json(files.capabilities()));
  router.get(
    "/:id",
    handle(async (req, res) =>
      res.json(await files.detail(req.user.userId, String(req.params.id)))
    )
  );
  router.post(
    "/:id/upload-init",
    handle(async (req, res) =>
      res.json(
        await files.init(req.user.userId, String(req.params.id), req.body)
      )
    )
  );
  router.put(
    "/:id/attachments/:attachmentId/bytes",
    raw({
      type: "application/octet-stream",
      limit: DOCUMENT_FILE_LIMITS.singleBytes,
    }),
    handle(async (req, res) =>
      res.json(
        await files.upload(
          req.user.userId,
          String(req.params.id),
          String(req.params.attachmentId),
          req.body
        )
      )
    )
  );
  router.post(
    "/:id/upload-complete",
    handle(async (req, res) =>
      res.json(
        await files.complete(
          req.user.userId,
          String(req.params.id),
          z.object({ attachmentId: z.string().uuid() }).strict().parse(req.body)
            .attachmentId
        )
      )
    )
  );
  router.get(
    "/:id/download",
    handle(async (req, res) =>
      res.json(
        await files.download(
          req.user.userId,
          String(req.params.id),
          z.string().uuid().parse(req.query.attachmentId)
        )
      )
    )
  );
  router.post(
    "/:id/attachment-order",
    handle(async (req, res) =>
      res.json(
        await files.reorder(
          req.user.userId,
          String(req.params.id),
          z.array(z.string().uuid()).parse(req.body.ids)
        )
      )
    )
  );
  router.delete(
    "/:id/attachments/:attachmentId",
    handle(async (req, res) =>
      res.json(
        await files.remove(
          req.user.userId,
          String(req.params.id),
          String(req.params.attachmentId)
        )
      )
    )
  );
  router.delete(
    "/:id",
    handle(async (req, res) =>
      res.json(await files.remove(req.user.userId, String(req.params.id)))
    )
  );
  router.post(
    "/:id/share",
    handle(async (req, res) =>
      res.json(
        await files.share(req.user.userId, String(req.params.id), req.body)
      )
    )
  );
  router.use((error:any,_req:any,res:any,next:any)=>{
    if(error?.type==='entity.too.large')return res.status(413).json({error:{code:'DOCUMENT_FILE_TOO_LARGE',message:'Document exceeds the upload size limit.'}});
    next(error);
  });
}
mountDocumentFiles(documentRouter, documentFiles);
documentRouter.post("/upload", (_req, res) =>
  res
    .status(503)
    .json({
      error: {
        code: "DOCUMENT_STORAGE_NOT_CONFIGURED",
        message:
          "Private attachment storage must be configured before uploads are available.",
      },
    })
);
