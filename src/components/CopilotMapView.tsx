import React from 'react';
import type { StyleProp, ViewStyle } from 'react-native';
import { requireNativeComponent } from 'react-native';

type CopilotMapViewProps = {
  style?: StyleProp<ViewStyle>;
};

const NativeCopilotMapView = requireNativeComponent<CopilotMapViewProps>('CopilotView');

export function CopilotMapView({ style }: CopilotMapViewProps) {
  return <NativeCopilotMapView style={style} />;
}
