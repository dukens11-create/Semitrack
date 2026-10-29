import { CoPilotMapCatalog } from '../../components/CoPilotMapCatalog';
import { recordHybridFailure } from '../../services/copilot/HybridControlDiagnostics';
import { standardTruckNotice } from '../../services/copilot/StandardTruckNavigation';
import { FleetTruckProfiles } from '../../components/FleetTruckProfiles';
import { CoPilotDeviceSetup } from '../../components/CoPilotDeviceSetup';
import React, { useRef, useState } from 'react';
import { Modal, ScrollView, StyleSheet, View } from 'react-native';
import { TruckProfileScreen } from '../../screens/TruckProfileScreen';
import { WeatherStatus } from '../weather/WeatherStatus';
import {
  synchronizeHybridTruck,
  resumeHybridTrip,
  endHybridTrip,
  hybridError,
  HybridControlError,
  logHybridControl,
  type HybridAction,
} from '../../services/copilot/HybridControls';
import {
  DriverButton,
  DriverCopy,
  DriverTitle,
  useDriverPalette,
} from '../../components/DriverUI';
import {
  useCopilotState,
  useCopilotSetup,
} from '../../services/copilot/CopilotProvider';
import { coPilotHost } from '../../services/copilot/CoPilotHost';
import {
  engineTripLocations,
  engineTripProfileSchema,
  engineTripProfileSummary,
} from '../../services/copilot/EngineTrip';
import { EngineCopilotMap } from './EngineCopilotMap';
import type { Services } from '../../app/services';
import type { StopPlan } from '../stops/StopPlan';
import { useStore } from '../../hooks/useStore';
import { Alert } from '../../components/ThemedAlert';

/** Isolated live session: planner estimates never become live engine instructions. */
export function HybridNavigation({
  services,
  plan,
  onClose,
}: {
  services: Services;
  plan: StopPlan;
  onClose: () => void;
}) {
  const state = useCopilotState();
  const setup = useCopilotSetup();
  const [showSetup, setShowSetup] = useState(false);
  const [showMaps, setShowMaps] = useState(false);
  const controls = useRef<ScrollView>(null);
  const palette = useDriverPalette();
  const attempted = useRef(false);
  const location = useStore(services.location);
  const route = useStore(services.routes).route;
  const busy = useRef(false);
  const actionGeneration = useRef(0);
  const ending = useRef(false);
  const [live, setLive] = useState(false);
  const [settings, setSettings] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  async function run(
    action: () => Promise<void>,
    name: HybridAction = 'START_RESUME',
  ) {
    logHybridControl(name, 'PRESS');
    if ((busy.current && name !== 'END_ROUTE') || ending.current) {
      logHybridControl(name, 'BUSY');
      return;
    }
    const generation = ++actionGeneration.current;
    if (name === 'END_ROUTE') ending.current = true;
    busy.current = true;
    setPending(true);
    setError('');
    try {
      logHybridControl(name, 'VALIDATING');
      await action();
      logHybridControl(name, 'CONFIRMED');
    } catch (e) {
      setError(hybridError(e));
      recordHybridFailure(name, e);
      controls.current?.scrollTo({ y: 0, animated: true });
      Alert.alert('SemiTraX action could not complete', hybridError(e));
      logHybridControl(name, 'FAILED');
    } finally {
      if (generation === actionGeneration.current) {
        busy.current = false;
        ending.current = false;
        setPending(false);
      }
    }
  }
  async function start() {
    const host = coPilotHost();
    if (!state.readyToAddStops)
      throw new HybridControlError(
        'Complete the license, offline-map and GPS checks below before starting.',
      );
    await synchronizeHybridTruck(services, host);
    const resuming = await host.hasEngineTrip?.();
    const profile = resuming
      ? null
      : engineTripProfileSchema.parse(await host.reviewEngineTripProfile?.());
    Alert.alert(
      'Confirm standard truck navigation',
      `${
        profile ? engineTripProfileSummary(profile) + '\n\n' : ''
      }${standardTruckNotice}\n\nRouting uses your saved maximum weight. Confirm that this mode and the matched fleet profile are appropriate for this trip.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: resuming ? 'Confirm and Resume' : 'Confirm and Start',
          onPress: () => {
            void run(async () => {
              // Recheck saved settings and native readback after the driver confirmation.
              await synchronizeHybridTruck(services, host);
              if (!host.acceptStandardTruckMode)
                throw new Error('Navigation confirmation bridge unavailable.');
              await host.acceptStandardTruckMode();
              if (resuming) {
                await resumeHybridTrip(host);
                setLive(true);
                return;
              }
              const fix = services.location.getFreshFix();
              if (!fix)
                throw new HybridControlError(
                  'Wait for a fresh precise GPS location.',
                );
              if (!host.openEngineTrip || !profile)
                throw new Error('Navigation bridge unavailable.');
              attempted.current = true;
              logHybridControl('START_RESUME', 'NATIVE_CALL');
              await host.openEngineTrip(
                profile.ticket,
                engineTripLocations(
                  { lat: fix.latitude, lng: fix.longitude },
                  plan,
                ),
              );
              setLive(true);
            });
          },
        },
      ],
    );
  }
  async function close() {
    if (!state.initialized && !attempted.current) {
      onClose();
      return;
    }
    const host = coPilotHost();
    if (await host.hasEngineTrip?.())
      throw new HybridControlError('End Route before leaving this session.');
    await host.returnFromEngineTrip?.();
    onClose();
  }
  return (
    <Modal
      visible
      onRequestClose={() => {
        setLive(false);
        setSettings(false);
      }}
    >
      <View style={styles.screen}>
        {settings ? (
          <View style={styles.editor}>
            <DriverButton
              title="Back to SemiTraX controls"
              onPress={() => setSettings(false)}
            />
            <DriverCopy>
              {error ||
                'Save and verify your truck below, then check that it matches the assigned fleet profile. Unsupported configurations remain blocked.'}
            </DriverCopy>
            <DriverButton
              title="Synchronize truck with engine"
              disabled={pending}
              onPress={() => {
                void run(
                  () => synchronizeHybridTruck(services, coPilotHost()),
                  'SYNC_PROFILE',
                );
              }}
            />
            <TruckProfileScreen services={services} />
          </View>
        ) : (
          <ScrollView
            ref={controls}
            style={{ backgroundColor: palette.canvas }}
            contentContainerStyle={styles.controls}
          >
            <DriverTitle>SemiTraX Navigation</DriverTitle>
            <DriverCopy>Truck navigation</DriverCopy>
            <WeatherStatus
              services={services}
              route={route}
              fix={location.fix}
            />
            <DriverCopy>
              SemiTraX controls the navigation screen. Trimble calculates the
              truck route and supplies live directions. Start requires a
              matching assigned fleet profile and confirmation of the standard
              truck mode.
            </DriverCopy>
            <DriverCopy>
              {error ||
                (state.readyToAddStops
                  ? 'Engine setup is ready. Start will check your saved truck against the active fleet profile.'
                  : 'Navigation is waiting for the checks below.')}
            </DriverCopy>
            <DriverCopy>
              Engine: {state.initialized ? 'started' : 'not ready'} · Navigation
              license:{' '}
              {state.fullNavigationLicensed ? 'verified' : 'not verified'} ·
              Truck license:{' '}
              {state.heavyTruckLicensed ? 'verified' : 'not verified'}
            </DriverCopy>
            <DriverCopy>
              Offline map:{' '}
              {state.mapsReady
                ? 'setup region installed; use Manage offline maps for additional regions'
                : 'installation not verified'}
            </DriverCopy>
            {!!setup.downloadStatus && (
              <DriverCopy>{setup.downloadStatus}</DriverCopy>
            )}
            {!!state.operation && (
              <DriverCopy>Setup stage: {state.operation}</DriverCopy>
            )}
            {!!state.error && <DriverCopy>Status: {state.error}</DriverCopy>}
            <DriverButton title={showMaps ? 'Hide offline maps' : 'Manage offline maps'} onPress={() => setShowMaps(value => !value)} />
            {showMaps && <CoPilotMapCatalog />}
            <FleetTruckProfiles ready={state.readyToAddStops && !pending} />
            <DriverButton
              title="Check readiness"
              disabled={pending}
              onPress={() => {
                void run(setup.refresh, 'READINESS');
              }}
            />
            <DriverButton
              title={showSetup ? 'Hide setup details' : 'Open navigation setup'}
              onPress={() => setShowSetup(value => !value)}
            />
            {showSetup && <CoPilotDeviceSetup />}
            <DriverButton
              title="Start / Resume Navigation"
              disabled={pending}
              onPress={() => {
                void run(start);
              }}
            />
            <DriverButton
              title="Truck settings"
              disabled={pending}
              onPress={() => {
                void run(async () => {
                  if (
                    state.initialized &&
                    (await coPilotHost().hasEngineTrip?.())
                  )
                    throw new HybridControlError(
                      'End Route before changing the truck profile.',
                    );
                  setSettings(true);
                }, 'TRUCK_SETTINGS');
              }}
            />
            <DriverButton
              title="End Route"
              disabled={false}
              onPress={() =>
                Alert.alert(
                  'End navigation?',
                  'Stop engine guidance and return to the planner.',
                  [
                    { text: 'Keep driving', style: 'cancel' },
                    {
                      text: 'End Route',
                      style: 'destructive',
                      onPress: () => {
                        void run(async () => {
                          await endHybridTrip(coPilotHost(), services);
                          setLive(false);
                          onClose();
                        }, 'END_ROUTE');
                      },
                    },
                  ],
                )
              }
            />
            <DriverButton
              title="Back to planner"
              disabled={pending}
              onPress={() => {
                void run(close, 'BACK');
              }}
            />
          </ScrollView>
        )}
        {live && (
          <EngineCopilotMap
            onClose={() => setLive(false)}
            nearbyService={services.poi}
            fix={location.fix}
            weather={
              <WeatherStatus
                services={services}
                route={route}
                fix={location.fix}
                driving
              />
            }
          />
        )}
      </View>
    </Modal>
  );
}
const styles = StyleSheet.create({
  editor: { flex: 1 },
  screen: {
    flex: 1,
    paddingTop: 32,
    paddingBottom: 24,
    backgroundColor: '#172433',
  },
  controls: { flexGrow: 1, padding: 20, gap: 16, justifyContent: 'center' },
});
