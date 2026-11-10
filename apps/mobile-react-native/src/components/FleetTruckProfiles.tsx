import React, { useRef, useState } from 'react';
import { View } from 'react-native';
import { DriverButton, DriverCopy } from './DriverUI';
import { Alert } from './ThemedAlert';
import { coPilotHost } from '../services/copilot/CoPilotHost';
import {
  readFleetTruckProfiles,
  selectFleetTruckProfile,
  type FleetTruckProfile,
} from '../services/copilot/FleetTruckProfiles';

export function FleetTruckProfiles({ ready }: { ready: boolean }) {
  const lock = useRef(false);
  const [busy, setBusy] = useState(false);
  const [profiles, setProfiles] = useState<FleetTruckProfile[]>([]);
  const [message, setMessage] = useState('');
  async function check() {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setProfiles([]);
    setMessage('');
    try {
      const found = await readFleetTruckProfiles(coPilotHost());
      setProfiles(found);
      setMessage(
        found.length
          ? 'Downloaded heavy-duty fleet profiles:'
          : 'No downloaded heavy-duty fleet profile was found. An Account Manager assignment alone does not confirm it has reached this phone.',
      );
    } catch {
      setMessage(
        'Could not read fleet profiles. Check engine readiness and use the matching app build.',
      );
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  async function select(profile: FleetTruckProfile) {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    try {
      const active = await selectFleetTruckProfile(coPilotHost(), profile);
      setProfiles([{ ...active, ticket: '' }]);
      setMessage(
        `${active.name} is active in CoPilot. Use Start / Resume to check your saved truck and review the standard navigation mode. Guidance has not started.`,
      );
    } catch {
      setProfiles([]);
      setMessage(
        'Selection could not be verified. End any engine trip and check fleet profiles again. The profile may have changed; guidance has not started.',
      );
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  return (
    <View>
      <DriverButton
        title="Check assigned fleet profiles"
        disabled={!ready || busy}
        onPress={() => {
          void check();
        }}
      />
      {!!message && <DriverCopy>{message}</DriverCopy>}
      {profiles.map(profile => (
        <View key={profile.name}>
          <DriverCopy>{`${profile.name}${
            profile.active ? ' · Active' : ''
          }\nHeight ${profile.heightInches} in · Width ${
            profile.widthInches
          } in\nSDK length ${profile.lengthInches} in · Total weight ${
            profile.weightLbs
          } lb\nMaximum axle-group weight ${
            profile.weightPerAxleLbs
          } lb`}</DriverCopy>
          <DriverCopy>
            Read from CoPilot. This SDK does not expose separate overall length
            or trailer count here. These values do not certify all truck
            restrictions.
          </DriverCopy>
          {!profile.active && !!profile.ticket && (
            <DriverButton
              title={`Select ${profile.name}`}
              disabled={!ready || busy}
              onPress={() =>
                Alert.alert(
                  'Select downloaded fleet profile?',
                  `Use ${profile.name} exactly as downloaded from Account Manager? This changes the engine's active profile. It does not start navigation or verify unsupported restrictions.`,
                  [
                    { text: 'Cancel', style: 'cancel' },
                    {
                      text: 'Select profile',
                      onPress: () => {
                        void select(profile);
                      },
                    },
                  ],
                )
              }
            />
          )}
        </View>
      ))}
    </View>
  );
}
