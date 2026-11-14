import { z } from 'zod';
import type { CoPilotHost } from './CoPilotHost';

export const fleetTruckProfileSchema = z.object({
  ticket: z.string(),
  name: z.string().trim().min(1),
  source: z.literal('FLEET_PORTAL'),
  vehicleType: z
    .enum(['TRUCK_LIGHT_DUTY', 'TRUCK_MEDIUM_DUTY', 'TRUCK_HEAVY_DUTY'])
    .optional(),
  trailerCount: z.number().int().nonnegative().optional(),
  maximumStraightLengthInches: z.number().int().nonnegative().optional(),
  bumperToBumperLengthInches: z.number().int().nonnegative().optional(),
  heightInches: z.number().int().positive(),
  widthInches: z.number().int().positive(),
  lengthInches: z.number().int().positive(),
  weightLbs: z.number().int().positive(),
  weightPerAxleLbs: z.number().int().positive(),
  active: z.boolean(),
  truckRestrictionsVerified: z.literal(false),
});
export type FleetTruckProfile = z.infer<typeof fleetTruckProfileSchema>;
export async function readFleetTruckProfiles(host: CoPilotHost) {
  if (!host.readFleetTruckProfiles) throw new Error('FLEET_BRIDGE_UNAVAILABLE');
  return z
    .array(fleetTruckProfileSchema.extend({ ticket: z.string().min(1) }))
    .parse(await host.readFleetTruckProfiles());
}
export async function selectFleetTruckProfile(
  host: CoPilotHost,
  profile: FleetTruckProfile,
) {
  if (!host.selectFleetTruckProfile || !profile.ticket)
    throw new Error('FLEET_BRIDGE_UNAVAILABLE');
  const active = fleetTruckProfileSchema.parse(
    await host.selectFleetTruckProfile(profile.ticket),
  );
  if (
    !active.active ||
    active.name !== profile.name ||
    active.vehicleType !== profile.vehicleType ||
    active.trailerCount !== profile.trailerCount ||
    active.maximumStraightLengthInches !==
      profile.maximumStraightLengthInches ||
    active.bumperToBumperLengthInches !== profile.bumperToBumperLengthInches ||
    active.heightInches !== profile.heightInches ||
    active.widthInches !== profile.widthInches ||
    active.lengthInches !== profile.lengthInches ||
    active.weightLbs !== profile.weightLbs ||
    active.weightPerAxleLbs !== profile.weightPerAxleLbs
  )
    throw new Error('FLEET_SELECTION_UNCONFIRMED');
  return active;
}
