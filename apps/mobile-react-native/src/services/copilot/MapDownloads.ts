import { Platform } from 'react-native';
import { z } from 'zod';
import { nativeCopilotModule } from './NativeModuleLookup';

const regionSchema = z.object({
  id: z.number().int().nonnegative(),
  name: z.string().min(1),
  label: z
    .string()
    .nullable()
    .transform(value => value ?? ''),
  status: z.string(),
  downloadedBytes: z.number().finite().nonnegative(),
  totalBytes: z.number().finite().nonnegative(),
});
const catalogSchema = z.object({
  readinessSource: z.enum(['AMS_LICENSED', 'WAITING_FOR_LICENSE']).optional(),
  selectedRegion: z.number().int().min(-1).optional(),
  selectedCoverageInstalled: z.boolean().optional(),
  attempts: z.number().int().min(0).max(3).optional(),
  automationError: z
    .string()
    .regex(/^[A-Z_]*$/)
    .optional(),
  initialReady: z.boolean(),
  initialAccepted: z.boolean(),
  downloadPolicyApplied: z.boolean(),
  freeBytes: z.number().finite().nonnegative(),
  regions: z.array(regionSchema),
  installed: z.array(
    z.object({
      id: z.number().int().nonnegative(),
      name: z.string(),
      label: z
        .string()
        .nullable()
        .transform(value => value ?? ''),
      year: z.number().int().min(2000),
      quarter: z.number().int().min(1).max(4),
      version: z.string().trim().min(1),
    }),
  ),
});
export type MapCatalog = z.infer<typeof catalogSchema>;
export type MapRegionOption = z.infer<typeof regionSchema>;
export type MapAction = 'download' | 'pause' | 'resume' | 'cancel';
export class MapDownloadError extends Error {
  constructor(readonly code: string) {
    super(code);
  }
}
export function setMapPanelVisible(visible: boolean): void {
  const host = nativeCopilotModule('SemiTraxCoPilotSetup');
  const fn = host?.setMapPanelVisible;
  if (typeof fn === 'function') fn.call(host, visible);
}
async function call(method: string, ...args: unknown[]): Promise<unknown> {
  if (Platform.OS !== 'android')
    throw new MapDownloadError('COPILOT_MAPS_ANDROID_REQUIRED');
  const host = nativeCopilotModule('SemiTraxCoPilotSetup');
  const fn = host?.[method];
  if (typeof fn !== 'function')
    throw new MapDownloadError('COPILOT_MAPS_UPDATE_REQUIRED');
  try {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        Promise.resolve(fn.apply(host, args)),
        new Promise<never>((_, reject) => {
          timer = setTimeout(
            () => reject(new MapDownloadError('COPILOT_MAP_RESPONSE_TIMEOUT')),
            16000,
          );
        }),
      ]);
    } finally {
      clearTimeout(timer);
    }
  } catch (error) {
    const code = z
      .object({ code: z.string().regex(/^COPILOT_MAP[A-Z_]+$/) })
      .safeParse(error);
    throw new MapDownloadError(
      code.success ? code.data.code : 'COPILOT_MAP_OPERATION_FAILED',
    );
  }
}
export async function readMapCatalog(): Promise<MapCatalog> {
  const result = catalogSchema.safeParse(await call('readMapCatalog'));
  if (!result.success)
    throw new MapDownloadError('COPILOT_MAP_CATALOG_INVALID');
  if (
    new Set(result.data.regions.map(region => region.id)).size !==
      result.data.regions.length ||
    new Set(result.data.installed.map(map => map.id)).size !==
      result.data.installed.length
  )
    throw new MapDownloadError('COPILOT_MAP_CATALOG_INVALID');
  return result.data;
}
export async function mapCommand(
  region: number,
  action: MapAction,
): Promise<string> {
  if (
    !Number.isInteger(region) ||
    region < 0 ||
    !['download', 'pause', 'resume', 'cancel'].includes(action)
  )
    throw new MapDownloadError('COPILOT_MAP_REGION_INVALID');
  const result = await call('mapCommand', region, action);
  if (typeof result !== 'string' || !/^[A-Z_]+$/.test(result))
    throw new MapDownloadError('COPILOT_MAP_RESPONSE_INVALID');
  return result;
}
export function regionLabel(region: { name: string; label: string }): string {
  return (
    region.label.trim() ||
    region.name.replace(/^NORTH_AMERICA_/, '').replace(/_/g, ' ')
  );
}
export function mapProgress(
  region: MapRegionOption,
  installed: MapCatalog['installed'],
): string {
  const matching = installed.filter(map => map.id === region.id);
  const inventory =
    matching.length === 1 &&
    matching[0]!.year >= 2000 &&
    matching[0]!.quarter >= 1 &&
    matching[0]!.quarter <= 4 &&
    matching[0]!.version.trim()
      ? matching[0]
      : undefined;
  if (inventory)
    return `Installed · ${inventory.year} Q${inventory.quarter} · ${inventory.version}`;
  const labels: Record<string, string> = {
    NOT_REQUESTED: 'Not installed',
    REQUESTING: 'Sending map request',
    QUEUED: 'Request queued',
    DOWNLOADING: 'Downloading',
    SUCCEEDED: 'Downloaded · waiting for installation verification',
    INSTALLATION_STARTED: 'Installing',
    INSTALLATION_FINISHED: 'Installation reported · verifying inventory',
    PAUSED: 'Paused',
    CANCELLED: 'Cancelled',
    FAILED: 'Download failed',
    WAITING_ON_STORAGE_SPACE: 'More storage needed',
    NOT_INITIATED: 'Not started',
    STATUS_UNKNOWN: 'Status unavailable',
  };
  const percent =
    region.totalBytes > 0
      ? Math.min(
          100,
          Math.floor((region.downloadedBytes * 100) / region.totalBytes),
        )
      : null;
  const status = labels[region.status] ?? responseMessage(region.status);
  return region.status === 'DOWNLOADING' && percent !== null
    ? `${status} · ${percent}%`
    : status;
}
export function responseMessage(code: string): string {
  const messages: Record<string, string> = {
    SCHEDULED:
      'Coverage saved. Download and installation will be managed automatically.',
    COPILOT_MAP_READINESS_TIMEOUT:
      'CoPilot did not become ready. Check Wi-Fi and device assignment, then retry.',
    COPILOT_MAP_PROGRESS_TIMEOUT:
      'No map progress received. The download was not replaced. Reopen SemiTraX and check status; contact Trimble if it remains stalled.',
    COPILOT_MAP_RESPONSE_TIMEOUT:
      'CoPilot did not respond. Check status before retrying.',
    SUCCESS: 'Request accepted. Installation will be checked separately.',
    FAILURE_UNLICENSED: 'This map is not licensed for this device.',
    FAILURE_INSUFFICIENT_DISK_SPACE: 'Free more storage and retry.',
    WAITING_ON_STORAGE_SPACE: 'Free more storage to continue.',
    FAILURE_INVALID_CONNECTION: 'Connect to Wi-Fi and retry.',
    FAILURE_VERSION: 'Map versions do not match. Existing maps were kept.',
    FAILURE_INSTALLED:
      'CoPilot reports this map is already installed. Refresh to verify.',
    FAILURE_DOWNLOADING: 'This map is already downloading.',
    FAILURE_DOWNLOADED: 'This map is downloaded and awaiting installation.',
    FAILURE_PAUSED: 'This download is paused. Use Resume.',
    FAILURE_MANAGER_BUSY:
      'CoPilot map manager is busy. Up to 3 attempts are allowed; if still busy, restart SemiTraX and contact Trimble.',
    COPILOT_MAP_INITIAL_NOT_READY:
      'Waiting for CoPilot’s first-map readiness signal. No download has started.',
    COPILOT_MAP_INITIAL_IN_PROGRESS:
      'The first map request was accepted. Wait for installation before adding another region.',
    COPILOT_MAP_DOWNLOAD_POLICY_FAILED:
      'CoPilot’s download settings could not be applied. Close and reopen SemiTraX, then check setup again.',
    COPILOT_MAPS_SETUP_REQUIRED:
      'Keep SemiTraX open and run the setup check again.',
    COPILOT_MAPS_UPDATE_REQUIRED:
      'Install the latest SemiTraX APK to download maps.',
    COPILOT_MAP_VERSION_UNVERIFIED:
      'The installed map version could not be verified. No download was started.',
    COPILOT_MAP_VERSION_MISMATCH:
      'Installed maps have different versions. No download was started.',
  };
  return (
    messages[code] ??
    `Map operation could not complete (${code}). Refresh and retry.`
  );
}
