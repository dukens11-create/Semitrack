import * as Keychain from 'react-native-keychain';
import type { OfflineRecordVault } from '../../features/offline/OfflineAccess';
const options = {
  service: 'com.semitrax.app.offline-preferences',
  accessible: Keychain.ACCESSIBLE.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
};
export class SecureOfflineVault implements OfflineRecordVault {
  async read() {
    const value = await Keychain.getGenericPassword(options);
    return value ? value.password : null;
  }
  async write(value: string) {
    const saved = await Keychain.setGenericPassword('offline', value, options);
    if (!saved) throw new Error('Offline preferences could not be retained.');
  }
  async clear() {
    await Keychain.resetGenericPassword(options);
  }
}
