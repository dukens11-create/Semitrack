import { NativeModules, Platform } from 'react-native';
export const enginePreferences = {
  speedLimit: {
    label: 'Show speed limit',
    module: 'GuidanceSettings',
    get: 'isSpeedLimitOnMap',
    set: 'setSpeedLimitOnMap',
  },
  speedAlert: {
    label: 'Speed alerts',
    module: 'GuidanceSettings',
    get: 'isSpeedAlertEnabled',
    set: 'setSpeedAlert',
  },
  speedAudio: {
    label: 'Spoken speed alerts',
    module: 'GuidanceSettings',
    get: 'isSpeedAlertAudioEnabled',
    set: 'setSpeedAlertAudio',
  },
  earlyTurn: {
    label: 'Early turn warning',
    module: 'GuidanceMgr',
    get: 'isEarlyTurnWarningEnabled',
    set: 'enableEarlyTurnWarning',
  },
  farTurn: {
    label: 'Far turn warning',
    module: 'GuidanceMgr',
    get: 'isFarTurnWarningEnabled',
    set: 'enableFarTurnWarning',
  },
  nearTurn: {
    label: 'Near turn warning',
    module: 'GuidanceMgr',
    get: 'isNearTurnWarningEnabled',
    set: 'enableNearTurnWarning',
  },
  clearTurn: {
    label: 'Clear turn view',
    module: 'GuidanceMgr',
    get: 'isClearTurnViewEnabled',
    set: 'enableClearTurnView',
  },
} as const;
export type EnginePreference = keyof typeof enginePreferences;
export async function readEnginePreference(
  key: EnginePreference,
): Promise<boolean> {
  const rule = enginePreferences[key];
  if (!rule || Platform.OS !== 'android')
    throw new Error('Engine preference unavailable');
  const module = NativeModules[rule.module];
  if (typeof module?.[rule.get] !== 'function')
    throw new Error('Engine preference unavailable');
  const value = await module[rule.get]();
  if (typeof value !== 'boolean') throw new Error('Invalid engine preference');
  return value;
}
export async function writeEnginePreference(
  key: EnginePreference,
  value: boolean,
) {
  const rule = enginePreferences[key];
  if (!rule || typeof value !== 'boolean' || Platform.OS !== 'android')
    throw new Error('Invalid preference');
  const module = NativeModules[rule.module];
  if (typeof module?.[rule.set] !== 'function')
    throw new Error('Engine preference unavailable');
  await module[rule.set](value);
  if ((await readEnginePreference(key)) !== value)
    throw new Error('Engine did not confirm the setting');
  return value;
}
