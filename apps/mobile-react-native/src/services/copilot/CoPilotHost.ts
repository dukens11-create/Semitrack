import { NativeModules, Platform } from 'react-native';
import { z } from 'zod';
export interface CoPilotHost {
  readonly automaticAssignedSetup?: boolean;
  configureDevice(
    company: string,
    device: string,
    region: string,
  ): Promise<void>;
  prepareDevice(): Promise<unknown>;
  mapInventory(): Promise<unknown>;
  downloadSelectedMap(): Promise<string>;
  setMapAppearance(night: boolean): Promise<void>;
  mapCommand(command: string): Promise<void>;
  drawRoutePreview(
    points: readonly (readonly [number, number])[],
  ): Promise<void>;
  mapFrame(
    west: number,
    south: number,
    east: number,
    north: number,
  ): Promise<void>;
  drawMarkers(
    markers: { id: number; lat: number; lng: number }[],
  ): Promise<void>;
}
export function coPilotHost(): CoPilotHost {
  const host = NativeModules.SemiTraxCoPilotHost as CoPilotHost | undefined;
  if (Platform.OS !== 'android' || !host)
    throw new Error('CoPilot native host unavailable');
  return host;
}
const inventory = z.object({
  licensed: z.array(z.number().int().nonnegative()),
  selectedRegion: z.number().int().nonnegative(),
  installed: z.array(
    z.object({
      set: z.number().int(),
      year: z.number().int().min(2000),
      quarter: z.number().int().min(1).max(4),
      versionString: z.string().min(1),
    }),
  ),
});
export async function selectedMapInstalled(): Promise<boolean> {
  const value = inventory.parse(await coPilotHost().mapInventory());
  return (
    value.licensed.includes(value.selectedRegion) &&
    value.installed.some(map => map.set === value.selectedRegion)
  );
}
