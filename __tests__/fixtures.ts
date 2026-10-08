import {
  truckSchema,
  parseTruckRoute,
  type Tokens,
} from '../src/models/contracts';
import type { TokenVault } from '../src/services/storage/TokenVault';
export const truck = truckSchema.parse({
  id: 'truck-test',
  revision: 1, verifiedRevision: 1, verifiedAt: '2026-09-12T12:00:00Z', verificationState: 'VERIFIED',
  name: 'Test truck',
  isDefault: true,
  heightFt: 13.5,
  widthFt: 8.5,
  lengthFt: 72,
  weightLbs: 80000,
  currentWeightLbs: 76000,
  weightPerAxleLbs: 17000,
  axleCount: 5,
  tractorType: 'sleeper',
  trailerType: 'dry van',
  trailerCount: 1,
  unitNumber: 'TEST',
  trailerNumber: 'TEST',
  hazmatEnabled: true,
  hazardousGoods: ['flammable'],
  avoidTolls: true,
  avoidFerries: true,
  avoidHighways: false,
  avoidResidential: true,
  avoidDirtRoads: true,
});
export const routeRaw = {
  provider: 'Trimble',
  truckSafe: true,
  navigationAllowed: true,
  selectedRouteId: 'test-route',
  calculatedAt: '2026-09-11T12:00:00Z',
  trafficAware: true,
  distanceMiles: 12,
  durationSeconds: 1200,
  etaMinutes: 20,
  routeGeometry: [
    [-100, 40],
    [-100.01, 40],
    [-100, 40],
    [-100.02, 40],
  ],
  turnByTurn: [
    {
      step: 1,
      instruction: 'Depart',
      distanceMiles: 0,
      offset: 0,
      geometryMatchDistanceMeters: 0,
    },
    {
      step: 2,
      instruction: 'Turn',
      distanceMiles: 10,
      offset: 3,
      geometryMatchDistanceMeters: 200,
    },
  ],
  alerts: [],
  legs: [],
  alternatives: [],
};
export const route = () => parseTruckRoute(routeRaw);
export const user = {
  id: 'user-test',
  email: 'driver@example.test',
  fullName: 'Test Driver',
  role: 'DRIVER',
  plan: 'FREE',
  phone: null,
};
export const tokens = {
  accessToken: 'test-access',
  refreshToken: 'test-refresh',
};
export class MemoryVault implements TokenVault {
  constructor(public value: Tokens | null = null) {}
  async read() {
    return this.value;
  }
  async write(next: Tokens) {
    this.value = next;
  }
  async clear() {
    this.value = null;
  }
}
export function reply(data: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => (data === undefined ? '' : JSON.stringify(data)),
  } as Response;
}
export function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
