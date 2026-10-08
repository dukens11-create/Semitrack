import {
  NativeModules,
  TurboModuleRegistry,
  type TurboModule,
} from 'react-native';

/** RN 0.85 uses the TurboModule proxy in bridgeless mode, including legacy interop. */
export function nativeCopilotModule(
  name: string,
): Record<string, unknown> | null {
  const value: unknown =
    TurboModuleRegistry.get<TurboModule & Record<string, unknown>>(name) ??
    NativeModules[name];
  return value && typeof value === 'object'
    ? (value as Record<string, unknown>)
    : null;
}
