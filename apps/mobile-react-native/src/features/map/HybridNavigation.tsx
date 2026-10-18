import { CoPilotDeviceSetup } from '../../components/CoPilotDeviceSetup';
import React, {useRef, useState} from 'react';
import {Modal, ScrollView, StyleSheet, View} from 'react-native';
import {CopilotOfflineMap} from '../../components/CopilotOfflineMap';
import {DriverButton, DriverCopy, DriverTitle, useDriverPalette} from '../../components/DriverUI';
import {useCopilotState, useCopilotSetup} from '../../services/copilot/CopilotProvider';
import {coPilotHost} from '../../services/copilot/CoPilotHost';
import {engineTripLocations, engineTripProfileSchema, engineTripProfileSummary} from '../../services/copilot/EngineTrip';
import {EngineMapboxProof} from './EngineMapboxProof';
import type {Services} from '../../app/services';
import type {StopPlan} from '../stops/StopPlan';
import {useStore} from '../../hooks/useStore';
import {Alert} from '../../components/ThemedAlert';

/** Isolated live session: planner estimates never become live engine instructions. */
export function HybridNavigation({services, plan, onClose}: {services: Services; plan: StopPlan; onClose: () => void}) {
  const state = useCopilotState();
  const setup = useCopilotSetup();
  const [showSetup, setShowSetup] = useState(false);
  const palette = useDriverPalette();
  const attempted = useRef(false);
  const location = useStore(services.location);
  const [live, setLive] = useState(false);
  const [settings, setSettings] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  async function run(action: () => Promise<void>) {
    if (pending) return;
    setPending(true); setError('');
    try { await action(); } catch (e) {setError(e instanceof Error ? e.message : 'The navigation engine could not confirm this action.');}
    finally {setPending(false);}
  }
  async function start() {
    const host = coPilotHost();
    if (await host.hasEngineTrip?.()) {setLive(true); return;}
    const profile = engineTripProfileSchema.parse(await host.reviewEngineTripProfile?.());
    Alert.alert('Confirm navigation truck', `${engineTripProfileSummary(profile)}\n\nThese are the engine’s active dimensions. Its hazmat and routing preferences also apply. Confirm they match your truck before starting.`, [
      {text:'Cancel', style:'cancel'},
      {text:'Start Navigation', onPress: () => {void run(async () => {
        const fix = services.location.getFreshFix();
        if (!fix) throw new Error('Wait for a fresh precise GPS location.');
        if (!host.openEngineTrip) throw new Error('Navigation bridge unavailable.');
        attempted.current = true;
        await host.openEngineTrip(profile.ticket, engineTripLocations({lat:fix.latitude,lng:fix.longitude},plan));
        setLive(true);
      });}},
    ]);
  }
  async function close() {
    if (!state.readyToAddStops && !attempted.current) {onClose(); return;}
    const host = coPilotHost();
    if (await host.hasEngineTrip?.()) throw new Error('End Route before leaving this session.');
    await host.returnFromEngineTrip?.();
    onClose();
  }
  return <Modal visible onRequestClose={() => {setLive(false); setSettings(false);}}>
    <View style={styles.screen}>
      <View style={StyleSheet.absoluteFill}><CopilotOfflineMap state={state}/></View>
      {settings ? <DriverButton title="Back to SemiTraX controls" onPress={() => setSettings(false)}/> :
        <ScrollView style={{backgroundColor:palette.canvas}} contentContainerStyle={styles.controls}>
          <DriverTitle>SemiTraX Navigation</DriverTitle>
          <DriverCopy>Truck navigation</DriverCopy>
          <DriverCopy>{error || (state.readyToAddStops ? 'Review the engine truck profile before starting.' : 'Navigation is waiting for the checks below.')}</DriverCopy>
          {!state.readyToAddStops && <>
            <DriverCopy>Engine: {state.initialized ? 'started' : 'not ready'} · Navigation license: {state.fullNavigationLicensed ? 'verified' : 'not verified'} · Truck license: {state.heavyTruckLicensed ? 'verified' : 'not verified'}</DriverCopy>
            <DriverCopy>Offline map: {state.mapsReady ? 'verified installed' : 'installation not verified'}</DriverCopy>
            {!!setup.downloadStatus && <DriverCopy>{setup.downloadStatus}</DriverCopy>}
            {!!state.operation && <DriverCopy>Setup stage: {state.operation}</DriverCopy>}
            {!!state.error && <DriverCopy>Status: {state.error}</DriverCopy>}
            <DriverButton title="Check readiness" disabled={pending} onPress={() => {void run(setup.refresh);}}/>
            <DriverButton title={showSetup ? 'Hide setup details' : 'Open navigation setup'} onPress={() => setShowSetup(value => !value)}/>
            {showSetup && <CoPilotDeviceSetup/>}
          </>}
          <DriverButton title="Start / Resume Navigation" disabled={pending || !state.readyToAddStops} onPress={() => {void run(start);}}/>
          <DriverButton title="Truck settings" disabled={pending || !state.readyToAddStops} onPress={() => {void run(async () => {await coPilotHost().mapCommand('settings');setSettings(true);});}}/>
          <DriverButton title="End Route" disabled={pending || !state.readyToAddStops} onPress={() => Alert.alert('End navigation?', 'Stop engine guidance and return to the planner.', [{text:'Keep driving',style:'cancel'},{text:'End Route',style:'destructive',onPress:()=>{void run(async()=>{const host=coPilotHost();if(!host.endEngineTrip)throw new Error('Stop control unavailable.');await host.endEngineTrip();onClose();});}}])}/>
          <DriverButton title="Back to planner" disabled={pending} onPress={() => {void run(close);}}/>
        </ScrollView>}
      {live && <EngineMapboxProof token={services.environment.mapboxToken} onClose={() => setLive(false)} nearbyService={services.poi} fix={location.fix}/>}
    </View>
  </Modal>;
}
const styles = StyleSheet.create({screen:{flex:1,paddingTop:32,paddingBottom:24,backgroundColor:'#172433'},controls:{flexGrow:1,backgroundColor:'#FFFFFF',padding:20,gap:16,justifyContent:'center'}});
