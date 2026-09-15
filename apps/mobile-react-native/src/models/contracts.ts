import { DriverError } from '../errors/driverErrors';
import { z } from 'zod';

export const coordinateSchema = z.object({
  lat: z.number().finite().min(-90).max(90),
  lng: z.number().finite().min(-180).max(180),
});
export type Coordinate = z.infer<typeof coordinateSchema>;
export const hazardousGoods = [
  'explosive',
  'gas',
  'flammable',
  'combustible',
  'organic',
  'poison',
  'radioactive',
  'corrosive',
  'poisonousInhalation',
  'harmfulToWater',
  'other',
] as const;
export const truckSchema = z
  .object({
    id: z.string().default(''),
    revision: z.number().int().positive().optional(),
    verifiedRevision: z.number().int().positive().nullable().optional(),
    verifiedAt: z.string().datetime({ offset: true }).nullable().optional(),
    verificationState: z.enum(['DRIVER_VERIFICATION_REQUIRED', 'ADMIN_UPDATED', 'VERIFIED']).optional(),
    name: z.string().trim().min(1).max(80),
    isDefault: z.boolean(),
    heightFt: z.number().finite().min(4).max(20),
    widthFt: z.number().finite().min(4).max(20),
    lengthFt: z.number().finite().min(8).max(150),
    weightLbs: z.number().int().min(1000).max(300000),
    currentWeightLbs: z.number().int().min(1000).max(300000).nullable(),
    weightPerAxleLbs: z.number().int().min(500).max(100000).nullable(),
    axleCount: z.number().int().min(2).max(20),
    tractorType: z.string().nullable(),
    trailerType: z.string().nullable(),
    trailerCount: z.number().int().min(0).max(4),
    unitNumber: z.string().nullable().optional(),
    trailerNumber: z.string().nullable().optional(),
    hazmatEnabled: z.boolean(),
    hazardousGoods: z.array(z.enum(hazardousGoods)),
    avoidTolls: z.boolean(),
    avoidFerries: z.boolean(),
    avoidHighways: z.boolean(),
    avoidResidential: z.boolean(),
    avoidDirtRoads: z.boolean(),
  })
  .superRefine((truck, context) => {
    if (
      truck.currentWeightLbs !== null &&
      truck.currentWeightLbs > truck.weightLbs
    ) {
      context.addIssue({
        code: 'custom',
        path: ['currentWeightLbs'],
        message: 'Current weight cannot exceed gross weight.',
      });
    }
    if (truck.hazmatEnabled !== truck.hazardousGoods.length > 0) {
      context.addIssue({
        code: 'custom',
        path: ['hazardousGoods'],
        message: 'Hazmat enablement and selected classes must agree.',
      });
    }
  });
export type TruckProfile = z.infer<typeof truckSchema>;
export function isServerVerifiedTruck(profile: TruckProfile) {
  return profile.isDefault && !!profile.revision && profile.verifiedRevision === profile.revision && profile.verificationState === 'VERIFIED' && !!profile.verifiedAt;
}
export function serializeTruck(profile: TruckProfile, routing = false) {
  const { id: _id, revision: _revision, verifiedRevision: _verifiedRevision, verifiedAt: _verifiedAt, verificationState: _verificationState, ...body } = truckSchema.parse(profile);
  if (!routing) {
    return body;
  }
  const {
    name: _name,
    isDefault: _default,
    tractorType: _tractor,
    unitNumber: _unit,
    trailerNumber: _trailer,
    ...routeTruck
  } = body;
  return routeTruck;
}
export const userSchema = z.object({
  id: z.string().min(1),
  email: z.string().email(),
  fullName: z.string(),
  role: z.string(),
  plan: z.string(),
  phone: z.string().nullable().optional(),
});
export type User = z.infer<typeof userSchema>;
export const tokensSchema = z.object({
  accessToken: z.string().min(1),
  refreshToken: z.string().min(1),
});
export type Tokens = z.infer<typeof tokensSchema>;
export const maneuverSchema = z.object({
  step: z.number().int().positive(),
  instruction: z.string().min(1),
  distanceMiles: z.number().finite().nonnegative(),
  durationSeconds: z.number().finite().nonnegative().optional(),
  offset: z.number().int().nonnegative(),
  coordinate: coordinateSchema.optional(),
  geometryMatchDistanceMeters: z.number().finite().min(0).max(250),
  action: z.string().optional(),
  direction: z.string().optional(),
  roadName: z.string().optional(),
  currentRoadName: z.string().optional(),
  nextRoadName: z.string().optional(),
  exitNumber: z.string().optional(),
  lanes: z
    .array(z.object({ directions: z.array(z.string()), active: z.boolean() }))
    .optional(),
});
const routePosition = z.tuple([z.number().finite().min(-180).max(180),z.number().finite().min(-90).max(90)]);
const legSchema = z.object({distanceMiles:z.number().finite().nonnegative(),durationSeconds:z.number().int().nonnegative(),geometry:z.array(routePosition).max(200000),maneuvers:z.array(maneuverSchema).min(1).max(50000)});
const alternativeSchema = z.object({id:z.string().min(1),distanceMiles:z.number().finite().nonnegative(),etaMinutes:z.number().finite().nonnegative(),durationSeconds:z.number().int().positive(),routeGeometry:z.array(routePosition).min(2).max(200000),legs:z.array(legSchema).max(22),turnByTurn:z.array(maneuverSchema).max(50000),notices:z.array(z.object({code:z.string().min(1),title:z.string().optional(),severity:z.string().optional()})).max(100)});
export const routeSchema = z.object({
  provider: z.literal('Trimble'),
  truckSafe: z.literal(true),
  navigationAllowed: z.literal(true),
  selectedRouteId: z.string().min(1),
  calculatedAt: z.string().datetime({ offset: true }),
  trafficAware: z.boolean(),
  distanceMiles: z.number().finite().nonnegative(),
  durationSeconds: z.number().int().positive(),
  etaMinutes: z.number().finite().nonnegative(),
  routeGeometry: z
    .array(
      z.tuple([
        z.number().finite().min(-180).max(180),
        z.number().finite().min(-90).max(90),
      ]),
    )
    .min(2),
  turnByTurn: z.array(maneuverSchema).min(1).max(50000),
  alerts: z.array(z.string()),
  legs: z.array(legSchema).max(22).default([]),
  alternatives: z.array(alternativeSchema).max(5).default([]),
});
export type TruckRoute = z.infer<typeof routeSchema>;
export function parseTruckRoute(value: unknown): TruckRoute {
  const parsed = routeSchema.safeParse(value);
  if (!parsed.success) throw new DriverError('ROUTE_CONTRACT_INVALID');
  const route = parsed.data;
  if (route.etaMinutes !== Math.ceil(route.durationSeconds / 60)) throw new DriverError('ROUTE_CONTRACT_INVALID');
  let previous = -1;
  for (const maneuver of route.turnByTurn) {
    if (
      maneuver.offset < previous ||
      maneuver.offset >= route.routeGeometry.length
    ) {
      throw new DriverError('ROUTE_CONTRACT_INVALID');
    }
    previous = maneuver.offset;
  }
  for (const alternative of route.alternatives) {
    if (alternative.etaMinutes !== Math.ceil(alternative.durationSeconds / 60)) throw new DriverError('ROUTE_CONTRACT_INVALID');
    let offset=-1;
    for(const maneuver of alternative.turnByTurn){if(maneuver.offset<offset||maneuver.offset>=alternative.routeGeometry.length)throw new DriverError('ROUTE_CONTRACT_INVALID');offset=maneuver.offset;}
    if(!alternative.turnByTurn.length&&!alternative.notices.some(n=>n.code==='TRIMBLE_ALTERNATE_PREVIEW'))throw new DriverError('ROUTE_CONTRACT_INVALID');
  }
  if(route.legs.length){
    const legManeuvers=route.legs.flatMap(leg=>leg.maneuvers);
    if(JSON.stringify(legManeuvers)!==JSON.stringify(route.turnByTurn))throw new DriverError('ROUTE_CONTRACT_INVALID');
  }
  // Keep geometry order and repeated vertices: loops/U-turns are real route topology.
  return route;
}
