import { ApiClient } from '../src/services/api/ApiClient';
import { routeDiagnostic } from '../src/features/routing/routeDiagnostic';
import { sanitizeRestrictionDiagnostic } from '../src/features/routing/restrictionDiagnostic';
import type { TokenVault } from '../src/services/storage/TokenVault';
const evidence = {
  source: 'TRIMBLE_DIRECTIONS_REPORT',
  category: 'UNCLASSIFIED_PROVIDER_WARNING',
  providerWarningTypes: [4, 4, 'secret-fixture', 0, -1, 999999],
  providerTextPresent: true,
  legNumber: 2,
  lineNumber: 3,
  message: 'private-address',
  Warn: 'secret-fixture',
  coordinates: [40, -120],
};
test('API warning survives into shareable diagnostics without raw provider data', async () => {
  const transport = jest.fn(async () => ({
    status: 422,
    ok: false,
    text: async () =>
      JSON.stringify({
        truckSafe: false,
        navigationAllowed: false,
        error: {
          code: 'TRIMBLE_RESTRICTION_WARNING',
          message: 'private-address',
          restrictionDiagnostic: evidence,
        },
      }),
  }));
  const client = new ApiClient(
    'https://fixture.invalid',
    {} as TokenVault,
    transport as unknown as typeof fetch,
  );
  let caught: unknown;
  try {
    await client.request('POST', '/routes', {}, undefined, false);
  } catch (e) {
    caught = e;
  }
  expect(caught).toBeDefined();
  const result = routeDiagnostic(caught);
  expect(result.providerDetailAvailable).toBe(true);
  expect(result.providerDetail?.providerWarningTypes).toEqual([4]);
  expect(result.providerDetail?.legNumber).toBe(2);
  expect(result.providerDetail?.lineNumber).toBe(3);
  expect(result.category).toBe('UNCLASSIFIED_PROVIDER_WARNING');
  expect(result.httpStatus).toBe(422);
  expect(JSON.stringify(result)).not.toMatch(
    /private-address|secret-fixture|coordinates/,
  );
  expect(transport).toHaveBeenCalledTimes(1);
});
test('old API with no detail remains safely unclassified', () => {
  expect(
    routeDiagnostic({ code: 'TRIMBLE_RESTRICTION_WARNING', status: 422 })
      .providerDetailAvailable,
  ).toBe(false);
});
test('malformed diagnostic identity and indices never reach the UI', () => {
  for (const patch of [
    { source: 'private-address' },
    { category: 'secret-fixture' },
    { legNumber: 0 },
    { lineNumber: 'secret-fixture' },
    { providerWarningTypes: null },
  ]) {
    expect(sanitizeRestrictionDiagnostic({ ...evidence, ...patch })).toBeNull();
  }
});
test('other error codes cannot attach restriction evidence', () => {
  expect(
    routeDiagnostic({
      code: 'TRIMBLE_AUTHORIZATION_FAILED',
      restrictionDiagnostic: evidence,
    }).providerDetailAvailable,
  ).toBe(false);
});
test('warning identifiers are bounded and do not acquire invented meanings', () => {
  const result = sanitizeRestrictionDiagnostic({
    ...evidence,
    providerWarningTypes: Array.from({ length: 30 }, (_, i) => i + 1),
  });
  expect(result?.providerWarningTypes).toHaveLength(16);
  expect(result?.category).toBe('UNCLASSIFIED_PROVIDER_WARNING');
});
