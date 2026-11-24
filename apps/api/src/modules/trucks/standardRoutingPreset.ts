import { truckSchema, routingTruckSchema } from './truck.schemas.js';
import { RoutingProviderError } from '../../services/providers/routeProvider.js';

// Request-scoped driver acceptance. Never write a routing preset into measured data.
export function applyStandardRoutingPreset(saved: unknown, accepted?: string) {
  const routing = routingTruckSchema.parse(saved);
  if (!accepted) return routing;
  const t = truckSchema.parse(saved);
  const eligible = accepted === 'STANDARD_SINGLE_53_AXLE_34000' &&
    t.weightPerAxleLbs == null && t.lengthFt === 53 && t.trailerCount === 1 && t.axleCount === 5 &&
    ['dry van', 'reefer'].includes((t.trailerType ?? '').toLowerCase()) &&
    ['sleeper', 'sleeper cab', 'day cab'].includes((t.tractorType ?? '').toLowerCase()) &&
    t.heightFt >= 5 && t.heightFt <= 13.5 && t.widthFt >= 5 && t.widthFt <= 8.5 &&
    t.weightLbs >= 1500 && t.weightLbs <= 80000 && !t.hazmatEnabled && !t.hazardousGoods.length &&
    !t.avoidFerries && !t.avoidHighways && !t.avoidResidential && !t.avoidDirtRoads;
  if (!eligible) throw new RoutingProviderError('Trimble', 'STANDARD_ROUTING_PRESET_UNSUPPORTED',
    'This truck cannot use the standard axle-group routing preset. Review its actual measurements and restrictions.', 422);
  return { ...routing, weightPerAxleLbs: 34000 };
}
