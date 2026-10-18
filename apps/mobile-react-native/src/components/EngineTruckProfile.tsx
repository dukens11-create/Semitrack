import React, { useEffect, useState } from 'react';
import { AppState, Modal, ScrollView, View, StyleSheet } from 'react-native';
import {
  DriverButton,
  DriverCopy,
  DriverTitle,
  useDriverPalette,
} from './DriverUI';
import {
  readActiveTruckProfile,
  profileEnumLabel,
  type ActiveTruckProfile,
} from '../services/copilot/ActiveTruckProfile';
export function EngineTruckProfile({ onEdit }: { onEdit?: () => void }) {
  const p = useDriverPalette();
  const [open, setOpen] = useState(false);
  const [profile, setProfile] = useState<ActiveTruckProfile>();
  const [error, setError] = useState('');
  useEffect(() => {
    if (!open) return;
    let revision = 0;
    const refresh = () => {
      const id = ++revision;
      setProfile(undefined);
      setError('');
      void readActiveTruckProfile()
        .then(value => {
          if (id === revision) setProfile(value);
        })
        .catch(() => {
          if (id === revision)
            setError(
              'Active heavy-duty profile could not be read. Open engine settings and verify your selection.',
            );
        });
    };
    refresh();
    const sub = AppState.addEventListener('change', state => {
      ++revision;
      setProfile(undefined);
      if (state === 'active') refresh();
    });
    return () => {
      ++revision;
      sub.remove();
    };
  }, [open]);
  return (
    <>
      <DriverButton title="Truck" secondary onPress={() => setOpen(true)} />
      <Modal
        visible={open}
        transparent
        animationType="slide"
        onRequestClose={() => setOpen(false)}
      >
        <View
          style={styles.backdrop}
        >
          <ScrollView
            style={[styles.panel, { backgroundColor: p.card }]}
            contentContainerStyle={styles.content}
          >
            <DriverTitle small>SemiTraX truck engine</DriverTitle>
            {profile ? (
              <>
                <DriverTitle small>{profile.name}</DriverTitle>
                <DriverCopy>
                  Heavy-duty truck · active engine profile
                </DriverCopy>
                <DriverCopy>{`Height ${(profile.dims.height / 12).toFixed(
                  2,
                )} ft · Width ${profile.dims.width} in · Length ${(
                  profile.dims.length / 12
                ).toFixed(2)} ft`}</DriverCopy>
                <DriverCopy>{`Weight ${profile.dims.totalWeight.toLocaleString()} lb · Per axle ${profile.dims.weightPerAxle.toLocaleString()} lb`}</DriverCopy>
                {(
                  [
                    ['RoutingType', 'routingType', 'Routing'],
                    ['HazmatType', 'hazmatType', 'Hazmat'],
                    ['TollRoads', 'tollRoads', 'Tolls'],
                    [
                      'DisplayTruckRestrictions',
                      'displayTruckRestriction',
                      'Map restrictions',
                    ],
                  ] as const
                ).map(([module, key, label]) => (
                  <DriverCopy key={key}>
                    {label}: {profileEnumLabel(module, profile[key])}
                  </DriverCopy>
                ))}
                <DriverCopy>
                  Discourage ferries:{' '}
                  {profile.ferriesDiscouraged === undefined
                    ? 'Not supplied'
                    : profile.ferriesDiscouraged
                    ? 'On'
                    : 'Off'}
                </DriverCopy>
                <DriverCopy>
                  International borders:{' '}
                  {profile.internationalBordersOpen === undefined
                    ? 'Not supplied'
                    : profile.internationalBordersOpen
                    ? 'Allowed'
                    : 'Avoid'}
                </DriverCopy>
                <DriverCopy>
                  Governor:{' '}
                  {profile.governor === undefined
                    ? 'Not supplied'
                    : `${profile.governor} mph`}
                </DriverCopy>
                <DriverCopy>
                  Elevation threshold:{' '}
                  {profile.elevation === undefined
                    ? 'Not supplied'
                    : `${(profile.elevation / 30.48).toFixed(0)} ft`}
                </DriverCopy>
                <DriverCopy>
                  Engine settings readback. This does not confirm that the
                  current SemiTraX route uses this profile or that guidance has
                  started.
                </DriverCopy>
              </>
            ) : (
              <DriverCopy>{error || 'Reading engine profile…'}</DriverCopy>
            )}
            {onEdit && (
              <DriverButton
                title="Edit engine settings"
                onPress={() => {
                  setOpen(false);
                  onEdit();
                }}
              />
            )}
            <DriverButton
              title="Close"
              secondary
              onPress={() => setOpen(false)}
            />
          </ScrollView>
        </View>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({backdrop: {flex: 1, backgroundColor: '#0008', justifyContent: 'flex-end'}, panel: {maxHeight: '80%'}, content: {padding: 20, gap: 12}});
