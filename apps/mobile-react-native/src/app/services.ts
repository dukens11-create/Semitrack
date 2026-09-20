import { writeAppearance } from '../features/settings/AppearanceStorage';
import { safeLog } from '../services/telemetry/safeLog';
import { ApiClient } from '../services/api/ApiClient';
import { SerializedTokenVault } from '../services/storage/SerializedTokenVault';
import { SecureTokenVault } from '../services/storage/SecureTokenVault';
import { AuthStore } from '../features/auth/AuthStore';
import { OfflineAccess } from '../features/offline/OfflineAccess';
import { SecureOfflineVault } from '../services/storage/SecureOfflineVault';
import { pendingDocumentCreates } from '../services/storage/PendingDocumentCreates';
import { discardDocumentQueue } from '../features/documents/DocumentUploadQueue';
import { documentNative } from '../features/documents/DocumentFiles';
import { TruckRoutingService } from '../services/routing/TruckRoutingService';
import { RouteStore } from '../features/routing/RouteStore';
import { TruckProfileStore } from '../features/truckProfile/TruckProfileStore';
import { LocationService } from '../services/location/LocationService';
import { NativeLocationProvider } from '../native/navigation/NativeLocationProvider';
import { NativeGuidanceAdapter } from '../native/navigation/NativeGuidanceAdapter';
import { SearchService } from '../features/search/SearchService';
import { PoiService } from '../features/poi/PoiService';
import { SettingsService } from '../features/settings/SettingsService';
import type { Environment } from '../config/environment';
export function createServices(environment: Environment) {
  const vault = new SerializedTokenVault(new SecureTokenVault());
  const api = new ApiClient(environment.apiUrl, vault);
  const offline = new OfflineAccess(new SecureOfflineVault(), vault);
  const auth = new AuthStore(api, vault, offline, async owner => {
    await pendingDocumentCreates.discardOwner(owner);
    await discardDocumentQueue(owner);
    if (documentNative.available())
      await documentNative.command(owner, 'discardOwner');
  });
  const routes = new RouteStore(new TruckRoutingService(api), () =>
    trucks.invalidateFromRouting(),
  );
  const trucks = new TruckProfileStore(api, () => routes.clear());
  const location = new LocationService(new NativeLocationProvider());
  const guidance = new NativeGuidanceAdapter();
  const services = {
    environment,
    api,
    auth,
    routes,
    trucks,
    location,
    guidance,
    search: new SearchService(environment.mapboxToken),
    poi: new PoiService(api),
    settings: new SettingsService(api, writeAppearance, async settings => {
      const state = auth.getSnapshot();
      if (state.status === 'signedIn' && state.user)
        await offline.savePreferences(state.user.id, settings);
    }),
  };
  let accountId: string | null = null;
  auth.subscribe(() => {
    const state = auth.getSnapshot();
    const nextAccount =
      state.status === 'signedIn' ? state.user?.id ?? null : null;
    if (nextAccount === null || accountId !== nextAccount) {
      accountId = nextAccount;
      services.settings.clear();
      routes.clear();
      trucks.clear();
      void location.stop().catch(() => {});
      void guidance
        .stopNavigation()
        .catch(() => safeLog('GUIDANCE_STOP_FAILED'));
    }
  });
  return services;
}
export type Services = ReturnType<typeof createServices>;
