import {
  readAppearance,
  writeAppearance,
} from '../src/features/settings/AppearanceStorage';
import * as Keychain from 'react-native-keychain';
jest.mock('react-native-keychain', () => ({
  getGenericPassword: jest.fn(),
  setGenericPassword: jest.fn().mockResolvedValue({}),
  ACCESSIBLE: { WHEN_UNLOCKED_THIS_DEVICE_ONLY: 'device-only' },
}));
test.each(['day', 'night', 'system'] as const)(
  'device-local %s snapshot survives a new hydration',
  async mode => {
    jest.mocked(Keychain.getGenericPassword).mockResolvedValue({
      username: 'appearance',
      password: mode,
      service: 'com.semitrax.app.appearance',
      storage: 'test',
    } as never);
    await writeAppearance(mode);
    expect(Keychain.setGenericPassword).toHaveBeenLastCalledWith(
      'appearance',
      mode,
      { service: 'com.semitrax.app.appearance', accessible: 'device-only' },
    );
    expect(await readAppearance()).toBe(mode);
  },
);
test('missing preference differs from invalid preference; invalid data never becomes an explicit theme', async () => {
  jest
    .mocked(Keychain.getGenericPassword)
    .mockResolvedValueOnce(false)
    .mockResolvedValueOnce({ password: 'unexpected' } as never);
  expect(await readAppearance()).toBeNull();
  await expect(readAppearance()).rejects.toThrow('Saved appearance is invalid');
});

test('failed retention does not poison later hydration of the last acknowledged mode', async () => {
  jest
    .mocked(Keychain.setGenericPassword)
    .mockRejectedValueOnce(new Error('storage unavailable'));
  jest
    .mocked(Keychain.getGenericPassword)
    .mockResolvedValueOnce({ password: 'day' } as never);
  await expect(writeAppearance('night')).rejects.toThrow('storage unavailable');
  await expect(readAppearance()).resolves.toBe('day');
  jest.mocked(Keychain.setGenericPassword).mockResolvedValueOnce({} as never);
  await expect(writeAppearance('night')).resolves.toBeUndefined();
});
