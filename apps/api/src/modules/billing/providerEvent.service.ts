import crypto from "node:crypto";
import type { BillingProvider, Prisma } from "@prisma/client";
import { prisma } from "../../lib/prisma.js";
import type { BillingDbClient } from "./entitlement.service.js";

export type ProviderEventRegistration = {
  provider: BillingProvider;
  providerEventId: string;
  eventType: string;
  rawPayload: string | Buffer;
  externalObjectId?: string | null;
  eventCreatedAt?: Date | null;
  metadataJson?: Prisma.InputJsonValue;
};

export function hashProviderPayload(rawPayload: string | Buffer): string {
  return crypto.createHash("sha256").update(rawPayload).digest("hex");
}

export async function registerProviderEvent(
  input: ProviderEventRegistration,
  db: BillingDbClient = prisma,
) {
  const payloadHash = hashProviderPayload(input.rawPayload);
  const inserted = await db.providerEvent.createMany({
    data: [{
      provider: input.provider,
      providerEventId: input.providerEventId,
      eventType: input.eventType,
      payloadHash,
      externalObjectId: input.externalObjectId ?? null,
      eventCreatedAt: input.eventCreatedAt ?? null,
      metadataJson: input.metadataJson,
    }],
    skipDuplicates: true,
  });
  const event = await db.providerEvent.findUniqueOrThrow({
    where: {
      provider_providerEventId: {
        provider: input.provider,
        providerEventId: input.providerEventId,
      },
    },
  });
  return {
    event,
    duplicate: inserted.count === 0,
    payloadMatches: event.payloadHash === payloadHash,
  };
}

export async function claimProviderEvent(provider: BillingProvider, providerEventId: string) {
  return prisma.$transaction(async (tx) => {
    const claimed = await tx.providerEvent.updateMany({
      where: {
        provider,
        providerEventId,
        status: { in: ["RECEIVED", "FAILED"] },
      },
      data: {
        status: "PROCESSING",
        processingStartedAt: new Date(),
        attemptCount: { increment: 1 },
        lastErrorCode: null,
        lastErrorMessage: null,
      },
    });
    const event = await tx.providerEvent.findUniqueOrThrow({
      where: { provider_providerEventId: { provider, providerEventId } },
    });
    return { event, claimed: claimed.count === 1 };
  });
}

export async function completeProviderEvent(
  provider: BillingProvider,
  providerEventId: string,
  status: "PROCESSED" | "IGNORED" = "PROCESSED",
) {
  return prisma.providerEvent.update({
    where: { provider_providerEventId: { provider, providerEventId } },
    data: { status, processedAt: new Date(), lastErrorCode: null, lastErrorMessage: null },
  });
}

export async function failProviderEvent(
  provider: BillingProvider,
  providerEventId: string,
  errorCode: string,
  safeErrorMessage: string,
) {
  return prisma.providerEvent.update({
    where: { provider_providerEventId: { provider, providerEventId } },
    data: {
      status: "FAILED",
      lastErrorCode: errorCode.slice(0, 120),
      lastErrorMessage: safeErrorMessage.slice(0, 500),
    },
  });
}
