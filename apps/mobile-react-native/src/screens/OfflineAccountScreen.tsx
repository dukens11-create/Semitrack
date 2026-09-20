import React, { useEffect } from 'react';
import { AppState, BackHandler } from 'react-native';
import type { AuthStore } from '../features/auth/AuthStore';
import { useStore } from '../hooks/useStore';
import { DriverPage, DriverTitle, DriverCopy, DriverCard, DriverButton } from '../components/DriverUI';
/** Does not mount navigation, account editors, maps or any provider service. */
export function OfflineAccountScreen({auth}: {auth: AuthStore}) {
  const state = useStore(auth), snapshot = state.offline;
  useEffect(() => {
    const back = BackHandler.addEventListener('hardwareBackPress', () => {
      auth.closeOffline(); return true;
    });
    const lifecycle = AppState.addEventListener('change', next => {
      if (next === 'active') void auth.recheckOffline();
    });
    const timeout = setTimeout(() => { void auth.recheckOffline(); },
      Math.max(0, (snapshot?.expiresAt ?? Date.now()) - Date.now()));
    return () => { back.remove(); lifecycle.remove(); clearTimeout(timeout); };
  }, [auth, snapshot?.expiresAt]);
  const preferences = snapshot?.preferences;
  return (
    <DriverPage>
      <DriverTitle>Offline view</DriverTitle>
      <DriverCopy>
        Read-only saved preferences. Your account and permissions have not
        been verified online. Routing, navigation and account changes are unavailable.
      </DriverCopy>
      <DriverCard>
        <DriverTitle small>Saved preferences</DriverTitle>
        {preferences ? <>
          <DriverCopy>Distance: {preferences.units === 'metric' ? 'Kilometers' : 'Miles'}</DriverCopy>
          <DriverCopy>Temperature: °{preferences.temperatureUnit}</DriverCopy>
          <DriverCopy>Appearance: {preferences.dayNightMode === 'system' ? 'Automatic' : preferences.dayNightMode === 'day' ? 'Day' : 'Night'}</DriverCopy>
          {snapshot.preferencesSavedAt !== null && <DriverCopy>Saved on this device: {new Date(snapshot.preferencesSavedAt).toLocaleString()}</DriverCopy>}
        </> : <DriverCopy>No saved preferences are available on this device.</DriverCopy>}
      </DriverCard>
      <DriverCopy>
        This view expires within 24 hours of the last online account check.
        It contains no saved routes, locations, documents or truck verification.
        Reconnect to see current account data or make changes.
      </DriverCopy>
      <DriverButton title="Reconnect and verify account" onPress={() => { void auth.restore(); }} />
      <DriverButton title="Back" secondary onPress={() => auth.closeOffline()} />
      <DriverButton title="Sign out on this device" secondary onPress={() => { void auth.logout(); }} />
    </DriverPage>
  );
}
