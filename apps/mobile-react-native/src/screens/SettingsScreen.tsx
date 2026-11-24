import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Switch,
  Text,
  View,
} from 'react-native';
import type { Services } from '../app/services';
import type { Settings } from '../features/settings/SettingsService';
import {
  DriverButton,
  DriverCard,
  DriverCopy,
  DriverField,
  DriverPage,
  DriverTitle,
  useDriverPalette,
  ds,
} from '../components/DriverUI';
import { DriverSheet } from '../components/DriverSheet';
import { ErrorText, errorMessage } from '../components/ui';
import { useStore } from '../hooks/useStore';
function Choices<T extends string>({
  label,
  value,
  items,
  disabled,
  onChange,
}: {
  label: string;
  value: T;
  items: { value: T; label: string }[];
  disabled: boolean;
  onChange: (value: T) => void;
}) {
  const p = useDriverPalette();
  return (
    <View style={styles.group}>
      <DriverCopy>{label}</DriverCopy>
      <View style={styles.choices}>
        {items.map(item => (
          <Pressable
            key={item.value}
            accessibilityRole="radio"
            accessibilityLabel={item.label}
            accessibilityState={{ checked: item.value === value, disabled }}
            disabled={disabled}
            onPress={() => onChange(item.value)}
            style={[
              styles.choice,
              {
                borderColor: p.border,
                backgroundColor: p.input,
              },
              item.value === value && styles.selected,
            ]}
          >
            <Text style={[styles.choiceLabel, { color: p.text }]}>
              {item.label}
            </Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
}
export function SettingsScreen({ services }: { services: Services }) {
  const auth = useStore(services.auth);
  const state = useStore(services.settings);
  const [draft, setDraft] = useState<Settings | null>(state.settings);
  const [name, setName] = useState(auth.user?.fullName ?? '');
  const [phone, setPhone] = useState(auth.user?.phone ?? '');
  const [error, setError] = useState<string>();
  const [notice, setNotice] = useState('');
  const [currentPassword, setCurrentPassword] = useState(''),
    [newPassword, setNewPassword] = useState(''),
    [confirmPassword, setConfirmPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [info, setInfo] = useState<
    'Privacy and location' | 'About SemiTraX' | null
  >(null);
  const p = useDriverPalette();
  const pending = busy || state.phase === 'saving';
  useEffect(() => {
    void services.settings.load().catch(() => {});
  }, [services]);
  useEffect(() => {
    setDraft(state.settings);
  }, [state.settings]);
  async function run(action: () => Promise<unknown>, message: string) {
    if (pending) return;
    setBusy(true);
    setError(undefined);
    setNotice('');
    try {
      await action();
      setNotice(message);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  const dirty =
    draft !== null && JSON.stringify(draft) !== JSON.stringify(state.settings);
  return (
    <DriverPage>
      <DriverTitle>Account and settings</DriverTitle>
      <DriverCard>
        <DriverTitle small>Driver account</DriverTitle>
        <DriverCopy>{auth.user?.email}</DriverCopy>
        <DriverField
          label="Full name"
          value={name}
          maxLength={120}
          editable={!pending}
          autoComplete="name"
          onChangeText={setName}
        />
        <DriverField
          label="Phone"
          value={phone}
          maxLength={40}
          editable={!pending}
          keyboardType="phone-pad"
          autoComplete="tel"
          onChangeText={setPhone}
        />
        <DriverButton
          title="Save profile"
          disabled={pending || name.trim().length < 2}
          onPress={() => {
            void run(
              () =>
                services.auth.updateProfile(name.trim(), phone.trim() || null),
              'Profile saved.',
            );
          }}
        />
      </DriverCard>
      <DriverCard>
        <DriverTitle small>Change password</DriverTitle>
        <DriverCopy>
          All sessions and outstanding reset links will be invalidated. Sign in
          again after saving. Use at least 10 characters and at most 72 UTF-8
          bytes.
        </DriverCopy>
        <DriverField
          label="Current password"
          value={currentPassword}
          onChangeText={setCurrentPassword}
          secureTextEntry
          autoCapitalize="none"
          maxLength={128}
        />
        <DriverField
          label="New password"
          value={newPassword}
          onChangeText={setNewPassword}
          secureTextEntry
          autoCapitalize="none"
          maxLength={128}
        />
        <DriverField
          label="Confirm new password"
          value={confirmPassword}
          onChangeText={setConfirmPassword}
          secureTextEntry
          autoCapitalize="none"
          maxLength={128}
        />
        <DriverButton
          title="Change password and sign out"
          disabled={
            pending ||
            !currentPassword ||
            newPassword.length < 10 ||
            newPassword !== confirmPassword
          }
          onPress={() => {
            void run(async () => {
              try {
                await services.auth.changePassword(
                  currentPassword,
                  newPassword,
                );
              } finally {
                setCurrentPassword('');
                setNewPassword('');
                setConfirmPassword('');
              }
            }, 'Password changed. Sign in again.');
          }}
        />
      </DriverCard>
      {state.phase === 'loading' && (
        <ActivityIndicator
          accessibilityLabel="Loading preferences"
          color="#FF6B2C"
        />
      )}
      {!!state.error && (
        <DriverCard>
          <ErrorText message={state.error} />
          <DriverButton
            secondary
            title="Retry preferences"
            disabled={pending}
            onPress={() => {
              void services.settings.load(true).catch(() => {});
            }}
          />
        </DriverCard>
      )}
      {draft && (
        <>
          <DriverCard>
            <DriverTitle small>Map and display</DriverTitle>
            <Choices
              label="Appearance"
              value={draft.dayNightMode}
              items={[
                { value: 'system', label: 'Use device setting' },
                { value: 'day', label: 'Day' },
                { value: 'night', label: 'Night' },
              ]}
              disabled={pending}
              onChange={dayNightMode => setDraft({ ...draft, dayNightMode })}
            />
            <Choices
              label="Distance units"
              value={draft.units}
              items={[
                { value: 'imperial', label: 'Miles' },
                { value: 'metric', label: 'Kilometers' },
              ]}
              disabled={pending}
              onChange={units => setDraft({ ...draft, units })}
            />
            <DriverCopy>
              Saved appearance applies to the map and driver screens. Distance
              units apply to route and trip estimates. Truck measurements retain
              their explicitly labeled units.
            </DriverCopy>
          </DriverCard>
          <DriverCard>
            <DriverTitle small>Navigation preferences</DriverTitle>
            <DriverCopy>
              These preferences are saved for CoPilot. Live guidance, voice and
              automatic rerouting remain unavailable until licensing and maps
              are verified.
            </DriverCopy>
            {(
              [
                { key: 'voiceEnabled', label: 'Voice guidance' },
                { key: 'voiceMuted', label: 'Mute guidance' },
                { key: 'trafficReroute', label: 'Traffic rerouting' },
              ] as const
            ).map(item => (
              <View key={item.key} style={ds.row}>
                <View style={ds.grow}>
                  <DriverCopy>{item.label}</DriverCopy>
                </View>
                <Switch
                  accessibilityLabel={item.label}
                  value={draft[item.key]}
                  disabled={pending}
                  onValueChange={value =>
                    setDraft({ ...draft, [item.key]: value })
                  }
                  trackColor={{ true: '#14966F' }}
                />
              </View>
            ))}
            <DriverField
              label="Voice locale"
              value={draft.voiceLocale}
              maxLength={20}
              autoCapitalize="none"
              editable={!pending}
              onChangeText={voiceLocale => setDraft({ ...draft, voiceLocale })}
            />
          </DriverCard>
          {dirty && (
            <Text accessibilityLiveRegion="polite" style={{ color: p.muted }}>
              Unsaved preferences
            </Text>
          )}
          <DriverButton
            title={
              state.phase === 'saving'
                ? 'Saving preferences…'
                : 'Save preferences'
            }
            disabled={pending || !dirty || draft.voiceLocale.trim().length < 2}
            onPress={() => {
              void run(
                () => services.settings.save(draft),
                'Preferences saved and applied.',
              );
            }}
          />
          {dirty && (
            <DriverButton
              title="Discard preference changes"
              secondary
              disabled={pending}
              onPress={() => setDraft(state.settings)}
            />
          )}
        </>
      )}
      <DriverCard>
        <DriverTitle small>Privacy and support</DriverTitle>
        <DriverButton
          title="Privacy and location"
          secondary
          onPress={() => setInfo('Privacy and location')}
        />
        <DriverButton
          title="About SemiTraX"
          secondary
          onPress={() => setInfo('About SemiTraX')}
        />
        <DriverCopy>
          Push notifications and a verified support contact are not configured
          in this build.
        </DriverCopy>
      </DriverCard>
      <ErrorText message={error} />
      {!!notice && (
        <Text accessibilityLiveRegion="polite" style={{ color: p.text }}>
          {notice}
        </Text>
      )}
      <DriverButton
        title="Sign out"
        secondary
        disabled={pending}
        onPress={() => {
          void run(() => services.auth.logout(), '');
        }}
      />
      {info && (
        <DriverSheet title={info} onClose={() => setInfo(null)}>
          {info === 'Privacy and location' ? (
            <>
              <DriverCopy>
                Location is used to display your truck position and provide the
                origin for searches and truck-route requests. You can stop
                location updates from the Map location control or manage
                permission in device settings.
              </DriverCopy>
              <DriverCopy>
                Account access uses secure device token storage and the
                configured HTTPS SemiTraX API. Signing out removes the local
                session.
              </DriverCopy>
              <DriverCopy>
                This feature summary is not a published privacy policy. Approved
                legal and support links must be configured before public
                release.
              </DriverCopy>
            </>
          ) : (
            <>
              <DriverTitle small>SemiTraX</DriverTitle>
              <DriverCopy>
                Version {require('../../package.json').version}
              </DriverCopy>
              <DriverCopy>
                Commercial truck route planning with Mapbox display and Trimble
                routing. CoPilot active navigation remains unavailable until
                entitlement, maps and device validation are complete.
              </DriverCopy>
            </>
          )}
        </DriverSheet>
      )}
    </DriverPage>
  );
}
const styles = StyleSheet.create({
  selected: { borderColor: '#FF6B2C', backgroundColor: '#FF6B2C29' },
  choiceLabel: { fontWeight: '700' },
  group: { gap: 8 },
  choices: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  choice: {
    minHeight: 48,
    padding: 12,
    borderRadius: 12,
    borderWidth: 1,
    justifyContent: 'center',
  },
});
