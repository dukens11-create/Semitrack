import { createHash } from 'node:crypto';
import { Router } from 'express';
import type { Prisma, PrismaClient, Trip } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '../../lib/prisma.js';
import { requireAuth } from '../../middleware/auth.js';
import { deny } from '../admin/operationalPolicy.js';
import { isVerifiedTruck } from '../trucks/profileRevision.js';
export const tripPoint = z
  .object({
    id: z.string().min(1).max(128),
    name: z.string().trim().min(1).max(200),
    lat: z.number().finite().min(-90).max(90),
    lng: z.number().finite().min(-180).max(180),
  })
  .strict();
export const tripPlanSchema = z
  .object({
    createOperationId: z.string().uuid(),
    name: z.string().trim().min(1).max(120),
    origin: tripPoint,
    destination: tripPoint,
    stops: z.array(tripPoint).max(20),
    truckId: z.string().min(1).max(128).optional(),
    expectedTruckRevision: z.number().int().positive().optional(),
  })
  .strict()
  .superRefine((v, c) => {
    if (
      new Set([...v.stops, v.destination].map((p) => p.id)).size !==
      v.stops.length + 1
    )
      c.addIssue({ code: 'custom', message: 'Duplicate stop identity' });
    if (Boolean(v.truckId) !== Boolean(v.expectedTruckRevision))
      c.addIssue({ code: 'custom', message: 'Truck revision required' });
  });
export const tripTransitions: Record<string, readonly string[]> = {
  ASSIGNED: ['PLANNED', 'CANCELLED'],
  PLANNED: ['STARTED', 'CANCELLED'],
  STARTED: ['IN_PROGRESS', 'CANCELLED'],
  IN_PROGRESS: ['COMPLETED', 'CANCELLED'],
  COMPLETED: [],
  CANCELLED: [],
};
/** Driver-reported completion is an ordered prefix, never inferred from GPS/status. */
function tripStopProgress(t: Trip) {
  const options = (t.routeOptionsJson ?? {}) as Record<string, unknown>;
  const stops = z.array(tripPoint).parse(t.viaStopsJson ?? []);
  const assigned = !!(t.dispatchFleetId || t.dispatchActorId);
  const ids = [...(assigned ? [String(options.originId ?? 'origin')] : []), ...stops.map(s => s.id)];
  const completed = z.array(z.string()).parse(options.completedStopIds ?? []);
  if (new Set([...ids,String(options.destinationId ?? 'destination')]).size !== ids.length + 1) deny('TRIP_STOP_PLAN_INVALID',409);
  if (completed.length > ids.length || completed.some((id, i) => id !== ids[i])) deny('TRIP_STOP_PLAN_INVALID',409);
  return {ids, completed, options, assigned};
}
export function publicTrip(t: Trip) {
  const progress = tripStopProgress(t);
  return {
    id: t.id,
    name: t.name,
    status: t.status,
    revision: t.revision,
    truckId: t.truckId,
    truckSnapshot: t.truckSnapshotJson,
    origin: {
      id:
        (t.routeOptionsJson as { originId?: string } | null)?.originId ??
        'origin',
      name: t.originName,
      lat: t.originLat,
      lng: t.originLng,
    },
    destination: {
      id:
        (t.routeOptionsJson as { destinationId?: string } | null)
          ?.destinationId ?? 'destination',
      name: t.destinationName,
      lat: t.destinationLat,
      lng: t.destinationLng,
    },
    stops: t.viaStopsJson ?? [],
    assigned: progress.assigned,
    completedStopIds: progress.completed,
    createdAt: t.createdAt,
    startedAt: t.startedAt,
    completedAt: t.completedAt,
    cancelledAt: t.cancelledAt,
    updatedAt: t.updatedAt,
    progressSource: 'DRIVER_REPORTED',
    navigationVerified: false,
  };
}
export async function createTrip(
  tx: Prisma.TransactionClient,
  userId: string,
  input: unknown,
  assignment?: { fleetId: string; actorId: string },
) {
  const b = tripPlanSchema.parse(input);
  const auditId =
    'trip-create:' +
    createHash('sha256')
      .update(JSON.stringify([userId, b.createOperationId]))
      .digest('hex');
  const requestHash = createHash('sha256')
    .update(JSON.stringify([b, assignment ?? null]))
    .digest('hex');
  const prior = await tx.adminAuditLog.findUnique({ where: { id: auditId } });
  if (prior) {
    const meta = prior.metadataJson as { requestHash?: string } | null;
    if (
      prior.actorUserId !== userId ||
      meta?.requestHash !== requestHash ||
      !prior.targetId
    )
      deny('CREATE_OPERATION_CONFLICT', 409);
    const original = await tx.trip.findFirst({
      where: { id: prior.targetId, userId },
    });
    if (!original) deny('TRIP_NOT_FOUND', 404);
    return original;
  }
  if (
    !(await tx.user.findFirst({
      where: {
        id: userId,
        role: 'DRIVER',
        disabledAt: null,
        staffAccess: null,
      },
      select: { id: true },
    }))
  )
    deny('DRIVER_NOT_FOUND', 404);
  const truck = b.truckId
    ? await tx.truck.findFirst({ where: { id: b.truckId, userId } })
    : null;
  if (b.truckId && (!truck || truck.revision !== b.expectedTruckRevision))
    deny('TRUCK_PROFILE_CHANGED', 409);
  // No client geometry, mileage or safety assertion is accepted.
  const result = await tx.trip.create({
    data: {
      userId,
      name: b.name,
      status: assignment ? 'ASSIGNED' : 'PLANNED',
      originName: b.origin.name,
      originLat: b.origin.lat,
      originLng: b.origin.lng,
      destinationName: b.destination.name,
      destinationLat: b.destination.lat,
      destinationLng: b.destination.lng,
      viaStopsJson: b.stops,
      routeOptionsJson: {
        originId: b.origin.id,
        destinationId: b.destination.id,
      },
      truckId: truck?.id,
      truckSnapshotJson: truck ? JSON.parse(JSON.stringify(truck)) : undefined,
      dispatchFleetId: assignment?.fleetId,
      dispatchActorId: assignment?.actorId,
    },
  });
  await tx.adminAuditLog.create({
    data: {
      id: auditId,
      actorUserId: userId,
      action: 'TRIP_CREATED',
      targetType: 'TRIP',
      targetId: result.id,
      metadataJson: { requestHash },
    },
  });
  return result;
}
export async function transitionTrip(
  db: PrismaClient,
  userId: string,
  tripId: string,
  input: unknown,
) {
  const b = z
    .object({
      expectedRevision: z.number().int().positive(),
      status: z.enum([
        'PLANNED',
        'STARTED',
        'IN_PROGRESS',
        'COMPLETED',
        'CANCELLED',
      ]),
      completedStopId: z.string().min(1).max(128).optional(),
    })
    .strict()
    .parse(input);
  return db.$transaction(
    async (tx) => {
      const t = await tx.trip.findFirst({ where: { id: tripId, userId } });
      if (!t) deny('TRIP_NOT_FOUND', 404);
      if (t.revision !== b.expectedRevision) deny('TRIP_CHANGED', 409);
      const progress = tripStopProgress(t);
      const completingStop = b.completedStopId !== undefined;
      if (completingStop && (!['STARTED','IN_PROGRESS'].includes(t.status) || b.status !== 'IN_PROGRESS' || progress.ids[progress.completed.length] !== b.completedStopId)) deny('TRIP_STOP_PLAN_INVALID',409);
      if (!tripTransitions[t.status]?.includes(b.status) && !(completingStop && t.status === 'IN_PROGRESS'))
        deny('TRIP_TRANSITION_INVALID', 409);
      if (
        t.dispatchFleetId &&
        b.status !== 'CANCELLED' &&
        !(await tx.operationalFleetDriver.findFirst({
          where: {
            fleetId: t.dispatchFleetId,
            userId,
            active: true,
            fleet: { active: true },
          },
        }))
      )
        deny('DISPATCH_MEMBERSHIP_REQUIRED', 403);
      if (b.status === 'STARTED' || b.status === 'IN_PROGRESS') {
        const truck = t.truckId
          ? await tx.truck.findFirst({ where: { id: t.truckId, userId } })
          : null;
        const snapshot = t.truckSnapshotJson as { revision?: number } | null;
        if (
          !truck ||
          !truck.isDefault ||
          !isVerifiedTruck(truck) ||
          snapshot?.revision !== truck.revision
        )
          deny('VERIFIED_TRUCK_REQUIRED', 409);
      }
      const now = new Date();
      const changed = await tx.trip.updateMany({
        where: {
          id: tripId,
          userId,
          revision: b.expectedRevision,
          status: t.status,
        },
        data: {
          status: b.status,
          revision: { increment: 1 },
          ...(b.status === 'STARTED' ? { startedAt: now } : {}),
          ...(b.status === 'COMPLETED' ? { completedAt: now } : {}),
          ...(b.status === 'CANCELLED' ? { cancelledAt: now } : {}),
          ...(completingStop ? {routeOptionsJson: JSON.parse(JSON.stringify({...progress.options,completedStopIds:[...progress.completed,b.completedStopId]}))} : {}),
        },
      });
      if (changed.count !== 1) deny('TRIP_CHANGED', 409);
      if (completingStop) await tx.adminAuditLog.create({data:{actorUserId:userId,action:'TRIP_STOP_COMPLETED',targetType:'TRIP',targetId:tripId,metadataJson:{revision:b.expectedRevision+1,completedStopId:b.completedStopId!,source:'DRIVER_REPORTED'}}});
      return tx.trip.findUniqueOrThrow({ where: { id: tripId } });
    },
    { isolationLevel: 'Serializable' },
  );
}
export const tripStatusRouter = Router();
tripStatusRouter.use(requireAuth);
export async function selectTripTruck(
  db: PrismaClient,
  userId: string,
  tripId: string,
  input: unknown,
) {
  const b = z
    .object({
      expectedRevision: z.number().int().positive(),
      truckId: z.string().min(1).max(128),
      expectedTruckRevision: z.number().int().positive(),
    })
    .strict()
    .parse(input);
  return db.$transaction(
    async (tx) => {
      const trip = await tx.trip.findFirst({ where: { id: tripId, userId } });
      if (!trip) deny('TRIP_NOT_FOUND', 404);
      if (trip.revision !== b.expectedRevision || trip.status !== 'PLANNED')
        deny('TRIP_CHANGED', 409);
      const truck = await tx.truck.findFirst({
        where: { id: b.truckId, userId },
      });
      if (
        !truck ||
        truck.revision !== b.expectedTruckRevision ||
        !truck.isDefault ||
        !isVerifiedTruck(truck)
      )
        deny('VERIFIED_TRUCK_REQUIRED', 409);
      return tx.trip.update({
        where: { id: tripId },
        data: {
          truckId: truck.id,
          truckSnapshotJson: JSON.parse(JSON.stringify(truck)),
          revision: { increment: 1 },
          truckSafe: false,
        },
      });
    },
    { isolationLevel: 'Serializable' },
  );
}
const wrap =
  (fn: (req: any, res: any) => Promise<unknown>) =>
  (req: any, res: any, next: any) =>
    void fn(req, res).catch(next);
tripStatusRouter.get(
  '/',
  wrap(async (req, res) =>
    res.json({
      items: (
        await prisma.trip.findMany({
          where: { userId: req.user.userId },
          orderBy: [{ updatedAt: 'desc' }, { id: 'asc' }],
          take: 100,
        })
      ).map(publicTrip),
    }),
  ),
);
tripStatusRouter.post(
  '/',
  wrap(async (req, res) =>
    res
      .status(201)
      .json(
        publicTrip(
          await prisma.$transaction(
            (tx) => createTrip(tx, req.user.userId, req.body),
            { isolationLevel: 'Serializable' },
          ),
        ),
      ),
  ),
);
tripStatusRouter.patch(
  '/:tripId/status',
  wrap(async (req, res) =>
    res.json(
      publicTrip(
        await transitionTrip(
          prisma,
          req.user.userId,
          String(req.params.tripId),
          req.body,
        ),
      ),
    ),
  ),
);
tripStatusRouter.patch(
  '/:tripId/truck',
  wrap(async (req, res) =>
    res.json(
      publicTrip(
        await selectTripTruck(
          prisma,
          req.user.userId,
          String(req.params.tripId),
          req.body,
        ),
      ),
    ),
  ),
);
