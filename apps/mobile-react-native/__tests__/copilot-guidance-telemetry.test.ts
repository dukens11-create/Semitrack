import {
  guidancePresentation,
  guidanceSampleSchema,
} from '../src/services/copilot/CoPilotGuidance';
const now = 100000;
const sample = {
  sequence: 1,
  observedAt: now,
  available: true,
  gpsFresh: true,
  fixAt: now,
  speedMph: 42,
  heading: 359,
  truckSpeedLimitMph: 55,
  roadSpeedLimitMph: 65,
  hasDestination: true,
  routeStatus: 'ready' as const,
  etaAt: now + 600000,
  remainingMeters: 10000,
  instruction: 'Turn right',
};
it('uses real truck speed, heading and future ETA without passenger fallback', () => {
  expect(guidancePresentation(sample, now)).toMatchObject({
    fresh: true,
    speedMph: 42,
    heading: 'N',
    truckSpeedLimitMph: 55,
    etaAt: 700000,
  });
  expect(
    guidancePresentation({ ...sample, truckSpeedLimitMph: undefined }, now)
      .truckSpeedLimitMph,
  ).toBeUndefined();
});
it.each([
  { ...sample, available: false },
  { ...sample, gpsFresh: false },
  { ...sample, fixAt: now - 15001 },
  { ...sample, observedAt: now - 15001 },
  { ...sample, fixAt: now + 5001 },
])(
  'clears stale or invalid telemetry instead of freezing the last speed',
  value => {
    expect(guidancePresentation(value, now)).toMatchObject({
      fresh: false,
      speedMph: undefined,
      heading: undefined,
      truckSpeedLimitMph: undefined,
      etaAt: undefined,
      instruction: undefined,
    });
  },
);
it('clears trip information when the SDK has no destination', () => {
  expect(
    guidancePresentation({ ...sample, hasDestination: false }, now),
  ).toMatchObject({
    remainingMeters: undefined,
    etaAt: undefined,
    instruction: undefined,
    speedMph: 42,
  });
});
it('does not display an ETA in the past', () => {
  expect(
    guidancePresentation({ ...sample, etaAt: now - 1 }, now).etaAt,
  ).toBeUndefined();
});
it('rejects nonfinite, invalid coordinates, sentinel limits and incomplete samples', () => {
  for (const bad of [
    {},
    { ...sample, speedMph: NaN },
    { ...sample, latitude: 91 },
    { ...sample, truckSpeedLimitMph: -1 },
    { ...sample, heading: 360 },
  ]) {
    expect(guidanceSampleSchema.safeParse(bad).success).toBe(false);
  }
});
it.each(['calculating', 'failed', 'arrived', 'unknown', 'none'] as const)(
  'does not reuse route ETA or instructions while native state is %s',
  routeStatus => {
    expect(guidancePresentation({ ...sample, routeStatus }, now)).toMatchObject(
      {
        etaAt: undefined,
        instruction: undefined,
        remainingMeters: undefined,
        speedMph: 42,
      },
    );
  },
);
