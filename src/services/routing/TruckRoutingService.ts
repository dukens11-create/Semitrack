import { TruckProfileError } from '../../errors/driverErrors';
import { ApiClient } from '../api/ApiClient';
import {
  coordinateSchema,
  isServerVerifiedTruck,
  parseTruckRoute,
  serializeTruck,
  type Coordinate,
  type TruckProfile,
} from '../../models/contracts';
import { validateStopPlan, type StopPlan } from '../../features/stops/StopPlan';
export class TruckRoutingService {
  constructor(private api: ApiClient) {}
  async calculate(
    origin: Coordinate,
    plan: StopPlan,
    truck: TruckProfile,
    signal?: AbortSignal,
    alternatives = 0,
  ) {
    if (!truck.id || !isServerVerifiedTruck(truck)) throw new TruckProfileError();
    validateStopPlan(plan);
    if (!Number.isInteger(alternatives) || alternatives < 0 || alternatives > 3) throw new Error('Invalid alternative count');
    // Exactly one request for the entire authoritative plan. Never skip a failed leg.
    return parseTruckRoute(
      await this.api.request(
        'POST',
        '/routing/truck-route',
        {
          origin: coordinateSchema.parse(origin),
          destination: coordinateSchema.parse(plan.destination),
          viaStops: plan.stops.map(stop => coordinateSchema.parse(stop)),
          truck: serializeTruck(truck, true),
          truckProfileId: truck.id,
          truckRevision: truck.revision,
          routeMode: 'fastest',
          alternatives,
        },
        signal,
      ),
      [origin, ...plan.stops, plan.destination],
    );
  }
}
