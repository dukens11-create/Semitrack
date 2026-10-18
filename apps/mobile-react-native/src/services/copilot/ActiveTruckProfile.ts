import { NativeModules, Platform } from 'react-native';
import { z } from 'zod';
const dimension = z.number().int().positive();
const profileSchema = z.object({
  name: z.string().trim().min(1),
  vehicleType: z.number().int().nonnegative(),
  dims: z.object({
    height: dimension,
    width: dimension,
    length: dimension,
    totalWeight: dimension,
    weightPerAxle: z.number().int().nonnegative(),
  }),
  routingType: z.number().int().optional(),
  hazmatType: z.number().int().optional(),
  tollRoads: z.number().int().optional(),
  displayTruckRestriction: z.number().int().optional(),
  ferriesDiscouraged: z.boolean().optional(),
  internationalBordersOpen: z.boolean().optional(),
  governor: z.number().nonnegative().optional(),
  elevation: z.number().nonnegative().optional(),
});
export type ActiveTruckProfile = z.infer<typeof profileSchema>;
export async function readActiveTruckProfile(): Promise<ActiveTruckProfile> {
  if (
    Platform.OS !== 'android' ||
    !NativeModules.RouteMgr?.getActiveVehicleRoutingProfile
  )
    throw new Error('Truck engine profile unavailable');
  const profile = profileSchema.parse(
    await NativeModules.RouteMgr.getActiveVehicleRoutingProfile(),
  );
  const heavy = NativeModules.VehicleType?.TRUCK_HEAVY_DUTY;
  if (!Number.isInteger(heavy) || profile.vehicleType !== heavy)
    throw new Error('Select a Heavy-Duty Truck profile in engine settings.');
  return profile;
}
export function profileEnumLabel(
  module: string,
  value: number | undefined,
): string {
  if (value === undefined) return 'Not supplied';
  const constants = NativeModules[module];
  const entry =
    constants && Object.entries(constants).find(([, code]) => code === value);
  return entry ? entry[0].replace(/_/g, ' ').toLowerCase() : 'Unknown setting';
}
