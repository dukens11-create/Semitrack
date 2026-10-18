import { engineMapProof, engineMapSnapshotSchema, type EngineMapSnapshot } from '../src/features/map/engineMapProof';
const now = 1800000000000;
const sample: EngineMapSnapshot = {
  sequence: 10, routeRevision: 3, observedAt: now, available: true,
  gpsFresh: true, fixAt: now, latitude: 39.5, longitude: -119.8,
  hasDestination: true, routeStatus: 'ready', instruction: 'Turn right',
  routeCoordinates: [[-119.8, 39.5], [-119.7, 39.6]],
};
test('displays only engine geometry with longitude first', () => {
  const result = engineMapProof(sample, now);
  expect(result.coordinates).toEqual(sample.routeCoordinates);
  expect(result.position).toEqual([-119.8, 39.5]);
  expect(result.instruction).toBe('Turn right');
});
test.each(['calculating', 'failed', 'none', 'arrived', 'unknown'] as const)('clears route and turns when engine reports %s', routeStatus => {
  const result = engineMapProof({...sample, routeStatus}, now);
  expect(result.coordinates).toBeUndefined();
  expect(result.instruction).toBeUndefined();
});
test('does not retain old route or position after snapshot timeout', () => {
  const result = engineMapProof(sample, now + 5001);
  expect(result.coordinates).toBeUndefined();
  expect(result.position).toBeUndefined();
});
test('invalid GPS and absent destination cannot display guidance geometry', () => {
  expect(engineMapProof({...sample, gpsFresh: false}, now).coordinates).toBeUndefined();
  expect(engineMapProof({...sample, hasDestination: false}, now).coordinates).toBeUndefined();
});
test('rejects invalid route coordinates and missing revision', () => {
  expect(engineMapSnapshotSchema.safeParse({...sample, routeCoordinates: [[200, 39], [0, 0]]}).success).toBe(false);
  expect(engineMapSnapshotSchema.safeParse({...sample, routeRevision: undefined}).success).toBe(false);
});
