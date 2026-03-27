/**
 * App Navigator
 * Bottom-tab navigation with stack navigators for each section.
 */
import React from 'react';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { createNativeStackNavigator } from '@react-navigation/native-stack';

import HomeScreen from '../screens/HomeScreen';
import TruckDetailScreen from '../screens/TruckDetailScreen';
import NavigationScreen from '../screens/NavigationScreen';
import TripPlannerScreen from '../screens/TripPlannerScreen';
import ParkingScreen from '../screens/ParkingScreen';
import FuelScreen from '../screens/FuelScreen';
import FleetDashboardScreen from '../screens/FleetDashboardScreen';
import WeatherAlertsScreen from '../screens/WeatherAlertsScreen';

const Tab = createBottomTabNavigator();
const HomeStack = createNativeStackNavigator();
const FleetStack = createNativeStackNavigator();

const HomeStackNavigator = () => (
  <HomeStack.Navigator>
    <HomeStack.Screen name="Home" component={HomeScreen} options={{ title: 'Semitrack' }} />
    <HomeStack.Screen name="TruckDetail" component={TruckDetailScreen} options={{ title: 'Truck Details' }} />
    <HomeStack.Screen name="Navigation" component={NavigationScreen} options={{ title: 'Navigation' }} />
    <HomeStack.Screen name="TripPlanner" component={TripPlannerScreen} options={{ title: 'Trip Planner' }} />
    <HomeStack.Screen name="Parking" component={ParkingScreen} options={{ title: 'Parking' }} />
    <HomeStack.Screen name="Fuel" component={FuelScreen} options={{ title: 'Fuel' }} />
    <HomeStack.Screen name="WeatherAlerts" component={WeatherAlertsScreen} options={{ title: 'Weather Alerts' }} />
  </HomeStack.Navigator>
);

const FleetStackNavigator = () => (
  <FleetStack.Navigator>
    <FleetStack.Screen name="Fleet" component={FleetDashboardScreen} options={{ title: 'Fleet Dashboard' }} />
    <FleetStack.Screen name="TruckDetail" component={TruckDetailScreen} options={{ title: 'Truck Details' }} />
  </FleetStack.Navigator>
);

const AppNavigator = () => (
  <Tab.Navigator screenOptions={{ headerShown: false }}>
    <Tab.Screen name="HomeTab" component={HomeStackNavigator} options={{ title: 'Home' }} />
    <Tab.Screen name="FleetTab" component={FleetStackNavigator} options={{ title: 'Fleet' }} />
    <Tab.Screen name="TripPlannerTab" component={TripPlannerScreen} options={{ title: 'Trips' }} />
    <Tab.Screen name="ParkingTab" component={ParkingScreen} options={{ title: 'Parking' }} />
    <Tab.Screen name="FuelTab" component={FuelScreen} options={{ title: 'Fuel' }} />
  </Tab.Navigator>
);

export default AppNavigator;
