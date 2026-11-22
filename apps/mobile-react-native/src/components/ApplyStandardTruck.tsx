import React, { useEffect, useState } from 'react';
import { Alert, Switch, TextInput, View } from 'react-native';
import type { Services } from '../app/services';
import { useStore } from '../hooks/useStore';
import { coPilotHost } from '../services/copilot/CoPilotHost';
import {
  applyReviewedStandardTruck,
  reviewStandardTruckApplication,
} from '../services/copilot/StandardTruckApplication';
import { hybridError } from '../services/copilot/HybridControls';
import {
  DriverButton,
  DriverCopy,
  DriverTitle,
  useDriverPalette,
} from './DriverUI';

export function ApplyStandardTruck({
  services,
  disabled,
  run,
}: {
  services: Services;
  disabled: boolean;
  run: (action: () => Promise<void>) => Promise<void>;
}) {
  const truck = useStore(services.trucks).selected;
  const fingerprint = JSON.stringify(truck);
  const [open, setOpen] = useState(false);
  const [feet, setFeet] = useState('');
  const [inches, setInches] = useState('0');
  const [confirmed, setConfirmed] = useState(false);
  const [message, setMessage] = useState('');
  const p = useDriverPalette();
  useEffect(() => {
    setFeet('');
    setInches('0');
    setConfirmed(false);
    setMessage('');
  }, [fingerprint]);
  const fieldStyle = {
    backgroundColor: p.input,
    color: p.text,
    padding: 16,
    fontSize: 20,
    borderRadius: 12,
  };
  function review() {
    try {
      const value = reviewStandardTruckApplication(
        services,
        feet,
        inches,
        confirmed,
      );
      const r = value.request;
      Alert.alert(
        'Apply this truck to CoPilot?',
        `Height: ${r.heightInches} in\nWidth: ${
          r.widthInches
        } in\nMaximum straight length: 53 ft\nOverall length: ${feet} ft ${inches} in\nTrailers: 1 · Total axles: 5\nTotal routing weight: ${r.weightLbs.toLocaleString()} lb\nAxle-group routing weight: ${r.weightPerAxleLbs.toLocaleString()} lb\nPractical routing · No hazardous cargo\nAvoid tolls: ${
          r.avoidTolls ? 'Yes' : 'No'
        }\n\nCreates a separate SemiTraX CoPilot profile. Fleet-assigned profiles cannot be replaced here. Confirm these values describe your actual vehicle and load. Applying does not start navigation.`,
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Apply and verify',
            onPress: () => {
              void run(async () => {
                setMessage('');
                await applyReviewedStandardTruck(
                  services,
                  coPilotHost(),
                  value,
                );
                setMessage(
                  'Applied and verified in CoPilot. Use Start / Resume to review the engine profile and confirm navigation.',
                );
              });
            },
          },
        ],
      );
    } catch (error) {
      setMessage(hybridError(error));
    }
  }
  return (
    <View>
      <DriverButton
        title={
          open ? 'Hide profile application' : 'Apply saved truck to CoPilot'
        }
        disabled={disabled}
        onPress={() => setOpen(!open)}
      />
      {open && (
        <View>
          <DriverTitle small>Apply your truck profile</DriverTitle>
          <DriverCopy>
            This mode supports a single 53-foot dry van or reefer with five
            total axles. End Route and park before applying. It writes both
            length fields and separate total and axle-group routing weights,
            then checks CoPilot’s readback.
          </DriverCopy>
          <DriverCopy>
            Total routing weight:{' '}
            {truck?.weightLbs.toLocaleString() ?? 'No truck selected'} lb —
            tractor, trailer and load together. If this is cargo-only or
            axle-group weight, correct it in Truck settings first.
          </DriverCopy>
          <DriverCopy>
            Axle-group routing weight:{' '}
            {truck?.weightPerAxleLbs?.toLocaleString() ??
              '34,000 (standard routing default, not a measured weight)'}{' '}
            lb.
          </DriverCopy>
          <DriverCopy>
            Actual overall length, front bumper to rear of the complete
            tractor/trailer combination. Do not enter trailer length alone. If
            unknown, measure it before applying.
          </DriverCopy>
          <TextInput
            accessibilityLabel="Overall length feet"
            placeholder="Overall feet"
            placeholderTextColor={p.muted}
            keyboardType="number-pad"
            editable={!disabled}
            value={feet}
            onChangeText={setFeet}
            style={fieldStyle}
          />
          <TextInput
            accessibilityLabel="Overall length inches"
            placeholder="Additional inches (0–11)"
            placeholderTextColor={p.muted}
            keyboardType="number-pad"
            editable={!disabled}
            value={inches}
            onChangeText={setInches}
            style={fieldStyle}
          />
          <DriverCopy>
            I checked that the total weight covers the entire vehicle and load,
            and that both routing weights and the overall length are appropriate
            for this truck.
          </DriverCopy>
          <Switch
            accessibilityLabel="Confirm whole vehicle weight and length"
            disabled={disabled}
            value={confirmed}
            onValueChange={setConfirmed}
          />
          <DriverButton
            title="Review and apply truck"
            disabled={disabled || !confirmed}
            onPress={review}
          />
          {!!message && <DriverCopy>{message}</DriverCopy>}
        </View>
      )}
    </View>
  );
}
