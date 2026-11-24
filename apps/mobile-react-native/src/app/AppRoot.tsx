import { AppErrorBoundary } from '../components/AppErrorBoundary';
import { safeLog } from '../services/telemetry/safeLog';
import React, { useEffect, useState } from 'react';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { StyleSheet } from 'react-native';
import { createEnvironment } from '../config/environment';
import {
  apiUrl,
  mapboxToken,
  configurationDiagnostics,
} from '../config/generated';
import { reportRuntimeConfiguration } from '../config/runtimeDiagnostics';
import { createServices, type Services } from './services';
import { useStore } from '../hooks/useStore';
import { Page, Heading, Copy, Button } from '../components/ui';
import { BrandedSplash } from '../components/BrandedSplash';
import { AuthScreen } from '../screens/AuthScreen';
import { DriverPreferences } from '../features/settings/DriverPreferences';
import { AppNavigator } from '../navigation/AppNavigator';
import { CopilotStatus } from '../components/CopilotStatus';
function Session({ services }: { services: Services }) {
  const auth = useStore(services.auth);
  useEffect(() => {
    void services.auth.restore();
    return () => {
      void services.location.stop().catch(() => {});
    };
  }, [services]);
  if (auth.status === 'loading') {
    return <BrandedSplash />;
  }
  if (auth.status === 'unavailable') {
    return (
      <Page>
        <Heading>Connection unavailable</Heading>
        <Copy>{auth.error}</Copy>
        <Button
          title="Retry"
          onPress={() => {
            void services.auth.restore();
          }}
        />
        <Button
          title="Sign out on this device"
          onPress={() => {
            void services.auth.logout();
          }}
        />
      </Page>
    );
  }
  return auth.status === 'signedIn' ? (
    <DriverPreferences key={auth.user?.id} services={services}>
      <AppNavigator services={services} />
    </DriverPreferences>
  ) : (
    <AuthScreen services={services} />
  );
}
export function AppRoot() {
  const [state] = useState(() => {
    try {
      return {
        services: createServices(
          createEnvironment(apiUrl, mapboxToken, !__DEV__),
        ),
      };
    } catch {
      return {
        error:
          'SemiTraX is not configured. Set SEMITRAX_API_URL to the approved backend and generate the environment before building.',
      };
    }
  });
  useEffect(() => {
    if (!configurationDiagnostics) return;
    if (state.services) {
      void reportRuntimeConfiguration(state.services.environment);
    } else {
      console.warn(
        '[SemiTraX configuration] Environment validation or service initialization failed.',
      );
    }
  }, [state]);
  return (
    <SafeAreaProvider>
      <SafeAreaView style={styles.fill}>
        <AppErrorBoundary onFailure={() => {
          state.services?.routes.clear();
          void state.services?.guidance.stopNavigation().catch(() => safeLog('GUIDANCE_STOP_FAILED'));
          void state.services?.location.stop().catch(() => safeLog('NATIVE_CALLBACK_INVALID'));
        }}>
        <CopilotStatus />
        {state.services ? (
          <Session services={state.services} />
        ) : (
          <Page>
            <Heading>Configuration required</Heading>
            <Copy>{state.error}</Copy>
          </Page>
        )}
        </AppErrorBoundary>
      </SafeAreaView>
    </SafeAreaProvider>
  );
}
const styles = StyleSheet.create({
  fill: { flex: 1, backgroundColor: '#0C131B' },
});
