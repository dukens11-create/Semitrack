import React from 'react';
import { Text, StyleSheet } from 'react-native';
// Original Flutter Material glyphs; uses the font already bundled for Phase 1.
const glyphs = {
  home_outlined: 61703,
  home: 58136,
  map_outlined: 61870,
  map: 58312,
  route_rounded: 983927,
  description_outlined: 61358,
  description: 57791,
  person_outline: 58519,
  person: 58513,
  local_shipping_rounded: 63615,
  search_rounded: 983357,
  chevron_right_rounded: 63035,
  verified_user_rounded: 983663,
  height_rounded: 63458,
  scale_rounded: 983930,
  warning_amber_rounded: 983712,
  straighten_rounded: 983523,
  restaurant_rounded: 983304,
  local_parking_rounded: 63606,
  local_gas_station_rounded: 63597,
  park_rounded: 983118,
  storefront_rounded: 983521,
  more_horiz_rounded: 63705,
  local_car_wash_rounded: 63591,
  close_rounded: 63047,
  my_location_rounded: 63728,
  settings_rounded: 983396,
  cable_rounded: 62970,
  workspace_premium_rounded: 984000,
  logout_rounded: 63627,
  folder_open_rounded: 63357,
  history_rounded: 63471,
  bookmark_border_rounded: 62927,
};
export type DriverIconName = keyof typeof glyphs;
export function DriverIcon({
  name,
  size = 24,
  color = '#FF6B2C',
}: {
  name: DriverIconName;
  size?: number;
  color?: string;
}) {
  return (
    <Text
      accessible={false}
      importantForAccessibility="no"
      allowFontScaling={false}
      style={[styles.icon, { fontSize: size, color }]}
    >
      {String.fromCodePoint(glyphs[name])}
    </Text>
  );
}
const styles = StyleSheet.create({
  icon: {
    fontFamily: 'MaterialIcons-Regular',
    fontWeight: 'normal',
    includeFontPadding: false,
  },
});
