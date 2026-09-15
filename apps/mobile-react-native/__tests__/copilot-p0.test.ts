import {
  CopilotP0Error,
  parseCopilotConfiguration,
} from '../src/services/copilot/CopilotConfiguration';
import {
  requireCopilotProfilePrerequisites,
  type CopilotEvidence,
} from '../src/services/copilot/CopilotPrerequisites';
import {
  assessCopilotTruckProfile,
  copilotTruckFieldMatrix,
  feetToConservativeInches,
  requireRepresentableCopilotTruckProfile,
} from '../src/services/copilot/CopilotTruckProfile';
import { NativeGuidanceAdapter } from '../src/native/navigation/NativeGuidanceAdapter';
import { truck } from './fixtures';

jest.mock('../src/native/navigation/NativeSemiTraxPlatform', () => ({
  __esModule: true,
  default: null,
}));

// Unit-test inputs only: no SDK runtime, credentials, routes or callback stream.
const config = {
  sdkVersion: '10.28.2.497',
  platform: 'android',
  environment: 'development',
  licensingMode: 'ams-company',
  credentialRef: 'unit-test-reference',
  mapRegionConstant: 'TEST_REGION',
  mapVersion: { year: 2026, quarter: 1, version: 'test-version' },
};
const evidence: CopilotEvidence = {
  nativeBuildVerified: true,
  modulePresent: true,
  startup: 'started',
  credentialProvisioned: true,
  licensingReady: true,
  fullNavigationLicensed: true,
  heavyTruckLicensed: true,
  licensedMapRegions: ['TEST_REGION'],
  installedMaps: [
    {
      regionConstant: 'TEST_REGION',
      year: 2026,
      quarter: 1,
      version: 'test-version',
      installation: 'installed',
    },
  ],
  gpsPermission: 'precise',
};
function failure(action: () => unknown): CopilotP0Error {
  try {
    action();
  } catch (error) {
    expect(error).toBeInstanceOf(CopilotP0Error);
    return error as CopilotP0Error;
  }
  throw new Error('Expected a blocked prerequisite');
}

test.each([
  null,
  {},
  { ...config, credentialRef: '' },
  { ...config, sdkVersion: '11' },
  { ...config, platform: 'web' },
  { ...config, environment: 'test' },
  { ...config, mapVersion: { year: 0, quarter: 0, version: '' } },
])('configuration fails closed: %j', value => {
  expect(failure(() => parseCopilotConfiguration(value)).code).toBe(
    'CONFIGURATION_INVALID',
  );
});
test('credential values are rejected and never included in validation diagnostics', () => {
  const error = failure(() =>
    parseCopilotConfiguration({ ...config, productKey: 'unit-secret-canary' }),
  );
  expect(JSON.stringify(error) + error.message).not.toContain(
    'unit-secret-canary',
  );
  expect(parseCopilotConfiguration(config).credentialRef).toBe(
    'unit-test-reference',
  );
});
test.each(['not-started', 'starting', 'failed', 'shutdown'] as const)(
  'startup %s cannot pass the gate',
  startup => {
    expect(
      failure(() =>
        requireCopilotProfilePrerequisites(config, { ...evidence, startup }),
      ).code,
    ).toMatch(/^STARTUP_/);
  },
);
test.each([
  'nativeBuildVerified',
  'modulePresent',
  'credentialProvisioned',
  'licensingReady',
  'fullNavigationLicensed',
  'heavyTruckLicensed',
] as const)('missing %s cannot pass the gate', field => {
  expect(() =>
    requireCopilotProfilePrerequisites(config, { ...evidence, [field]: false }),
  ).toThrow(CopilotP0Error);
});
test('startup and ordinary navigation licensing never substitute for a truck license', () => {
  expect(
    failure(() =>
      requireCopilotProfilePrerequisites(config, {
        ...evidence,
        heavyTruckLicensed: false,
      }),
    ).code,
  ).toBe('TRUCK_NAVIGATION_UNLICENSED');
});
test('a installed map does not establish regional entitlement', () => {
  expect(
    failure(() =>
      requireCopilotProfilePrerequisites(config, {
        ...evidence,
        licensedMapRegions: [],
      }),
    ).code,
  ).toBe('MAP_REGION_UNLICENSED');
});
test.each(['downloading', 'failed'] as const)(
  'map %s is unavailable',
  installation => {
    expect(
      failure(() =>
        requireCopilotProfilePrerequisites(config, {
          ...evidence,
          installedMaps: evidence.installedMaps.map(map => ({
            ...map,
            installation,
          })),
        }),
      ).code,
    ).toBe('REQUIRED_MAP_UNAVAILABLE');
  },
);
test.each([
  { installedMaps: [] },
  { installedMaps: [{ ...evidence.installedMaps[0]!, version: 'wrong' }] },
  {
    installedMaps: [
      { ...evidence.installedMaps[0]!, regionConstant: 'OTHER_REGION' },
    ],
  },
])('missing/wrong maps block routing', ({ installedMaps }) => {
  expect(
    failure(() =>
      requireCopilotProfilePrerequisites(config, {
        ...evidence,
        installedMaps,
      }),
    ).code,
  ).toBe('REQUIRED_MAP_UNAVAILABLE');
});
test.each(['unknown', 'denied', 'approximate'] as const)(
  'location %s is blocked',
  gpsPermission => {
    expect(
      failure(() =>
        requireCopilotProfilePrerequisites(config, {
          ...evidence,
          gpsPermission,
        }),
      ).code,
    ).toBe('PRECISE_LOCATION_UNAVAILABLE');
  },
);
test('CPIK errors retain the original exception and stack as cause', () => {
  const nativeError = Object.assign(new Error('unit native failure'), {
    nativeStack: 'unit native stack',
  });
  const error = failure(() =>
    requireCopilotProfilePrerequisites(config, {
      ...evidence,
      failure: { operation: 'bindCoPilotService', error: nativeError },
    }),
  );
  expect(error.code).toBe('CPIK_ERROR');
  expect(error.cause).toBe(nativeError);
  expect(error.fields).toEqual(['bindCoPilotService']);
});
test('passing prerequisites permits profile assessment only, never activates navigation', async () => {
  expect(requireCopilotProfilePrerequisites(config, evidence)).toBeUndefined();
  const engine = new NativeGuidanceAdapter();
  await expect(engine.initialize()).resolves.toMatchObject({
    available: false,
  });
  await expect(engine.setTruckProfile(truck)).rejects.toMatchObject({
    code: 'TRUCK_RESTRICTIONS_UNREPRESENTABLE',
  });
  await expect(engine.startNavigation()).rejects.toMatchObject({
    code: 'NATIVE_TRUCK_GUIDANCE_NOT_CONFIGURED',
  });
  expect(engine.getNavigationState().phase).toBe('unavailable');
});
test('every SemiTraX truck field has an explicit classification', () => {
  expect(Object.keys(copilotTruckFieldMatrix).sort()).toEqual(
    Object.keys(truck).sort(),
  );
});
test('dimensions convert upward; pounds and the input remain unchanged', () => {
  const original = JSON.stringify(truck);
  const result = assessCopilotTruckProfile({ ...truck, heightFt: 13.51 });
  expect(result.conversionEvidence).toMatchObject({
    heightInches: 163,
    widthInches: 102,
    lengthInches: 864,
    grossWeightPounds: 80000,
    weightPerAxlePounds: 17000,
    vehicleTypeConstantName: 'TRUCK_HEAVY_DUTY',
    hazmatConstantName: 'FLAMMABLE',
    tollRoadsConstantName: 'ALWAYS_AVOID',
  });
  expect(JSON.stringify(truck)).toBe(original);
  expect(result.canApply).toBe(false);
});
test.each([NaN, Infinity, -1, 0])(
  'invalid dimension %s rejected',
  dimension => {
    expect(() => feetToConservativeInches(dimension)).toThrow(CopilotP0Error);
  },
);
test('all active unsupported restrictions are reported; none are silently discarded', () => {
  expect(
    assessCopilotTruckProfile({ ...truck, avoidHighways: true }).blockers,
  ).toEqual(
    expect.arrayContaining([
      'axleCount',
      'trailerCount',
      'trailerType',
      'currentWeightLbs',
      'avoidFerries',
      'avoidHighways',
      'avoidResidential',
      'avoidDirtRoads',
    ]),
  );
});
test.each([
  { hazardousGoods: ['flammable', 'explosive'] },
  { hazardousGoods: ['gas'] },
  { hazardousGoods: ['corrosive'] },
] as const)(
  'hazmat %j cannot collapse to a generic class',
  ({ hazardousGoods }) => {
    const result = assessCopilotTruckProfile({
      ...truck,
      hazardousGoods: [...hazardousGoods],
    });
    expect(result.blockers).toContain('hazardousGoods');
    expect(result.conversionEvidence.hazmatConstantName).toBeUndefined();
  },
);
test('disabling avoidances or trailers cannot bypass unsupported axle configuration', () => {
  const simple = {
    ...truck,
    avoidHighways: false,
    avoidResidential: false,
    avoidDirtRoads: false,
    avoidFerries: false,
    currentWeightLbs: null,
    trailerCount: 0,
    trailerType: null,
    hazmatEnabled: false,
    hazardousGoods: [],
  };
  expect(
    assessCopilotTruckProfile(simple).conversionEvidence.hazmatConstantName,
  ).toBe('NONE');
  expect(
    failure(() => requireRepresentableCopilotTruckProfile(simple)).fields,
  ).toEqual(['axleCount', 'trailerCount']);
});
test('unknown safety fields and malformed profiles are rejected', () => {
  expect(() =>
    assessCopilotTruckProfile({ ...truck, newRestriction: true }),
  ).toThrow(CopilotP0Error);
  expect(() => assessCopilotTruckProfile(null)).toThrow(CopilotP0Error);
  expect(() => assessCopilotTruckProfile({ ...truck, weightLbs: -1 })).toThrow(
    CopilotP0Error,
  );
});
