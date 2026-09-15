import { createHash } from 'node:crypto';
import { Router } from 'express';
import type { Document, PrismaClient } from '@prisma/client';
import { z } from 'zod';
import { requireAuth } from '../../middleware/auth.js';
import { prisma } from '../../lib/prisma.js';
import { deny } from '../admin/operationalPolicy.js';
const date = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine(
    (v) =>
      Number.isFinite(Date.parse(v)) &&
      new Date(v).toISOString().slice(0, 10) === v,
  )
  .nullable()
  .optional();
export const documentMetadataSchema = z
  .object({
    createOperationId: z.string().uuid().optional(),
    type: z.enum([
      'CDL',
      'MEDICAL',
      'REGISTRATION',
      'INSURANCE',
      'PERMIT',
      'IFTA',
      'BOL',
      'POD',
      'RATE_CONFIRMATION',
      'GENERAL',
    ]),
    fileName: z.string().trim().min(1).max(150),
    truckId: z.string().min(1).max(128).nullable().optional(),
    issuedOn: date,
    expiresOn: date,
  })
  .strict()
  .refine(
    (v) => !v.issuedOn || !v.expiresOn || v.issuedOn <= v.expiresOn,
    'Expiration precedes issue date',
  );
export function publicDocument(d: Document) {
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
    fileAvailable: false,
  };
}
export async function saveDocumentMetadata(
  db: PrismaClient,
  userId: string,
  input: unknown,
  id?: string,
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
        deny('TRUCK_NOT_FOUND', 404);
      const data = {
        type: b.type,
        fileName: b.fileName,
        truckId: b.truckId ?? null,
        issuedOn: b.issuedOn ? new Date(b.issuedOn) : null,
        expiresOn: b.expiresOn ? new Date(b.expiresOn) : null,
        verificationState: 'UNVERIFIED',
      };
      if (!id) {
        if (!b.createOperationId) deny('CREATE_OPERATION_REQUIRED', 400);
        const auditId =
          'document-create:' +
          createHash('sha256')
            .update(JSON.stringify([userId, b.createOperationId]))
            .digest('hex');
        const requestHash = createHash('sha256')
          .update(JSON.stringify(data))
          .digest('hex');
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
            deny('CREATE_OPERATION_CONFLICT', 409);
          const original = await tx.document.findFirst({
            where: { id: prior.targetId, userId },
          });
          if (!original) deny('DOCUMENT_NOT_FOUND', 404);
          return original;
        }
        const result = await tx.document.create({
          data: { ...data, userId, fileUrl: '' },
        });
        await tx.adminAuditLog.create({
          data: {
            id: auditId,
            actorUserId: userId,
            action: 'DOCUMENT_CREATED',
            targetType: 'DOCUMENT',
            targetId: result.id,
            metadataJson: { requestHash },
          },
        });
        return result;
      }
      const current = await tx.document.findFirst({ where: { id, userId } });
      if (!current) deny('DOCUMENT_NOT_FOUND', 404);
      if (current.revision !== outer.expectedRevision)
        deny('DOCUMENT_CHANGED', 409);
      const changed = await tx.document.updateMany({
        where: { id, userId, revision: outer.expectedRevision },
        data: { ...data, revision: { increment: 1 } },
      });
      if (changed.count !== 1) deny('DOCUMENT_CHANGED', 409);
      return tx.document.findUniqueOrThrow({ where: { id } });
    },
    { isolationLevel: 'Serializable' },
  );
}
export const documentRouter = Router();
documentRouter.use(requireAuth);
const wrap =
  (fn: (req: any, res: any) => Promise<unknown>) =>
  (req: any, res: any, next: any) =>
    void fn(req, res).catch(next);
documentRouter.get(
  '/',
  wrap(async (req, res) =>
    res.json({
      items: (
        await prisma.document.findMany({
          where: { userId: req.user.userId },
          orderBy: { createdAt: 'desc' },
          take: 100,
        })
      ).map(publicDocument),
      uploadAvailable: false,
    }),
  ),
);
documentRouter.post(
  '/',
  wrap(async (req, res) =>
    res
      .status(201)
      .json(
        publicDocument(
          await saveDocumentMetadata(prisma, req.user.userId, req.body),
        ),
      ),
  ),
);
documentRouter.patch(
  '/:id',
  wrap(async (req, res) =>
    res.json(
      publicDocument(
        await saveDocumentMetadata(
          prisma,
          req.user.userId,
          req.body,
          String(req.params.id),
        ),
      ),
    ),
  ),
);
documentRouter.post('/upload', (_req, res) =>
  res
    .status(503)
    .json({
      error: {
        code: 'DOCUMENT_STORAGE_UNAVAILABLE',
        message:
          'Private document storage is not configured. You can save metadata only.',
      },
    }),
);
