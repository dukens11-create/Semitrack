import { z } from 'zod';
import { guidancePresentation, guidanceSampleSchema } from '../../services/copilot/CoPilotGuidance';

export const engineMapSnapshotSchema = guidanceSampleSchema.extend({
  routeRevision: z.number().int().nonnegative(),
  routeCoordinates: z.array(z.tuple([
    z.number().finite().min(-180).max(180),
    z.number().finite().min(-90).max(90),
  ])).max(20000).optional(),
});
export type EngineMapSnapshot = z.infer<typeof engineMapSnapshotSchema>;

export function engineMapProof(sample: EngineMapSnapshot | undefined, now: number) {
  const telemetry = guidancePresentation(sample, now);
  const current = telemetry.fresh && !!sample && now - sample.observedAt <= 5000;
  const ready = current && sample.hasDestination === true && sample.routeStatus === 'ready';
  return {
    coordinates: ready && (sample.routeCoordinates?.length ?? 0) >= 2 ? sample.routeCoordinates : undefined,
    position: current && sample.latitude !== undefined && sample.longitude !== undefined
      ? [sample.longitude, sample.latitude] as [number, number] : undefined,
    heading: current ? sample.heading : undefined,
    instruction: ready ? sample.instruction : undefined,
    nextRoad: ready ? sample.nextRoad : undefined,
    turnDistance: ready ? sample.turnDistance : undefined,
    remainingMeters: ready ? telemetry.remainingMeters : undefined,
    etaAt: ready ? telemetry.etaAt : undefined,
    speedMph: current ? telemetry.speedMph : undefined,
    status: !sample ? 'Waiting for engine data' : !current ? 'Waiting for fresh GPS' :
      sample.routeStatus === 'calculating' ? 'Recalculating truck route…' :
      sample.routeStatus === 'arrived' ? 'Destination reached' :
      ready ? 'Engine route · next 25 miles' : 'No ready engine route',
  };
}
