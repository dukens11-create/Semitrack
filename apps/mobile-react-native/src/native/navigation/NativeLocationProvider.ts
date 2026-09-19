import NativePlatform from './NativeSemiTraxPlatform';
import type { LocationProvider } from '../../services/location/LocationService';
function platform() {
  if (!NativePlatform) {
    throw new Error('Native location module is unavailable in this build.');
  }
  return NativePlatform;
}
export class NativeLocationProvider implements LocationProvider {
  permissionStatus() {
    return platform().locationPermissionStatus();
  }
  permission(background: boolean) {
    return platform().requestLocationPermission(background);
  }
  start(background: boolean) {
    return platform().startLocation(background);
  }
  async stop() {
    await NativePlatform?.stopLocation();
  }
  subscribe(onFix: (raw: unknown) => void, onError: (message: string) => void) {
    const location = platform().onLocation(raw => {
      try {
        onFix(JSON.parse(raw));
      } catch {
        onError('Invalid native location update.');
      }
    });
    const error = platform().onLocationError(onError);
    return () => {
      location.remove();
      error.remove();
    };
  }
}
