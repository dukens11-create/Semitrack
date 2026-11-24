import type { CoPilotHost } from './CoPilotHost';

function code(error: unknown): unknown {
  return error && typeof error === 'object' && 'code' in error ? error.code : null;
}

/** Retry only a definitive missing marker, never an uncertain timeout or other command. */
export async function followPosition(
  host: Pick<CoPilotHost, 'mapCommand'>,
  current: () => boolean = () => true,
) {
  for (let attempt = 0; attempt < 3 && current(); attempt++) {
    try {
      await host.mapCommand('recenter');
      return;
    } catch (error) {
      if (code(error) !== 'COPILOT_CHEVRON_UNAVAILABLE' || attempt === 2) throw error;
      await new Promise<void>(resolve => setTimeout(resolve, 1000));
    }
  }
}

export function followPositionError(error: unknown): string {
  if (code(error) === 'COPILOT_VISIBLE_PRECISE_LOCATION_REQUIRED')
    return 'Map could not follow your position. Open the app and allow precise location, then tap Recenter.';
  if (code(error) === 'COPILOT_CHEVRON_UNAVAILABLE')
    return 'Map could not follow your position. CoPilot’s position marker is not ready. Wait for GPS, then tap Recenter. Code COPILOT_CHEVRON_UNAVAILABLE.';
  return 'Map could not follow your position. Check GPS and tap Recenter.';
}
