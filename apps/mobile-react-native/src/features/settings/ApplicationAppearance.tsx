import { Store } from '../../state/Store';
const noSession = new Store({ status: 'signedOut' });
import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  Text,
  View,
  StyleSheet,
} from 'react-native';
import type { Services } from '../../app/services';
import { useStore } from '../../hooks/useStore';
import { DriverPreferences } from './DriverPreferences';
import { readAppearance } from './AppearanceStorage';
import type { AppearanceMode } from './automaticAppearance';
export function ApplicationAppearance({
  services,
  children,
}: React.PropsWithChildren<{ services?: Services }>) {
  const auth = useStore(services?.auth ?? noSession);
  const [snapshot, setSnapshot] = useState<{ mode: AppearanceMode | null }>();
  const [failed, setFailed] = useState(false);
  async function hydrate() {
    try {
      setSnapshot({ mode: await readAppearance() });
      setFailed(false);
    } catch {
      setFailed(true);
    }
  }
  useEffect(() => {
    void hydrate();
    void services?.auth.restore();
  }, [services]);
  // A neutral frame, never an incorrect Day/Night application frame.
  if (!snapshot || (auth.status === 'loading' && !snapshot.mode))
    return (
      <View
        accessibilityLabel="Loading saved appearance"
        style={styles.loading}
      >
        {failed ? (
          <Pressable
            accessibilityRole="button"
            onPress={() => {
              void hydrate();
            }}
          >
            <Text style={styles.text}>Retry saved appearance</Text>
          </Pressable>
        ) : (
          <ActivityIndicator color="#FFFFFF" />
        )}
      </View>
    );
  return (
    <DriverPreferences
      services={services}
      startup={{
        mode: snapshot.mode,
        authenticated: auth.status === 'signedIn',
      }}
    >
      {children}
    </DriverPreferences>
  );
}

const styles = StyleSheet.create({
  loading: {
    flex: 1,
    backgroundColor: '#40464C',
    alignItems: 'center',
    justifyContent: 'center',
  },
  text: { color: '#FFFFFF' },
});
