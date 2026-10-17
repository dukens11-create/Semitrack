import { Router } from 'express';
import type { PrismaClient } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '../../lib/prisma.js';
import { requireAuth } from '../../middleware/auth.js';
import {
  operationalActor,
  requirePermission,
  requireDriver,
  fleetScope,
  deny,
} from '../admin/operationalPolicy.js';
import {
  createTrip,
  publicTrip,
  tripPlanSchema,
} from '../trips/trip-status.routes.js';
export async function assignTripToDriver(
  db: PrismaClient,
  actorId: string,
  input: unknown,
) {
  const b = z
    .object({
      fleetId: z.string().min(1).max(128),
      driverId: z.string().min(1).max(128),
      plan: tripPlanSchema,
      reason: z.string().trim().min(5).max(500),
    })
    .strict()
    .refine(b => b.plan.stops.length <= 19 && ![...b.plan.stops,b.plan.destination].some(s => s.id === b.plan.origin.id), 'The pickup and ordered stops must fit the truck route and have distinct identities.')
    .parse(input);
  return db.$transaction(
    async (tx) => {
      const user = await tx.user.findUnique({ where: { id: actorId } });
      if (!user || user.disabledAt) deny();
      const actor = await operationalActor(tx, {
        userId: actorId,
        role: user.role,
      });
      requirePermission(actor, 'dispatch.manage');
      if (
        !(await tx.operationalFleet.findFirst({
          where: { AND: [{ id: b.fleetId, active: true }, fleetScope(actor)] },
        }))
      )
        deny('FLEET_NOT_FOUND', 404);
      await requireDriver(tx, actor, b.driverId);
      if (
        !(await tx.operationalFleetDriver.findFirst({
          where: { fleetId: b.fleetId, userId: b.driverId, active: true },
        }))
      )
        deny('DISPATCH_MEMBERSHIP_REQUIRED', 403);
      const trip = await createTrip(tx, b.driverId, b.plan, {
        fleetId: b.fleetId,
        actorId,
      });
      await tx.adminAuditLog.upsert({
        where: { id: 'trip-assigned:' + trip.id },
        create: {
          id: 'trip-assigned:' + trip.id,
          actorUserId: actorId,
          action: 'TRIP_ASSIGNED',
          targetType: 'TRIP',
          targetId: trip.id,
          metadataJson: {
            fleetId: b.fleetId,
            result: 'ASSIGNED',
            revision: trip.revision,
          },
        },
        update: {},
      });
      return trip;
    },
    { isolationLevel: 'Serializable' },
  );
}
export const dispatchRouter = Router();
dispatchRouter.use(requireAuth);
const wrap =
  (fn: (req: any, res: any) => Promise<unknown>) =>
  (req: any, res: any, next: any) =>
    void fn(req, res).catch(next);
dispatchRouter.post(
  '/assign',
  wrap(async (req, res) =>
    res
      .status(201)
      .json(
        publicTrip(await assignTripToDriver(prisma, req.user.userId, req.body)),
      ),
  ),
);
dispatchRouter.get(
  '/',
  wrap(async (req, res) => {
    const actor = await operationalActor(prisma, req.user);
    requirePermission(actor, 'dispatch.read');
    const fleets = await prisma.operationalFleet.findMany({
      where: { AND: [{ active: true }, fleetScope(actor)] },
      select: { id: true },
    });
    res.json({
      items: (
        await prisma.trip.findMany({
          where: { dispatchFleetId: { in: fleets.map((f) => f.id) } },
          orderBy: { updatedAt: 'desc' },
          take: 100,
        })
      ).map(publicTrip),
    });
  }),
);
