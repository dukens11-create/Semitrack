import * as Keychain from 'react-native-keychain';
import { SecureTokenVault } from '../src/services/storage/SecureTokenVault';
import { AuthStore } from '../src/features/auth/AuthStore';
import { ApiClient } from '../src/services/api/ApiClient';
import { safeDriverError } from '../src/errors/driverErrors';
import { tokens, user, reply } from './fixtures';

jest.mock('react-native-keychain', () => ({
  ACCESSIBLE: { WHEN_UNLOCKED_THIS_DEVICE_ONLY: 'device-only' },
  setGenericPassword: jest.fn(),
  getGenericPassword: jest.fn(),
}));
afterEach(() => jest.resetAllMocks());
test('a failed secure write cannot publish a successful login', async () => {
  jest.mocked(Keychain.setGenericPassword).mockResolvedValue(false);
  const vault = new SecureTokenVault();
  const auth = new AuthStore(
    new ApiClient(
      'https://api.example.test',
      vault,
      jest.fn(async () => reply({ ...tokens, user })),
    ),
    vault,
  );
  await expect(
    auth.authenticate(user.email, 'test-password'),
  ).rejects.toMatchObject({ code: 'SESSION_STORAGE_UNAVAILABLE' });
  expect(auth.getSnapshot().status).not.toBe('signedIn');
});
test('native storage errors produce actionable copy without disclosing private messages', async () => {
  jest
    .mocked(Keychain.setGenericPassword)
    .mockRejectedValue(new Error('private native credential error'));
  const error = await new SecureTokenVault()
    .write(tokens)
    .catch(value => value);
  expect(safeDriverError(error)).toContain('Unlock your phone');
  expect(String(error)).not.toContain('private native');
});
test('successful secure storage keeps the existing device-only session identity', async () => {
  jest.mocked(Keychain.setGenericPassword).mockResolvedValue({} as never);
  await new SecureTokenVault().write(tokens);
  expect(Keychain.setGenericPassword).toHaveBeenCalledWith(
    'session',
    JSON.stringify(tokens),
    {
      service: 'com.semitrax.app.session',
      accessible: 'device-only',
    },
  );
});
