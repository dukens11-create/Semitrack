import * as keychain from 'react-native-keychain';
import type { AppearanceMode } from './automaticAppearance';
const service = 'com.semitrax.app.appearance';
// Device-local, non-sensitive appearance only. Never stores account/session data.
let pending: Promise<unknown> = Promise.resolve();
export async function readAppearance(): Promise<AppearanceMode | null> {
  // A failed write must not prevent reading the last successfully saved mode.
  await pending.catch(() => {});
  const value = await keychain.getGenericPassword({ service });
  if (!value) return null;
  if (
    value.password === 'day' ||
    value.password === 'night' ||
    value.password === 'system'
  )
    return value.password;
  throw new Error('Saved appearance is invalid.');
}
export function writeAppearance(mode: AppearanceMode): Promise<void> {
  const next = pending
    .catch(() => {})
    .then(async () => {
      const result = await keychain.setGenericPassword('appearance', mode, {
        service,
        accessible: keychain.ACCESSIBLE.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
      });
      if (!result)
        throw new Error('Could not retain appearance on this device.');
    });
  pending = next;
  return next;
}
