import { z } from 'zod';
import { coordinateSchema, type Coordinate } from '../../models/contracts';
import { validateStopPlan, type StopPlan } from '../../features/stops/StopPlan';

export const engineTripProfileSchema = z.object({
  ticket: z.string().min(1),
  name: z.string().min(1),
  heightInches: z.number().int().positive(),
  widthInches: z.number().int().positive(),
  lengthInches: z.number().int().positive(),
  weightLbs: z.number().int().positive(),
  weightPerAxleLbs: z.number().int().positive(),
  trailerCount: z.literal(1),
  maximumStraightLengthInches: z.literal(636),
  bumperToBumperLengthInches: z.number().int().min(636),
});

/** CPIK consumes the first location as origin when starting a multi-stop trip. */
export function engineTripLocations(origin: Coordinate, plan: StopPlan) {
  coordinateSchema.parse(origin);
  validateStopPlan(plan);
  return [
    { ...origin, name: 'Current location' },
    ...plan.stops.map(({ lat, lng, name }) => ({ lat, lng, name })),
    {
      lat: plan.destination.lat,
      lng: plan.destination.lng,
      name: plan.destination.name,
    },
  ];
}
export function engineTripProfileSummary(
  profile: z.infer<typeof engineTripProfileSchema>,
) {
  const feet = (inches: number) =>
    `${Math.floor(inches / 12)} ft ${inches % 12} in`;
  return `${profile.name}\nHeight ${feet(profile.heightInches)} · Width ${
    profile.widthInches
  } in\nTrailer length ${feet(
    profile.lengthInches,
  )}\nMaximum straight length ${feet(profile.maximumStraightLengthInches)}\nBumper-to-bumper length ${feet(profile.bumperToBumperLengthInches)}\nTrailers ${profile.trailerCount} · Routing weight ${profile.weightLbs.toLocaleString()} lb\nMaximum axle-group routing weight ${profile.weightPerAxleLbs.toLocaleString()} lb\nThese are engine routing values, not measured load weights.`;
}
