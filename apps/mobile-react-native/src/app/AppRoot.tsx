import { AppErrorBoundary } from '../components/AppErrorBoundary';
import { safeLog } from '../services/telemetry/safeLog';
import React, { useEffect, useState } from 'react';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { useDriverPalette } from '../components/DriverUI';
import { StatusBar, StyleSheet, View } from 'react-native';
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
import { ApplicationAppearance } from '../features/settings/ApplicationAppearance';
import { ThemedAlertHost } from '../components/ThemedAlert';
import { AppNavigator } from '../navigation/AppNavigator';
import { CopilotStatus } from '../components/CopilotStatus';
import { DriverSetupGate } from '../features/onboarding/DriverSetup';
import { OfflineAccountScreen } from '../screens/OfflineAccountScreen';
function SessionFrame({ children }: React.PropsWithChildren) {
  const p = useDriverPalette();
  return (
    <SafeAreaView style={[styles.fill, { backgroundColor: p.canvas }]}>
      <CopilotStatus />
      {children}
    </SafeAreaView>
  );
}
function Session({ services }: { services: Services }) {
  const auth = useStore(services.auth);
  useEffect(() => {
    return () => {
      void services.location.stop().catch(() => {});
    };
  }, [services]);
  if (auth.status === 'loading') {
    return <BrandedSplash />;
  }
  if (auth.status === 'offline') {
    return <SessionFrame><OfflineAccountScreen auth={services.auth} /></SessionFrame>;
  }
  if (auth.status === 'unavailable') {
    return (
      <SessionFrame>
        <Page>
          <Heading>Connection unavailable</Heading>
          <Copy>{auth.error}</Copy>
          {!!auth.offline && <Button title="View saved preferences offline" onPress={() => {
            void services.auth.openOffline();
          }} />}
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
      </SessionFrame>
    );
  }
  return auth.status === 'signedIn' ? (
    <>
      <SessionFrame>
        <DriverSetupGate key={auth.user?.id} settings={services.settings}>
          <AppNavigator services={services} />
        </DriverSetupGate>
      </SessionFrame>
    </>
  ) : (
    <SessionFrame>
      <AuthScreen services={services} />
    </SessionFrame>
  );
}
function ApplicationFrame({ children }: React.PropsWithChildren) {
  const p = useDriverPalette();
  return (
    <View style={[styles.fill, { backgroundColor: p.canvas }]}>
      <StatusBar
        barStyle={p.dark ? 'light-content' : 'dark-content'}
        backgroundColor={p.canvas}
      />
      {children}
      <ThemedAlertHost />
    </View>
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
  const content = (
    <ApplicationFrame>
      <View style={styles.fill}>
        <AppErrorBoundary
          onFailure={() => {
            state.services?.routes.clear();
            void state.services?.guidance
              .stopNavigation()
              .catch(() => safeLog('GUIDANCE_STOP_FAILED'));
            void state.services?.location
              .stop()
              .catch(() => safeLog('NATIVE_CALLBACK_INVALID'));
          }}
        >
          {state.services ? (
            <Session services={state.services} />
          ) : (
            <Page>
              <Heading>Configuration required</Heading>
              <Copy>{state.error}</Copy>
            </Page>
          )}
        </AppErrorBoundary>
      </View>
    </ApplicationFrame>
  );
  return (
    <SafeAreaProvider>
      {
        <ApplicationAppearance services={state.services}>
          {content}
        </ApplicationAppearance>
      }
    </SafeAreaProvider>
  );
}
const styles = StyleSheet.create({
  fill: { flex: 1 },
});
