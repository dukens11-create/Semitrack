import { Linking } from 'react-native';
import * as Keychain from 'react-native-keychain';
import { z } from 'zod';

const identifier = z
  .string()
  .trim()
  .min(1)
  .max(256)
  .refine(value =>
    Array.from(value).every(
      char => char.charCodeAt(0) >= 32 && char.charCodeAt(0) !== 127,
    ),
  );
export const deviceLicenseSchema = z
  .object({ companyId: identifier, assetId: identifier })
  .strict();
export type DeviceLicense = z.infer<typeof deviceLicenseSchema>;
export class DeviceActivationError extends Error {
  constructor(
    readonly code:
      | 'COPILOT_APP_UNAVAILABLE'
      | 'DEVICE_SETTINGS_SAVE_FAILED'
      | 'COPILOT_LAUNCH_FAILED',
  ) {
    super(code);
    this.name = 'DeviceActivationError';
  }
}
const options = {
  service: 'com.semitrax.copilot.device',
  accessible: Keychain.ACCESSIBLE.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
};

export function activationUrl(value: DeviceLicense): string {
  const license = deviceLicenseSchema.parse(value);
  return `copilot://options?type=CONFIG&CompanyID=${encodeURIComponent(
    license.companyId,
  )}&AssetID=${encodeURIComponent(license.assetId)}&showconfirmation=true`;
}

export async function readDeviceLicense(): Promise<DeviceLicense | null> {
  const saved = await Keychain.getGenericPassword(options);
  return saved ? deviceLicenseSchema.parse(JSON.parse(saved.password)) : null;
}

export async function saveDeviceLicense(value: DeviceLicense): Promise<void> {
  const license = deviceLicenseSchema.parse(value);
  try {
    if (
      !(await Keychain.setGenericPassword(
        'device-license',
        JSON.stringify(license),
        options,
      ))
    ) {
      throw new DeviceActivationError('DEVICE_SETTINGS_SAVE_FAILED');
    }
  } catch {
    throw new DeviceActivationError('DEVICE_SETTINGS_SAVE_FAILED');
  }
}

/** Launch is not activation evidence and must not change embedded CPIK readiness. */
export async function openDeviceActivation(
  value: DeviceLicense,
): Promise<void> {
  const license = deviceLicenseSchema.parse(value);
  const url = activationUrl(license);
  let available: boolean;
  try {
    available = await Linking.canOpenURL(url);
  } catch {
    throw new DeviceActivationError('COPILOT_LAUNCH_FAILED');
  }
  if (!available) throw new DeviceActivationError('COPILOT_APP_UNAVAILABLE');
  await saveDeviceLicense(license);
  try {
    await Linking.openURL(url);
  } catch {
    throw new DeviceActivationError('COPILOT_LAUNCH_FAILED');
  }
}
