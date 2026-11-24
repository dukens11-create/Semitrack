import React from 'react';
import { StyleSheet, Text } from 'react-native';

// Exact glyphs used by Flutter auth_screen.dart, from its preserved Material font.
const glyphs = {
  person: 0xf006c,
  email: 0xf89b,
  lock: 0xf888,
  visible: 0xf4a1,
  hidden: 0xf4a0,
  shield: 0xf47d,
};
export function AuthIcon({
  name,
  size = 24,
  color = '#9FAAB5',
}: {
  name: keyof typeof glyphs;
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
