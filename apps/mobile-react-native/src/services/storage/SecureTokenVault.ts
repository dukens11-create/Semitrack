import * as Keychain from 'react-native-keychain';
import { tokensSchema, type Tokens } from '../../models/contracts';
import type { TokenVault } from './TokenVault';
const options = {
  service: 'com.semitrax.app.session',
  accessible: Keychain.ACCESSIBLE.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
};
export class SecureTokenVault implements TokenVault {
  async read() {
    const value = await Keychain.getGenericPassword(options);
    return value ? tokensSchema.parse(JSON.parse(value.password)) : null;
  }
  async write(tokens: Tokens) {
    await Keychain.setGenericPassword(
      'session',
      JSON.stringify(tokensSchema.parse(tokens)),
      options,
    );
  }
  async clear() {
    await Keychain.resetGenericPassword(options);
  }
}
