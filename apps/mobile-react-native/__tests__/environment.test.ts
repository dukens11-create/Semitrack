import {
  createEnvironment,
  validateApiUrl,
  validateReleaseMapToken,
} from '../src/config/environment';
describe('release backend safety', () => {
  test.each(['', 'pk.', 'sk.private', 'pk.public value', 'pk.public\n'])(
    'missing or invalid release display token fails without echoing it: case %#',
    token => {
      expect(() => validateReleaseMapToken(token)).toThrow(
        'MAPBOX_PUBLIC_TOKEN',
      );
    },
  );
  test('public display token shape passes without a provider request', () => {
    expect(() =>
      validateReleaseMapToken('pk.synthetic_local_fixture'),
    ).not.toThrow();
  });
  test.each([
    '',
    'garbage',
    'http://api.semitrax.example',
    'https://localhost',
    'https://localhost.',
    'https://127.0.0.1',
    'https://127.1',
    'https://2130706433',
    'https://10.0.2.2',
    'https://10.0.3.2',
    'https://192.168.1.2',
    'https://172.16.1.1',
    'https://[::1]',
    'https://[fc00::1]',
    'https://user:password@api.example.test',
    'https://api.example.test/?token=x',
    'https://api.example.test/#x',
  ])('rejects %s', value =>
    expect(() => validateApiUrl(value, true)).toThrow(),
  );
  test('public domain starting with fc is valid', () =>
    expect(validateApiUrl('https://fc.example.test/', true)).toBe(
      'https://fc.example.test',
    ));
  test('debug allows explicitly configured emulator HTTP', () =>
    expect(validateApiUrl('http://10.0.2.2:8080', false)).toBe(
      'http://10.0.2.2:8080',
    ));
  test('private map token cannot enter configuration', () =>
    expect(() =>
      createEnvironment('https://api.example.test', 'sk.test', true),
    ).toThrow());
});
