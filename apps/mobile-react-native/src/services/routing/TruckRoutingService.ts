import {
  beginRouteDiagnostic,
  emitRouteDiagnostic,
  recordRouteFailure,
  type RouteDiagnosticStage,
} from '../../features/routing/routeTelemetry';
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
    diagnosticAttempt?: number,
  ) {
    const attempt =
      diagnosticAttempt ??
      beginRouteDiagnostic(
        truck,
        Array.isArray(plan?.stops) ? plan.stops.length + 2 : -1,
      );
    let stage: RouteDiagnosticStage = 'REQUEST_VALIDATION';
    try {
      if (!truck.id || !isServerVerifiedTruck(truck))
        throw new TruckProfileError();
      validateStopPlan(plan);
      if (
        !Number.isInteger(alternatives) ||
        alternatives < 0 ||
        alternatives > 3
      )
        throw new Error('Invalid alternative count');
      emitRouteDiagnostic({ attempt, stage, result: 'PASS' });
      stage = 'REQUEST_CONSTRUCTION';
      const body = {
        origin: coordinateSchema.parse(origin),
        destination: coordinateSchema.parse(plan.destination),
        viaStops: plan.stops.map(stop => coordinateSchema.parse(stop)),
        truck: serializeTruck(truck, true),
        truckProfileId: truck.id,
        truckRevision: truck.revision,
        routeMode: 'fastest',
        alternatives,
      };
      emitRouteDiagnostic({ attempt, stage, result: 'PASS' });
      stage = 'BACKEND_ERROR';
      // Preserve the existing single complete-plan request and authentication policy.
      const response = await this.api.request(
        'POST',
        '/routing/truck-route',
        body,
        signal,
        true,
        status => {
          emitRouteDiagnostic({
            attempt,
            stage: 'BACKEND_HTTP',
            source: 'BACKEND_RESPONSE',
            backendHttpStatus: status,
            responseReceived: true,
          });
        },
      );
      stage = 'RESPONSE_PARSE';
      const route = parseTruckRoute(response, [
        origin,
        ...plan.stops,
        plan.destination,
      ]);
      emitRouteDiagnostic({ attempt, stage, result: 'PASS' });
      emitRouteDiagnostic({ attempt, stage: 'DECISION', result: 'ACCEPTED' });
      return route;
    } catch (error) {
      recordRouteFailure(attempt, stage, error);
      throw error;
    }
  }
}
