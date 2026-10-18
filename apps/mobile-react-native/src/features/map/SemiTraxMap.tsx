import React, {useState} from 'react';
import {StyleSheet, View} from 'react-native';
import {TruckMap} from './TruckMap';
import type {CopilotMapProps} from './CopilotTruckMap';
import {CopilotOfflineMap} from '../../components/CopilotOfflineMap';
import {useCopilotState} from '../../services/copilot/CopilotProvider';
import {DrivingNearbyOverlay} from '../navigation/DrivingNearbyOverlay';

/** Keep the licensed native engine attached while Mapbox owns the visible map. */
export function SemiTraxMap(props: CopilotMapProps & {token: string; satellite: boolean; onToggleSatellite: () => void}) {
  const state = useCopilotState();
  const [height, setHeight] = useState(0);
  const top = props.topInset ?? 56;
  const bottom = props.bottomInset ?? 0;
  return <View style={styles.fill} onLayout={event => setHeight(event.nativeEvent.layout.height)}>
    <CopilotOfflineMap state={state}/>
    {!props.settingsOpen && state.readyToAddStops && <View style={StyleSheet.absoluteFill}>
      <TruckMap {...props}/>
      {props.nearbyService && <View pointerEvents="box-none" style={[styles.nearby, {top, maxHeight: Math.max(42, height-top-bottom-12)}]}>
        <DrivingNearbyOverlay service={props.nearbyService} fix={props.fix} active={props.active ?? true} availableHeight={height-top-bottom-12} onSelect={props.onPoi}/>
      </View>}
    </View>}
  </View>;
}
const styles = StyleSheet.create({fill:{flex:1},nearby:{position:'absolute',left:10,right:72,alignItems:'flex-start'}});
