import { coPilotDiagnosticReport } from '../src/services/copilot/CoPilotDiagnosticReport';
import { initialCopilotState } from '../src/services/copilot/CopilotLifecycle';

function native() {
  return {
    reportBuild: 'ams-trace-v1',
    sdkVersion: '10.28.2.497',
    androidApi: 36,
    savedCompanyMatches: true,
    savedDeviceMatches: true,
    credentialHook: 'SUPPLY_ASSIGNED',
    hookMatchedAssigned: true,
    callbackMatchedAssigned: true,
    loginResponse: 'FAILED_LOGIN_INVALID_CREDS',
    deviceConfigured: true,
    deviceConfigurationStatus: 'VERIFIED',
    deviceReadbackKind: 'MATCH',
    droppedEvents: 0,
    timeline: [
      {
        sequence: 1,
        elapsedMs: 20,
        event: 'CREDENTIAL_HOOK',
        started: false,
        deviceVerified: false,
        response: 'NOT_RECEIVED',
      },
      {
        sequence: 2,
        elapsedMs: 300,
        event: 'LOGIN_CALLBACK',
        started: true,
        deviceVerified: true,
        response: 'FAILED_LOGIN_INVALID_CREDS',
      },
    ],
  };
}

test('report retains actual callback order, verification at callback time and login rejection', () => {
  const report = coPilotDiagnosticReport(native(), initialCopilotState());
  expect(report.indexOf('CREDENTIAL_HOOK')).toBeLessThan(
    report.indexOf('LOGIN_CALLBACK'),
  );
  expect(report).toContain('"deviceVerified": false');
  expect(report).toContain('FAILED_LOGIN_INVALID_CREDS');
  expect(report).toContain('"elapsedMs": 300');
});

test('export drops unknown fields and rejects credentials injected into status or version fields', () => {
  const secret = 'SECRET_PASSWORD_LOCATION';
  const input = {
    ...native(),
    password: secret,
    company: secret,
    rawLog: secret,
    credentialHook: secret,
    sdkVersion: secret,
    timeline: [
      { ...native().timeline[0], event: secret, response: secret, raw: secret },
    ],
  };
  const report = coPilotDiagnosticReport(input, {
    ...initialCopilotState(),
    operation: secret,
    raw: secret,
  });
  expect(report).not.toContain(secret);
  expect(report).not.toContain('rawLog');
  expect(report).toContain('NOT_AVAILABLE');
});

test('malformed booleans, non-finite timings and oversized history cannot leak through serialization', () => {
  expect(() =>
    coPilotDiagnosticReport(
      { ...native(), savedCompanyMatches: 'secret' },
      initialCopilotState(),
    ),
  ).toThrow();
  expect(() =>
    coPilotDiagnosticReport(
      {
        ...native(),
        timeline: [{ ...native().timeline[0], elapsedMs: Infinity }],
      },
      initialCopilotState(),
    ),
  ).toThrow();
  expect(() =>
    coPilotDiagnosticReport(
      { ...native(), timeline: Array(97).fill(native().timeline[0]) },
      initialCopilotState(),
    ),
  ).toThrow();
});

test.each(['ams-trace-v2', 'ams-testasset-v2'])('report identifies supported build %s', reportBuild => {
  expect(coPilotDiagnosticReport({ ...native(), reportBuild }, initialCopilotState())).toContain(reportBuild);
});
