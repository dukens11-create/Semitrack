import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  BackHandler,
  Keyboard,
  Pressable,
  Text,
  View,
} from 'react-native';
import type { Services } from '../app/services';
import type { Settings } from '../features/settings/SettingsService';
import { temperatureUnit } from '../features/weather/weatherPresentation';
import { mapPreferences } from '../features/settings/mapPreferences';
import { resetPasswordError } from '../features/auth/resetLink';
import {
  DriverButton,
  DriverCard,
  DriverCopy,
  DriverField,
  DriverPage,
  DriverTitle,
  useDriverPalette,
} from '../components/DriverUI';
import {
  SettingsRow,
  SettingsSurface,
  SettingChoices,
  SettingToggle,
  SettingsPasswordField,
  ss,
} from '../components/SettingsPresentation';
import { DriverIcon } from '../components/DriverIcon';
import { ErrorText, errorMessage } from '../components/ui';
import { useStore } from '../hooks/useStore';
import { DiagnosticsScreen } from './DiagnosticsScreen';
import { DriverSetup } from '../features/onboarding/DriverSetup';
import { DeleteAccountPanel } from '../features/auth/DeleteAccountPanel';
type Page =
  | 'hub'
  | 'profile'
  | 'password'
  | 'map'
  | 'units'
  | 'navigation'
  | 'privacy'
  | 'diagnostics'
  | 'setup'
  | 'delete'
  | 'about';
const titles: Record<Page, string> = {
  hub: 'Account & Settings',
  profile: 'Account & profile',
  password: 'Password & security',
  map: 'Map & display',
  units: 'Units',
  navigation: 'Navigation',
  privacy: 'Privacy & location',
  diagnostics: 'Diagnostics',
  setup: 'Driver setup',
  delete: 'Delete account',
  about: 'About SemiTraX',
};

export function SettingsScreen({
  services,
  onBack,
  onPlans,
}: {
  services: Services;
  onBack?: () => void;
  onPlans?: () => void;
}) {
  const auth = useStore(services.auth),
    state = useStore(services.settings),
    p = useDriverPalette();
  const [page, setPage] = useState<Page>('hub');
  const [name, setName] = useState(auth.user?.fullName ?? ''),
    [phone, setPhone] = useState(auth.user?.phone ?? '');
  const [currentPassword, setCurrentPassword] = useState(''),
    [newPassword, setNewPassword] = useState(''),
    [confirmPassword, setConfirmPassword] = useState('');
  const [locale, setLocale] = useState(state.settings?.voiceLocale ?? '');
  const [busy, setBusy] = useState(false),
    [error, setError] = useState<string>(),
    [notice, setNotice] = useState('');
  const locked = useRef(false),
    live = useRef(true);
  const [guidancePhase, setGuidancePhase] = useState(
    () => services.guidance.getNavigationState().phase,
  );
  const pending = busy || state.phase === 'saving';
  const settings = state.settings;
  useEffect(() => {
    live.current = true;
    void services.settings.load().catch(() => {});
    return () => {
      live.current = false;
    };
  }, [services]);
  useEffect(() => {
    setName(auth.user?.fullName ?? '');
    setPhone(auth.user?.phone ?? '');
  }, [auth.user?.id, auth.user?.fullName, auth.user?.phone]);
  useEffect(() => {
    setLocale(state.settings?.voiceLocale ?? '');
  }, [state.settings?.voiceLocale]);
  useEffect(
    () =>
      services.guidance.subscribe(() =>
        setGuidancePhase(services.guidance.getNavigationState().phase),
      ),
    [services],
  );
  const go = useCallback((next: Page) => {
    Keyboard.dismiss();
    setPage(next);
    setError(undefined);
    setNotice('');
    if (next !== 'password') {
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
    }
  }, []);
  useEffect(() => {
    const listener = BackHandler.addEventListener('hardwareBackPress', () => {
      if (Keyboard.isVisible()) {
        Keyboard.dismiss();
        return true;
      }
      if (page !== 'hub') {
        go('hub');
        return true;
      }
      return false;
    });
    return () => listener.remove();
  }, [page, go]);
  async function run(action: () => Promise<unknown>, message: string) {
    if (locked.current || services.settings.getSnapshot().phase === 'saving')
      return;
    const owner = services.auth.getSnapshot().user?.id;
    if (!owner) return;
    locked.current = true;
    setBusy(true);
    setError(undefined);
    setNotice('');
    try {
      const result = await action();
      if (
        live.current &&
        services.auth.getSnapshot().user?.id === owner &&
        result !== null
      )
        setNotice(message);
    } catch (e) {
      if (live.current && services.auth.getSnapshot().user?.id === owner)
        setError(errorMessage(e));
    } finally {
      locked.current = false;
      if (live.current) setBusy(false);
    }
  }
  function savePreference(update: (current: Settings) => Settings) {
    void run(async () => {
      const current = services.settings.getSnapshot().settings;
      if (!current) throw new Error('Load preferences before making a change.');
      const next = update(current);
      if (JSON.stringify(next) === JSON.stringify(current)) return null;
      return services.settings.save(next);
    }, 'Preference saved.');
  }
  const profileDirty =
    name.trim() !== (auth.user?.fullName ?? '') ||
    (phone.trim() || null) !== (auth.user?.phone ?? null);
  const profileValid =
    name.trim().length >= 2 &&
    name.trim().length <= 120 &&
    phone.trim().length <= 30;
  const passwordIssue = !currentPassword
    ? 'Enter your current password.'
    : resetPasswordError(newPassword, confirmPassword);
  const passwordHint =
    passwordIssue === 'Use at most 72 UTF-8 bytes.'
      ? 'Choose a shorter password.'
      : passwordIssue;
  const disabledPreferences = pending || !settings || state.phase === 'loading';
  const navigationCopy =
    guidancePhase === 'unavailable'
      ? 'Live guidance will become available after provider activation.'
      : 'Saved preferences do not confirm that voice or traffic features are active.';
  const header = (title: string, back: () => void) => (
    <View style={ss.heading}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Back"
        onPress={back}
        style={ss.back}
      >
        <Text style={[ss.backText, { color: p.text }]}>‹ Back</Text>
      </Pressable>
      <View style={ss.flex}>
        <DriverTitle small>{title}</DriverTitle>
      </View>
    </View>
  );
  const feedback = (
    <>
      {!!error && <ErrorText message={error} />}
      {!!notice && (
        <Text accessibilityLiveRegion="polite" style={{ color: p.text }}>
          {notice}
        </Text>
      )}
      {state.phase === 'saving' && (
        <View style={ss.heading}>
          <ActivityIndicator color={p.muted} />
          <DriverCopy>Saving preference…</DriverCopy>
        </View>
      )}
    </>
  );
  const preferencesStatus = (
    <>
      {state.phase === 'loading' && (
        <ActivityIndicator
          accessibilityLabel="Loading preferences"
          color={p.muted}
        />
      )}
      {!!state.error && (
        <DriverCard>
          <ErrorText message={state.error} />
          <DriverButton
            title="Retry preferences"
            secondary
            disabled={pending}
            onPress={() => {
              void run(() => services.settings.load(true), '');
            }}
          />
        </DriverCard>
      )}
    </>
  );
  return (
    <View style={ss.fill}>
      <View
        style={[ss.fill, page !== 'hub' && ss.hidden]}
        accessibilityElementsHidden={page !== 'hub'}
        importantForAccessibility={
          page === 'hub' ? 'auto' : 'no-hide-descendants'
        }
      >
        <DriverPage>
          {onBack && (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Back to More"
              onPress={onBack}
              style={ss.back}
            >
              <Text style={[ss.backText, { color: p.text }]}>‹ Back</Text>
            </Pressable>
          )}
          <View>
            <DriverTitle>Account & Settings</DriverTitle>
            <DriverCopy>Manage your account and app preferences.</DriverCopy>
          </View>
          <View style={ss.group}>
            <DriverTitle small>Account</DriverTitle>
            <SettingsSurface>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Account & profile"
                onPress={() => go('profile')}
                style={ss.profile}
              >
                <View style={[ss.avatar, { backgroundColor: p.input }]}>
                  <Text style={[ss.initials, { color: p.text }]}>
                    {(auth.user?.fullName ?? '')
                      .trim()
                      .split(/\s+/)
                      .filter(Boolean)
                      .slice(0, 2)
                      .map(part => part[0])
                      .join('')
                      .toUpperCase() || '•'}
                  </Text>
                </View>
                <View style={ss.flex}>
                  <Text style={[ss.rowTitle, { color: p.text }]}>
                    {auth.user?.fullName}
                  </Text>
                  <Text style={[ss.copy, { color: p.muted }]}>
                    {auth.user?.email}
                  </Text>
                  {!!auth.user?.phone && (
                    <Text style={[ss.copy, { color: p.muted }]}>
                      {auth.user.phone}
                    </Text>
                  )}
                  <Text style={[ss.copy, { color: p.text }]}>
                    Account & profile
                  </Text>
                </View>
                <DriverIcon name="chevron_right_rounded" color={p.muted} />
              </Pressable>
            </SettingsSurface>
          </View>
          <View style={ss.group}>
            {onPlans && <SettingsSurface><SettingsRow title="Plans & Subscription" caption="Pricing and verified account billing details" icon="workspace_premium_rounded" color="blue" onPress={onPlans} /></SettingsSurface>}
            <DriverTitle small>Preferences</DriverTitle>
            <SettingsSurface>
              <SettingsRow
                title="Map & display"
                icon="map_outlined"
                color="teal"
                onPress={() => go('map')}
              />
              <SettingsRow
                title="Navigation"
                icon="route_rounded"
                color="orange"
                onPress={() => go('navigation')}
              />
              <SettingsRow
                title="Units"
                icon="straighten_rounded"
                color="purple"
                onPress={() => go('units')}
              />
            </SettingsSurface>
          </View>
          <View style={ss.group}>
            <DriverTitle small>Security & privacy</DriverTitle>
            <SettingsSurface>
              <SettingsRow
                title="Password & security"
                icon="verified_user_rounded"
                color="blue"
                onPress={() => go('password')}
              />
              <SettingsRow
                title="Privacy & location"
                icon="my_location_rounded"
                color="teal"
                onPress={() => go('privacy')}
              />
            </SettingsSurface>
          </View>
          <View style={ss.group}>
            <DriverTitle small>Support</DriverTitle>
            <SettingsSurface>
              <SettingsRow title="Driver setup" caption="Truck, location and guidance setup"
                icon="description_outlined" color="blue" onPress={() => go('setup')} />
              <SettingsRow
                title="Diagnostics"
                caption="View, copy or share sanitized route checks"
                icon="description_outlined"
                color="blue"
                onPress={() => go('diagnostics')}
              />
              <SettingsRow
                title="About SemiTraX"
                icon="description_outlined"
                color="slate"
                onPress={() => go('about')}
              />
            </SettingsSurface>
          </View>
          {page === 'hub' && feedback}
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Sign out"
            accessibilityState={{ disabled: pending, busy }}
            disabled={pending}
            onPress={() => {
              void run(() => services.auth.logout(), '');
            }}
            style={[
              ss.signOut,
              { backgroundColor: p.input, borderColor: p.border },
            ]}
          >
            <Text
              style={[
                ss.signOutText,
                { color: pending ? p.muted : p.dark ? '#FFB4B4' : '#A52626' },
              ]}
            >
              {busy ? 'Working…' : 'Sign out'}
            </Text>
          </Pressable>
        </DriverPage>
      </View>
      {page !== 'hub' && (
        <DriverPage>
          {header(titles[page], () => go('hub'))}
          {page === 'diagnostics' && <DiagnosticsScreen />}
          {page === 'setup' && <DriverSetup settings={services.settings} onContinue={() => go('hub')} />}
          {page === 'delete' && <DeleteAccountPanel auth={services.auth} />}
          {page === 'profile' && (
            <DriverCard>
              <DriverField
                label="Full name"
                value={name}
                maxLength={120}
                editable={!pending}
                autoComplete="name"
                onChangeText={setName}
              />
              <DriverField
                label="Email"
                value={auth.user?.email ?? ''}
                editable={false}
                autoCapitalize="none"
              />
              <DriverCopy>Email cannot be changed from the app.</DriverCopy>
              <DriverButton title="Delete account" secondary disabled={pending} onPress={() => go('delete')} />
              <DriverField
                label="Phone"
                value={phone}
                maxLength={30}
                editable={!pending}
                keyboardType="phone-pad"
                autoComplete="tel"
                onChangeText={setPhone}
              />
              {!profileDirty && <DriverCopy>No changes to save.</DriverCopy>}
              {!profileValid && (
                <DriverCopy>
                  Enter a name of at least 2 characters. Phone numbers can
                  contain up to 30 characters.
                </DriverCopy>
              )}
              <DriverButton
                title="Save changes"
                loading={busy}
                disabled={
                  !profileDirty || !profileValid || state.phase === 'saving'
                }
                onPress={() => {
                  if (profileDirty && profileValid)
                    void run(
                      () =>
                        services.auth.updateProfile(
                          name.trim(),
                          phone.trim() || null,
                        ),
                      'Profile saved.',
                    );
                }}
              />
            </DriverCard>
          )}
          {page === 'password' && (
            <DriverCard>
              <DriverTitle small>Change your password</DriverTitle>
              <DriverCopy>
                You'll be signed out after changing your password.
              </DriverCopy>
              <SettingsPasswordField
                label="Current password"
                value={currentPassword}
                onChange={setCurrentPassword}
                disabled={pending}
              />
              <SettingsPasswordField
                label="New password"
                value={newPassword}
                onChange={setNewPassword}
                disabled={pending}
              />
              <SettingsPasswordField
                label="Confirm new password"
                value={confirmPassword}
                onChange={setConfirmPassword}
                disabled={pending}
              />
              <DriverCopy>Use at least 10 characters.</DriverCopy>
              {!!passwordHint && <DriverCopy>{passwordHint}</DriverCopy>}
              <DriverButton
                title="Change password"
                loading={busy}
                disabled={!!passwordIssue || state.phase === 'saving'}
                onPress={() => {
                  if (passwordIssue) return;
                  void run(async () => {
                    try {
                      await services.auth.changePassword(
                        currentPassword,
                        newPassword,
                      );
                    } finally {
                      if (live.current) {
                        setCurrentPassword('');
                        setNewPassword('');
                        setConfirmPassword('');
                      }
                    }
                  }, 'Password changed. Sign in again.');
                }}
              />
            </DriverCard>
          )}
          {['map', 'units', 'navigation'].includes(page) && preferencesStatus}
          {page === 'map' && settings && (
            <DriverCard>
              <SettingChoices
                label="Appearance"
                value={settings.dayNightMode}
                items={[
                  { value: 'system', label: 'Automatic' },
                  { value: 'day', label: 'Day' },
                  { value: 'night', label: 'Night' },
                ]}
                disabled={disabledPreferences}
                onChange={dayNightMode =>
                  savePreference(current => ({ ...current, dayNightMode }))
                }
              />
              {(['satellite', 'autoZoom'] as const).map(key => (
                <SettingToggle
                  key={key}
                  label={
                    key === 'satellite'
                      ? 'Satellite map'
                      : 'Automatic camera zoom'
                  }
                  description={
                    key === 'satellite'
                      ? 'Show satellite imagery on the map.'
                      : 'Adjust zoom while following your truck.'
                  }
                  value={mapPreferences(settings)[key]}
                  disabled={disabledPreferences}
                  onChange={value =>
                    savePreference(current => ({
                      ...current,
                      settingsJson: {
                        ...current.settingsJson,
                        rnMap: { ...mapPreferences(current), [key]: value },
                      },
                    }))
                  }
                />
              ))}
            </DriverCard>
          )}
          {page === 'units' && settings && (
            <DriverCard>
              <SettingChoices
                label="Temperature units"
                value={temperatureUnit(settings)}
                items={[
                  { value: 'F', label: '°F' },
                  { value: 'C', label: '°C' },
                ]}
                disabled={disabledPreferences}
                onChange={rnTemperatureUnit =>
                  savePreference(current => ({
                    ...current,
                    settingsJson: {
                      ...current.settingsJson,
                      rnTemperatureUnit,
                    },
                  }))
                }
              />
              <SettingChoices
                label="Distance units"
                value={settings.units}
                items={[
                  { value: 'imperial', label: 'Miles' },
                  { value: 'metric', label: 'Kilometers' },
                ]}
                disabled={disabledPreferences}
                onChange={units =>
                  savePreference(current => ({ ...current, units }))
                }
              />
              <DriverCopy>
                Display units apply to the map and trip estimates. Truck
                measurements keep their original units.
              </DriverCopy>
            </DriverCard>
          )}
          {page === 'navigation' && (
            <>
              <DriverCard>
                <DriverTitle small>
                  {guidancePhase === 'unavailable'
                    ? 'CoPilot setup required'
                    : 'Navigation preferences'}
                </DriverTitle>
                <DriverCopy>{navigationCopy}</DriverCopy>
              </DriverCard>
              {settings && (
                <DriverCard>
                  {(
                    [
                      { key: 'voiceEnabled', label: 'Voice guidance' },
                      { key: 'voiceMuted', label: 'Mute guidance' },
                      { key: 'trafficReroute', label: 'Traffic rerouting' },
                    ] as const
                  ).map(item => (
                    <SettingToggle
                      key={item.key}
                      label={item.label}
                      description={
                        (settings[item.key] ? 'On' : 'Off') +
                        ' when navigation becomes available · saved preference'
                      }
                      value={settings[item.key]}
                      disabled={disabledPreferences}
                      preference
                      onChange={value =>
                        savePreference(current => ({
                          ...current,
                          [item.key]: value,
                        }))
                      }
                    />
                  ))}
                  <DriverField
                    label="Voice language"
                    value={locale}
                    maxLength={20}
                    autoCapitalize="none"
                    editable={!pending}
                    onChangeText={setLocale}
                  />
                  <DriverCopy>
                    Language code, for example en-US. Language availability
                    depends on CoPilot.
                  </DriverCopy>
                  <DriverButton
                    title="Save voice language"
                    secondary
                    loading={busy}
                    disabled={
                      locale.trim().length < 2 ||
                      locale.trim() === settings.voiceLocale ||
                      state.phase === 'saving'
                    }
                    onPress={() =>
                      savePreference(current => ({
                        ...current,
                        voiceLocale: locale.trim(),
                      }))
                    }
                  />
                </DriverCard>
              )}
            </>
          )}
          {page === 'privacy' && (
            <DriverCard>
              <DriverTitle small>Location permissions</DriverTitle>
              <DriverCopy>
                Location displays your truck position and supplies the origin
                for searches and truck-route requests. Stop updates using the
                Map location control, or manage permission in your device
                settings.
              </DriverCopy>
              <DriverTitle small>Data and privacy</DriverTitle>
              <DriverCopy>
                Account access uses secure device token storage and the
                configured HTTPS SemiTraX API. Signing out removes the local
                session.
              </DriverCopy>
              <DriverCopy>
                A device-protected, read-only copy of distance, temperature and
                appearance preferences may remain available for up to 24 hours
                after an online account check. It contains no saved locations,
                documents or routing permissions. Signing out removes this copy.
              </DriverCopy>
              <DriverCopy>
                Push notifications and account reminders are not available in
                this version. No notification enrollment or consent is implied.
                Account deletion is available under Account & profile; retained
                business records and backups require policy review.
              </DriverCopy>
              <DriverCopy>
                This summary is not a published privacy policy. A published
                policy is not available in this version.
              </DriverCopy>
            </DriverCard>
          )}
          {page === 'about' && (
            <DriverCard>
              <DriverTitle small>SemiTraX</DriverTitle>
              <DriverCopy>
                Version {require('../../package.json').version}
              </DriverCopy>
              <DriverCopy>
                Commercial truck route planning with Mapbox display and Trimble
                routing. CoPilot active navigation requires entitlement, maps
                and device validation.
              </DriverCopy>
            </DriverCard>
          )}
          {feedback}
        </DriverPage>
      )}
    </View>
  );
}
