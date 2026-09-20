import React, { useEffect, useRef, useState } from 'react';
import { Linking } from 'react-native';
import NativePlatform from '../../native/navigation/NativeSemiTraxPlatform';
import { useStore } from '../../hooks/useStore';
import type { SettingsService } from '../settings/SettingsService';
import {
  DriverButton,
  DriverCard,
  DriverCopy,
  DriverPage,
  DriverTitle,
} from '../../components/DriverUI';

export function hasReviewedDriverSetup(
  settingsJson: Record<string, unknown> | null | undefined,
) {
  const value = settingsJson?.driverSetup;
  return (
    !!value &&
    typeof value === 'object' &&
    (value as Record<string, unknown>).version === 1 &&
    (value as Record<string, unknown>).reviewed === true
  );
}
const permissionLabel = (status: string) =>
  ({
    granted:
      'Location permission granted. A fresh, precise fix is still required for routing.',
    denied:
      'Location permission denied. You can change this in device settings.',
    blocked:
      'Location permission blocked. You can change this in device settings.',
    unavailable: 'Location permission is unavailable in this environment.',
  }[status] ?? 'Location permission status is unknown.');

/** Setup review is not legal consent, truck verification, or CoPilot activation. */
export function DriverSetup({
  settings,
  onContinue,
}: {
  settings: SettingsService;
  onContinue: () => void;
}) {
  const state = useStore(settings);
  const [permission, setPermission] = useState('unknown');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const locked = useRef(false),
    live = useRef(true);
  useEffect(() => {
    live.current = true;
    void NativePlatform?.locationPermissionStatus()
      .then(status => {
        if (live.current) setPermission(status);
      })
      .catch(() => {
        if (live.current) setPermission('unavailable');
      });
    return () => {
      live.current = false;
    };
  }, []);
  async function requestPermission() {
    if (locked.current) return;
    locked.current = true;
    setBusy(true);
    setNotice('');
    try {
      const status = await NativePlatform?.requestLocationPermission(false);
      if (live.current) setPermission(status ?? 'unavailable');
    } catch {
      if (live.current) setPermission('unavailable');
    } finally {
      locked.current = false;
      if (live.current) setBusy(false);
    }
  }
  async function finish() {
    if (locked.current || !state.settings) return;
    locked.current = true;
    setBusy(true);
    setNotice('');
    try {
      const saved = await settings.save({
        ...state.settings,
        settingsJson: {
          ...state.settings.settingsJson,
          driverSetup: { version: 1, reviewed: true },
        },
      });
      if (live.current && saved && hasReviewedDriverSetup(saved.settingsJson))
        onContinue();
      else if (live.current)
        setNotice('Setup was not confirmed. Retry when connected.');
    } catch {
      if (live.current)
        setNotice('Could not save setup. Retry when connected.');
    } finally {
      locked.current = false;
      if (live.current) setBusy(false);
    }
  }
  return (
    <>
      <DriverTitle small>Get ready for your first route</DriverTitle>
      <DriverCard>
        <DriverTitle small>Your truck comes first</DriverTitle>
        <DriverCopy>
          Add or review your truck in More, then Manage / add truck. Use its actual
          height, width, length, weight, axles, trailer and hazardous cargo.
          Reviewing this setup does not verify a truck or make a route safe.
        </DriverCopy>
      </DriverCard>
      <DriverCard>
        <DriverTitle small>Location and privacy</DriverTitle>
        <DriverCopy>
          Precise location shows your truck and supplies the route origin.
          Searches and route requests send the locations needed for that action
          to the configured services. This step does not start tracking or
          request background location. Permission is optional until a
          location-dependent action.
        </DriverCopy>
        <DriverCopy>{permissionLabel(permission)}</DriverCopy>
        {permission !== 'granted' ? (
          <DriverButton
            title="Allow location while using the app"
            secondary
            disabled={busy || !NativePlatform}
            onPress={() => {
              void requestPermission();
            }}
          />
        ) : null}
        <DriverButton
          title="Open device permissions"
          secondary
          disabled={busy}
          onPress={() => {
            void Linking.openSettings().catch(() => {
              if (live.current)
                setNotice(
                  'Open your device settings to manage SemiTraX permissions.',
                );
            });
          }}
        />
        <DriverCopy>
          You can manage permission in device settings and stop location updates
          from Map. A published privacy policy is not yet available in this
          version. This setup review is not consent to an unpublished policy.
        </DriverCopy>
      </DriverCard>
      <DriverCard>
        <DriverTitle small>Planning and live guidance</DriverTitle>
        <DriverCopy>
          Trimble supplies commercial truck route planning. A route preview is
          not live guidance. CoPilot navigation requires the supported native
          integration, license and maps. Unsupported or unproven routes stay
          blocked. Always follow posted restrictions and confirm truck access.
        </DriverCopy>
      </DriverCard>
      {!!notice && <DriverCopy>{notice}</DriverCopy>}
      {!state.settings && (
        <>
          <DriverCopy>
            Connect to load preferences before saving this review.
          </DriverCopy>
          <DriverButton
            title="Retry setup preferences"
            secondary
            disabled={state.phase === 'loading'}
            onPress={() => {
              void settings.load().catch(() => {});
            }}
          />
        </>
      )}
      <DriverButton
        title="Finish setup"
        disabled={busy || !state.settings || state.phase === 'saving'}
        onPress={() => {
          void finish();
        }}
      />
      <DriverButton
        title="Continue for now"
        secondary
        disabled={busy}
        onPress={onContinue}
      />
      <DriverCopy>
        Continuing for now does not mark setup reviewed. Reopen Driver setup in
        Settings at any time.
      </DriverCopy>
    </>
  );
}

export function DriverSetupGate({
  settings,
  children,
}: React.PropsWithChildren<{ settings: SettingsService }>) {
  const state = useStore(settings);
  const [continued, setContinued] = useState(false);
  useEffect(() => {
    void settings.load().catch(() => {});
  }, [settings]);
  if (continued || hasReviewedDriverSetup(state.settings?.settingsJson))
    return <>{children}</>;
  if (
    !state.settings &&
    (state.phase === 'idle' || state.phase === 'loading')
  ) {
    return (
      <DriverPage>
        <DriverTitle>Driver setup</DriverTitle>
        <DriverCopy>Loading your saved setup...</DriverCopy>
      </DriverPage>
    );
  }
  return (
    <DriverPage>
      <DriverTitle>Driver setup</DriverTitle>
      <DriverSetup settings={settings} onContinue={() => setContinued(true)} />
    </DriverPage>
  );
}
