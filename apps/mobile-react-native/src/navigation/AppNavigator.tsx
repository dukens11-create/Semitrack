import React, { useEffect, useState } from 'react';
import { BackHandler, Pressable, StyleSheet, Text, View } from 'react-native';
import { NavigationContainer, useIsFocused } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import type { Services } from '../app/services';
import { DriverIcon, type DriverIconName } from '../components/DriverIcon';
import { driverColors, useDriverPalette } from '../components/DriverUI';
import { DriverDashboardScreen } from '../screens/DriverDashboardScreen';
import { TripsScreen, DocumentsScreen } from '../screens/DriverLibraryScreens';
import { MoreScreen } from '../screens/MoreScreen';
import { PlanningScreen } from '../screens/PlanningScreen';
import { TruckProfileScreen } from '../screens/TruckProfileScreen';
import { SettingsScreen } from '../screens/SettingsScreen';
import { ServicesScreen } from '../screens/ServicesScreen';
type Routes = {
  Main: undefined;
  Trucks: undefined;
  Services: undefined;
  Settings: undefined;
};
const Stack = createNativeStackNavigator<Routes>();
const tabs: { label: string; icon: DriverIconName; active: DriverIconName }[] =
  [
    { label: 'Home', icon: 'home_outlined', active: 'home' },
    { label: 'Map', icon: 'map_outlined', active: 'map' },
    { label: 'Trips', icon: 'route_rounded', active: 'route_rounded' },
    { label: 'Docs', icon: 'description_outlined', active: 'description' },
    { label: 'More', icon: 'person_outline', active: 'person' },
  ];
// Mirrors Flutter IndexedStack: Map opens first; visited tabs retain their state.
export function DriverShell({
  services,
  open,
}: {
  services: Services;
  open: (screen: 'Trucks' | 'Settings' | 'Services') => void;
}) {
  const p = useDriverPalette();
  const [tab, setTab] = useState(1);
  const [visited, setVisited] = useState([1]);
  const focused = useIsFocused();
  function select(index: number) {
    setTab(index);
    setVisited(old => (old.includes(index) ? old : [...old, index]));
  }
  useEffect(() => {
    if (!focused) return;
    const handler = BackHandler.addEventListener('hardwareBackPress', () => {
      if (tab !== 1) {
        setTab(1);
        return true;
      }
      return false;
    });
    return () => handler.remove();
  }, [tab, focused]);
  return (
    <View style={[styles.fill, { backgroundColor: p.canvas }]}>
      <View style={styles.fill}>
        {visited.map(index => (
          <View
            key={index}
            style={[styles.fill, index !== tab && styles.hidden]}
            accessibilityElementsHidden={index !== tab}
            importantForAccessibility={
              index !== tab ? 'no-hide-descendants' : 'auto'
            }
          >
            {index === 0 ? (
              <DriverDashboardScreen
                services={services}
                onMap={() => select(1)}
                onTrips={() => select(2)}
                onDocs={() => select(3)}
                onMore={() => select(4)}
                onTrucks={() => open('Trucks')}
              />
            ) : index === 1 ? (
              <PlanningScreen
                active={focused && tab === 1}
                services={services}
                onTrucks={() => open('Trucks')}
                onServices={() => open('Services')}
              />
            ) : index === 2 ? (
              <TripsScreen services={services} onMap={() => select(1)} />
            ) : index === 3 ? (
              <DocumentsScreen services={services} />
            ) : (
              <MoreScreen
                services={services}
                onTrucks={() => open('Trucks')}
                onSettings={() => open('Settings')}
                onServices={() => open('Services')}
              />
            )}
          </View>
        ))}
      </View>
      <View
        accessibilityRole="tablist"
        style={[
          styles.bar,
          {
            backgroundColor: p.card,
            borderColor: p.border,
          },
        ]}
      >
        {tabs.map((item, index) => (
          <Pressable
            key={item.label}
            accessibilityRole="tab"
            accessibilityLabel={item.label}
            accessibilityState={{ selected: index === tab }}
            onPress={() => select(index)}
            style={styles.tab}
          >
            <View style={[styles.indicator, index === tab && styles.selected]}>
              <DriverIcon
                name={index === tab ? item.active : item.icon}
                size={25}
                color={index === tab ? '#FF6B2C' : p.muted}
              />
            </View>
            <Text
              style={[
                styles.label,
                index === tab && styles.selectedLabel,
                {
                  color: index === tab ? driverColors.orange : p.muted,
                },
              ]}
            >
              {item.label}
            </Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
}
export function AppNavigator({ services }: { services: Services }) {
  const p = useDriverPalette();
  return (
    <NavigationContainer>
      <Stack.Navigator
        screenOptions={{
          headerStyle: { backgroundColor: p.card },
          headerTintColor: p.text,
          contentStyle: { backgroundColor: p.canvas },
        }}
      >
        <Stack.Screen name="Main" options={{ headerShown: false }}>
          {({ navigation }) => (
            <DriverShell
              services={services}
              open={screen => navigation.navigate(screen)}
            />
          )}
        </Stack.Screen>
        <Stack.Screen name="Trucks" options={{ title: 'Truck profiles' }}>
          {() => <TruckProfileScreen services={services} />}
        </Stack.Screen>
        <Stack.Screen
          name="Services"
          options={{ title: 'Road and truck services' }}
        >
          {() => <ServicesScreen services={services} />}
        </Stack.Screen>
        <Stack.Screen
          name="Settings"
          options={{ title: 'Account and settings' }}
        >
          {() => <SettingsScreen services={services} />}
        </Stack.Screen>
      </Stack.Navigator>
    </NavigationContainer>
  );
}
const styles = StyleSheet.create({
  fill: { flex: 1 },
  hidden: { display: 'none' },
  bar: {
    minHeight: 72,
    flexDirection: 'row',
    borderTopWidth: 1,
    boxShadow: '0 -2px 10px #10182018',
  },
  tab: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 8,
    gap: 4,
  },
  indicator: {
    width: 58,
    height: 30,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  selected: { backgroundColor: '#FF6B2C29' },
  selectedLabel: { fontWeight: '900' },
  label: { fontSize: 11, fontWeight: '700' },
});
