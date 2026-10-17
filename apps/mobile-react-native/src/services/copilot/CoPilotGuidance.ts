import { z } from 'zod';

/** Native samples only. Does not infer navigation started from a route or GPS fix. */
export const guidanceSampleSchema = z.object({
  sequence: z.number().int().nonnegative(),
  observedAt: z.number().finite().positive(),
  available: z.boolean(),
  gpsFresh: z.boolean().optional(),
  fixAt: z.number().finite().nonnegative().optional(),
  latitude: z.number().finite().min(-90).max(90).optional(),
  longitude: z.number().finite().min(-180).max(180).optional(),
  speedMph: z.number().finite().nonnegative().optional(),
  heading: z.number().finite().min(0).lt(360).optional(),
  roadSpeedLimitMph: z.number().finite().positive().optional(),
  truckSpeedLimitMph: z.number().finite().positive().optional(),
  hasDestination: z.boolean().optional(),
  routeStatus: z
    .enum(['unknown', 'none', 'calculating', 'ready', 'failed', 'arrived'])
    .optional(),
  etaAt: z.number().finite().positive().optional(),
  remainingMeters: z.number().finite().nonnegative().optional(),
  instruction: z.string().nullable().optional(),
  nextRoad: z.string().nullable().optional(),
  turnDistance: z.string().nullable().optional(),
});
export type CoPilotGuidanceSample = z.infer<typeof guidanceSampleSchema>;
export function guidancePresentation(
  sample: CoPilotGuidanceSample | undefined,
  now: number,
) {
  const fresh =
    !!sample?.available &&
    sample.gpsFresh === true &&
    sample.fixAt !== undefined &&
    now - sample.fixAt >= -5000 &&
    now - sample.fixAt <= 15000 &&
    now - sample.observedAt >= -5000 &&
    now - sample.observedAt <= 15000;
  const heading = fresh ? sample?.heading : undefined;
  const readyRoute =
    fresh && sample?.hasDestination && sample.routeStatus === 'ready';
  return {
    fresh,
    speedMph: fresh ? sample?.speedMph : undefined,
    heading:
      heading === undefined
        ? undefined
        : ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'][
            Math.round(heading / 45) % 8
          ],
    // Do not use the passenger road limit as an unverified truck limit.
    truckSpeedLimitMph: fresh ? sample?.truckSpeedLimitMph : undefined,
    roadSpeedLimitMph: fresh ? sample?.roadSpeedLimitMph : undefined,
    etaAt:
      readyRoute && sample.etaAt !== undefined && sample.etaAt >= now
        ? sample.etaAt
        : undefined,
    remainingMeters: readyRoute ? sample.remainingMeters : undefined,
    instruction: readyRoute ? sample.instruction : undefined,
  };
}
