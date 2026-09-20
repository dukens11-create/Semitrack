import { useDriverPalette } from '../../components/DriverUI';
import React from 'react';
import {
  Pressable,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from 'react-native';
import { DriverIcon, type DriverIconName } from '../../components/DriverIcon';
import type { NavigationState } from '../../services/guidance/NavigationEngine';
export type NavigationMenuAction =
  | 'overview'
  | 'weather'
  | 'satellite'
  | 'recenter'
  | 'places'
  | 'filter'
  | 'search'
  | 'options'
  | 'audio'
  | 'share'
  | 'report'
  | 'continue'
  | 'reroute'
  | 'truck'
  | 'location'
  | 'warnings';
type Action = {
  action: NavigationMenuAction;
  title: string;
  caption: string;
  icon: DriverIconName;
  color: string;
};
const quick: Action[] = [
  {
    action: 'reroute',
    title: 'Reroute',
    caption: 'Review a truck-safe path',
    icon: 'replay',
    color: '#FF6B2C',
  },
  {
    action: 'places',
    title: 'POI Ahead',
    caption: 'Stops along this route',
    icon: 'add_location',
    color: '#24C89C',
  },
  {
    action: 'search',
    title: 'Search Places',
    caption: 'Add a destination or stop',
    icon: 'search_rounded',
    color: '#62B3FF',
  },
  {
    action: 'report',
    title: 'Report',
    caption: 'Share a road or safety issue',
    icon: 'warning_amber_rounded',
    color: '#F6BB5B',
  },
  {
    action: 'filter',
    title: 'Places Filter',
    caption: 'Choose visible stop types',
    icon: 'filter_list',
    color: '#A58AFF',
  },
  {
    action: 'share',
    title: 'Share Trip',
    caption: 'Share the planned route summary',
    icon: 'share',
    color: '#42BFDA',
  },
  {
    action: 'options',
    title: 'Route Options',
    caption: 'Review route preferences',
    icon: 'route_rounded',
    color: '#FF6B2C',
  },
];
const setup: Action[] = [
  {
    action: 'weather',
    title: 'Weather',
    caption: 'Review current weather and available alerts',
    icon: 'warning_amber_rounded',
    color: '#62B3FF',
  },
  {
    action: 'satellite',
    title: 'Satellite map',
    caption: 'Switch map imagery',
    icon: 'satellite',
    color: '#42BFDA',
  },
  {
    action: 'warnings',
    title: 'Road Warnings',
    caption: 'Review current provider advisories',
    icon: 'warning_amber_rounded',
    color: '#F6BB5B',
  },
  {
    action: 'overview',
    title: 'Route Overview',
    caption: 'See the complete truck route',
    icon: 'map_outlined',
    color: '#62B3FF',
  },
  {
    action: 'recenter',
    title: 'Recenter',
    caption: 'Follow your truck position',
    icon: 'my_location_rounded',
    color: '#42BFDA',
  },
  {
    action: 'audio',
    title: 'Audio Settings',
    caption: 'Voice and sound preferences',
    icon: 'volume_up',
    color: '#A58AFF',
  },
  {
    action: 'truck',
    title: 'Truck Profile',
    caption: 'Dimensions and restrictions',
    icon: 'local_shipping_rounded',
    color: '#FF6B2C',
  },
  {
    action: 'location',
    title: 'Location status',
    caption: 'GPS accuracy and permissions',
    icon: 'my_location_rounded',
    color: '#24C89C',
  },
];
export function NavigationMenu({
  phase,
  onAction,
}: {
  phase: NavigationState['phase'];
  onAction: (action: NavigationMenuAction) => void;
}) {
  const p = useDriverPalette();
  const { width, fontScale } = useWindowDimensions();
  const single = width < 340 || fontScale > 1.3;
  const grid = (items: Action[]) => (
    <View
      style={[styles.grid, { backgroundColor: p.card, borderColor: p.border }]}
    >
      {items.map(item => (
        <Pressable
          key={item.title}
          accessibilityRole="button"
          accessibilityLabel={item.title}
          accessibilityHint={item.caption}
          onPress={() => onAction(item.action)}
          style={[
            styles.tile,
            { backgroundColor: p.input },
            single && styles.single,
          ]}
        >
          <View style={[styles.icon, { backgroundColor: item.color + '22' }]}>
            <DriverIcon name={item.icon} color={item.color} size={25} />
          </View>
          <View style={styles.copy}>
            <Text style={[styles.tileTitle, { color: p.text }]}>
              {item.title}
            </Text>
            <Text style={[styles.caption, { color: p.muted }]}>
              {item.caption}
            </Text>
          </View>
        </Pressable>
      ))}
    </View>
  );
  return (
    <View style={styles.body}>
      <Text
        accessibilityRole="header"
        style={[styles.title, { color: p.text }]}
      >
        Quick actions
      </Text>
      <Text style={[styles.subtitle, { color: p.muted }]}>
        {phase === 'idle' || phase === 'unavailable'
          ? 'Tools for your planned truck route'
          : 'Tools for the route you are driving now'}
      </Text>
      {grid(quick)}
      <Text
        accessibilityRole="header"
        style={[styles.title, { color: p.text }]}
      >
        Driving setup
      </Text>
      {grid(setup)}
      <Text style={[styles.notice, { color: p.muted }]}>
        Park safely before managing documents or account settings. These remain
        available outside the driving map.
      </Text>
      <Text style={[styles.notice, { color: p.muted }]}>
        Live guidance and rerouting require licensed CoPilot maps and runtime.
        POIs and road reports require available provider data. Sharing sends a
        planning summary, not live tracking.
      </Text>
    </View>
  );
}
const styles = StyleSheet.create({
  body: { gap: 12 },
  title: { color: '#F6FAFC', fontSize: 22, fontWeight: '800', marginTop: 4 },
  subtitle: { color: '#93A9B7', fontSize: 15, lineHeight: 21 },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    padding: 10,
    paddingVertical: 18,
    borderRadius: 22,
    borderWidth: 1,
    borderColor: '#233E4D',
    backgroundColor: '#0D202E',
  },
  tile: {
    width: '48.5%',
    flexGrow: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    padding: 9,
    minHeight: 78,
    borderRadius: 19,
    backgroundColor: '#142C3A',
  },
  single: { width: '100%' },
  icon: {
    width: 36,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 14,
  },
  copy: { flex: 1 },
  tileTitle: { color: '#F6FAFC', fontSize: 14, fontWeight: '800' },
  caption: { color: '#93A9B7', fontSize: 11, lineHeight: 15, marginTop: 3 },
  notice: { color: '#93A9B7', fontSize: 13, lineHeight: 19 },
});
