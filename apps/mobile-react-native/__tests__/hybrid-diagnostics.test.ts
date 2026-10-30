import { coPilotDiagnosticReport } from '../src/services/copilot/CoPilotDiagnosticReport';
const state = {
  phase: 'READY',
  initialized: true,
  licensingReady: true,
  fullNavigationLicensed: true,
  heavyTruckLicensed: true,
  mapsReady: true,
};
const native = {
  reportBuild: 'hybrid-issue392-v1',
  sdkVersion: '10.28.2.497',
  savedCompanyMatches: false,
  savedDeviceMatches: false,
  hookMatchedAssigned: false,
  callbackMatchedAssigned: true,
  credentialHook: 'SUPPLY_ASSIGNED',
  loginResponse: 'SUCCESS',
  buildIdentity: {
    commit: 'a'.repeat(40),
    builtAt: '2026-10-18T17:00:00Z',
    packageName: 'com.semitrax.app.hybridtest392',
    variant: 'debug',
    versionCode: 392,
    versionName: '0.1.392',
  },
  controlTimeline: [
    {
      action: 'END_ROUTE',
      stage: 'CONFIRMED',
      elapsedMs: 100,
      engineStarted: true,
      serviceConnected: true,
      location: 'SENSITIVE',
    },
  ],
  deviceId: 'SENSITIVE',
  token: 'SENSITIVE',
};
test('shared diagnostics retain Hybrid identity and bounded events, stripping sensitive extra fields', () => {
  const report = coPilotDiagnosticReport(native, state);
  expect(report).toContain('hybrid-issue392-v1');
  expect(report).toContain('a'.repeat(40));
  expect(report).toContain('END_ROUTE');
  expect(report).not.toContain('SENSITIVE');
});
test('arbitrary native messages are not exported as event codes', () => {
  const report = coPilotDiagnosticReport(
    {
      ...native,
      controlTimeline: [
        {
          action: 'SENSITIVE',
          stage: 'SENSITIVE',
          elapsedMs: 0,
          engineStarted: false,
          serviceConnected: false,
        },
      ],
    },
    state,
  );
  expect(report).not.toContain('SENSITIVE');
  expect(report).toContain('NOT_AVAILABLE');
});
test('readiness precedes native timelines and preserves safe failure codes', () => {
  const report = coPilotDiagnosticReport(native, {
    ...state,
    readyToAddStops: false,
    error: 'COPILOT_NOT_READY',
  });
  expect(report.indexOf('"readiness"')).toBeLessThan(
    report.indexOf('"native"'),
  );
  expect(report).toContain('"readyToAddStops": false');
  expect(report).toContain('"error": "COPILOT_NOT_READY"');
});
test('readiness exports null or known errors without leaking unknown error text', () => {
  expect(coPilotDiagnosticReport(native, { ...state, error: null })).toContain(
    '"error": null',
  );
  const report = coPilotDiagnosticReport(native, {
    ...state,
    error: 'SENSITIVE',
  });
  expect(report).not.toContain('SENSITIVE');
  expect(report).toContain('"error": "NOT_AVAILABLE"');
});

test('route readiness and GPS are separate, bounded diagnostic fields', () => {
  const report = coPilotDiagnosticReport(
    {
      ...native,
      routeEngine: {
        status: 'AVAILABLE',
        readyToAddStops: false,
        receivingGps: true,
        hasDestination: false,
        location: 'SENSITIVE',
      },
    },
    state,
  );
  expect(report).toContain('"readyToAddStops": false');
  expect(report).toContain('"receivingGps": true');
  expect(report).not.toContain('SENSITIVE');
});
