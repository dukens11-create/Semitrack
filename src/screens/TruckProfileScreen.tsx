import {
  dimensionFields,
  dimensionForm,
  inchesKey,
  parseTruckForm,
  profileErrors,
  hazmatLabels,
} from '../features/truckProfile/form';
import React, { useEffect, useRef, useState } from 'react';
import {
  AccessibilityInfo,
  Keyboard,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  duplicateProfile,
  profileFingerprint,
  suggestedLengths,
  tractorTypes,
  trailerTypes,
  verifyRoutingProfile,
} from '../features/truckProfile/equipment';
import type { Services } from '../app/services';
import { hazardousGoods, type TruckProfile } from '../models/contracts';
import { useStore } from '../hooks/useStore';
import {
  colors,
  Heading,
  Copy,
  Field,
  Button,
  ErrorText,
  Card,
} from '../components/ui';
const numericFields = [
  'heightFt',
  'widthFt',
  'lengthFt',
  'weightLbs',
  'currentWeightLbs',
  'weightPerAxleLbs',
  'axleCount',
  'trailerCount',
] as const;
const stringFields = [
  'name',
  'tractorType',
  'trailerType',
  'unitNumber',
  'trailerNumber',
] as const;
const boolFields = [
  'avoidTolls',
  'avoidFerries',
  'avoidHighways',
  'avoidResidential',
  'avoidDirtRoads',
  'isDefault',
] as const;
const labels: Record<string, string> = {
  heightFt: 'Height (ft)',
  widthFt: 'Width (ft)',
  lengthFt: 'Length (ft)',
  weightLbs: 'Gross weight (lb)',
  currentWeightLbs: 'Current weight (lb, optional)',
  weightPerAxleLbs: 'Weight per axle (lb, optional)',
  axleCount: 'Axles',
  trailerCount: 'Trailers',
  name: 'Profile name',
  tractorType: 'Tractor type',
  trailerType: 'Trailer type',
  unitNumber: 'Unit number',
  trailerNumber: 'Trailer number',
  avoidTolls: 'Avoid tolls',
  avoidFerries: 'Avoid ferries',
  avoidHighways: 'Avoid highways',
  avoidResidential: 'Avoid residential roads',
  avoidDirtRoads: 'Avoid dirt roads',
  isDefault: 'Default truck',
};
function formFrom(profile?: TruckProfile): Record<string, unknown> {
  return profile
    ? { ...profile, ...dimensionForm(profile) }
    : {
        id: '',
        name: '',
        isDefault: false,
        heightFt: '',
        widthFt: '',
        lengthFt: '',
        weightLbs: '',
        currentWeightLbs: null,
        weightPerAxleLbs: null,
        axleCount: '',
        trailerCount: '',
        tractorType: null,
        trailerType: null,
        unitNumber: null,
        trailerNumber: null,
        hazmatEnabled: false,
        hazardousGoods: [],
        avoidTolls: false,
        avoidFerries: false,
        avoidHighways: false,
        avoidResidential: true,
        avoidDirtRoads: true,
      };
}
function Dialog({
  children,
  close,
}: React.PropsWithChildren<{ close: () => void }>) {
  return (
    <Modal animationType="slide" onRequestClose={close}>
      <SafeAreaView style={styles.dialog}>
        <KeyboardAvoidingView
          style={styles.dialog}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >
          <ScrollView
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={styles.dialogContent}
          >
            {children}
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </Modal>
  );
}
function Choices({
  label,
  value,
  options,
  onChange,
  disabled,
}: {
  label: string;
  value: string;
  options: readonly string[];
  onChange: (value: string) => void;
  disabled: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [custom, setCustom] = useState(false);
  const known = options.some(
    option => option.toLowerCase() === value.toLowerCase(),
  );
  return (
    <View>
      <Copy>{label}</Copy>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={'Choose ' + label}
        disabled={disabled}
        onPress={() => setOpen(true)}
        style={styles.selector}
      >
        <Text style={styles.selectorText}>{value || 'Select equipment'} ▾</Text>
      </Pressable>
      {(custom || (!!value && !known)) && (
        <Field
          label={'Custom ' + label.toLowerCase()}
          value={value === 'Other / Custom' ? '' : value}
          editable={!disabled}
          maxLength={80}
          onChangeText={onChange}
        />
      )}
      {open && (
        <Dialog close={() => setOpen(false)}>
          <Heading>{label}</Heading>
          {options.map(option => (
            <Button
              key={option}
              title={option}
              onPress={() => {
                setCustom(option === 'Other / Custom');
                onChange(option === 'Other / Custom' ? '' : option);
                setOpen(false);
              }}
            />
          ))}
          <Button title="Cancel" secondary onPress={() => setOpen(false)} />
        </Dialog>
      )}
    </View>
  );
}
export function TruckProfileScreen({ services }: { services: Services }) {
  const state = useStore(services.trucks);
  const [form, setForm] = useState(formFrom());
  const [formKey, setFormKey] = useState(0);
  const [error, setError] = useState<string>();
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const scroll = useRef<ScrollView>(null);
  const fieldsTop = useRef(0);
  const fieldPositions = useRef<Record<string, number>>({});
  function showError(caught: unknown) {
    const display = profileErrors(caught);
    setError(display.message);
    setFieldErrors(display.fields);
    const first = [
      ...stringFields,
      ...numericFields.flatMap(key => [key, inchesKey(key)]),
      'hazardousGoods',
    ].find(key => display.fields[key]);
    if (first) {
      const y = fieldPositions.current[first];
      if (y !== undefined)
        scroll.current?.scrollTo({
          y: Math.max(0, fieldsTop.current + y - 16),
          animated: true,
        });
      AccessibilityInfo.announceForAccessibility(display.fields[first]!);
    }
  }
  const [busy, setBusy] = useState(false);
  const submitting = useRef(false);
  const mounted = useRef(true);
  const [review, setReview] = useState<{
    profile: TruckProfile;
    save: boolean;
  }>();
  const [acknowledged, setAcknowledged] = useState(false);
  const [deleting, setDeleting] = useState<TruckProfile>();
  const [suggestion, setSuggestion] = useState<string>();
  const update = (key: string, value: unknown) => {
    setForm(current => ({ ...current, [key]: value }));
    setFieldErrors(current => {
      const next = { ...current };
      delete next[key];
      return next;
    });
  };
  const edit = (profile?: TruckProfile) => {
    setForm(formFrom(profile));
    setFieldErrors({});
    setFormKey(key => key + 1);
    setSuggestion(undefined);
    setError(undefined);
    setReview(undefined);
  };
  useEffect(() => {
    mounted.current = true;
    services.trucks.load().catch(e => { if (mounted.current) showError(e); });
    return () => { mounted.current = false; };
  }, [services]);
  async function run(action: () => Promise<void>) {
    if (submitting.current || !mounted.current) return;
    submitting.current = true;
    setBusy(true);
    setError(undefined);
    try {
      await action();
    } catch (e) {
      if (mounted.current) showError(e);
    } finally {
      submitting.current = false;
      if (mounted.current) setBusy(false);
    }
  }
  async function openReview(profile?: TruckProfile) {
    setError(undefined);
    try {
      let checked = profile
        ? verifyRoutingProfile(profile)
        : parseTruckForm(form);
      checked = await services.trucks.prepareCreate(checked);
      if (!mounted.current) return;
      if (!checked.id) setForm(current => ({...current, createOperationId: checked.createOperationId}));
      setFieldErrors({});
      Keyboard.dismiss();
      setAcknowledged(false);
      setReview({ profile: checked, save: !profile });
    } catch (e) {
      showError(e);
    }
  }
  async function confirm() {
    if (!review || !acknowledged) return;
    const checked = review.profile;
    const saved = review.save ? await services.trucks.save(checked) : checked;
    if (!mounted.current) return;
    setForm(formFrom(saved));
    setReview({ profile: saved, save: false });
    if (
      profileFingerprint({ ...checked, id: saved.id, revision: saved.revision }) !==
      profileFingerprint(saved)
    ) {
      setAcknowledged(false);
      throw new Error(
        'The server returned different profile values. Edit and review the saved profile again.',
      );
    }
    try {
      await services.trucks.select(saved);
    } catch (failure) {
      if (mounted.current) {
        setAcknowledged(false);
        const latest = services.trucks.getSnapshot().profiles.find(item => item.id === saved.id);
        if (latest) setReview({ profile: latest, save: false });
      }
      throw failure;
    }
    if (!mounted.current) return;
    setReview(undefined);
    edit();
  }
  const goods = (form.hazardousGoods ?? []) as string[];
  const lengths = suggestedLengths(form.trailerType);
  return (
    <ScrollView
      ref={scroll}
      keyboardShouldPersistTaps="handled"
      contentContainerStyle={styles.page}
    >
      <Heading>Truck profiles</Heading>
      <Copy>
        Choose your equipment, enter its measured specifications, then verify
        before use. No dimensions or weights are assumed.
      </Copy>
      <Copy>
        {state.selected
          ? 'Active · ' + state.selected.name
          : 'No verified active truck. Review a saved profile or create one.'}
      </Copy>
      {state.profiles.map(profile => (
        <Card key={profile.id}>
          <Copy>
            {profile.name}
            {profile.verificationState === 'ADMIN_UPDATED' ? ' · Updated by operations — review required' : ''}
            {state.selected?.id === profile.id
              ? ' · Active'
              : profile.isDefault
              ? ' · Default — review required'
              : ''}
          </Copy>
          <Copy>
            {profile.tractorType || 'Equipment not specified'} ·{' '}
            {profile.trailerType || 'Trailer not specified'}
          </Copy>
          <View style={styles.actions}>
            <Button
              title="Edit"
              disabled={busy}
              onPress={() => edit(profile)}
            />
            <Button
              title="Duplicate"
              disabled={busy}
              onPress={() => edit(duplicateProfile(profile))}
            />
            <Button
              title="Delete"
              secondary
              disabled={busy || state.profiles.length < 2}
              onPress={() => {
                setError(undefined);
                setDeleting(profile);
              }}
            />
          </View>
          {state.profiles.length < 2 && (
            <Copy>
              The API requires at least one saved profile. Create another before
              deleting this one.
            </Copy>
          )}
          <Button
            title="Set Active"
            disabled={busy || state.selected?.id === profile.id}
            onPress={() => { void run(() => openReview(profile)); }}
          />
        </Card>
      ))}
      <Button title="Create profile" disabled={busy} onPress={() => edit()} />
      <View
        key={formKey}
        style={styles.fields}
        onLayout={event => {
          fieldsTop.current = event.nativeEvent.layout.y;
        }}
      >
        {stringFields.map(key => (
          <View
            key={key}
            onLayout={event => {
              fieldPositions.current[key] = event.nativeEvent.layout.y;
            }}
          >
            {key === 'tractorType' || key === 'trailerType' ? (
              <Choices
                key={key}
                label={labels[key]!}
                value={String(form[key] ?? '')}
                options={key === 'tractorType' ? tractorTypes : trailerTypes}
                disabled={busy}
                onChange={value => {
                  update(key, value || null);
                  setSuggestion(undefined);
                }}
              />
            ) : (
              <Field
                key={key}
                label={labels[key]!}
                value={String(form[key] ?? '')}
                editable={!busy}
                maxLength={key === 'name' ? 80 : 40}
                onChangeText={value =>
                  update(key, value || (key === 'name' ? '' : null))
                }
              />
            )}
            <ErrorText message={fieldErrors[key]} />
          </View>
        ))}
        <Copy>
          Equipment names identify your truck. Commercial truck routing uses the
          verified dimensions, weights, axles and trailer count below.
        </Copy>
        {lengths.length > 0 && (
          <Card>
            <Copy>Common trailer lengths — suggestions only</Copy>
            <View style={styles.actions}>
              {lengths.map(length => (
                <Button
                  key={length}
                  title={length + ' ft'}
                  secondary
                  disabled={busy}
                  onPress={() => {
                    update('lengthFt', String(length));
                    update('lengthIn', '0');
                    setSuggestion(
                      length +
                        ' ft is a nominal trailer length. Check it against your equipment and load, or override Length below.',
                    );
                  }}
                />
              ))}
              <Button
                title="Custom length"
                secondary
                disabled={busy}
                onPress={() => {
                  update('lengthFt', '');
                  update('lengthIn', '');
                  setSuggestion('Enter the actual routing length below.');
                }}
              />
            </View>
          </Card>
        )}
        <Copy>
          {suggestion ||
            'Specialized equipment and straight trucks: enter measured dimensions. No unvalidated size presets are applied.'}
        </Copy>
        {numericFields.map(key => (
          <View
            key={key}
            onLayout={event => {
              fieldPositions.current[key] = event.nativeEvent.layout.y;
              fieldPositions.current[inchesKey(key)] =
                event.nativeEvent.layout.y;
            }}
          >
            <Field
              label={labels[key]!}
              value={String(form[key] ?? '')}
              editable={!busy}
              keyboardType={
                key === 'axleCount' || key === 'trailerCount'
                  ? 'number-pad'
                  : 'decimal-pad'
              }
              onChangeText={value => update(key, value)}
            />
            {dimensionFields.some(field => field === key) && (
              <Field
                label={labels[key]!.replace('(ft)', '(in)')}
                value={String(form[inchesKey(key)] ?? '')}
                editable={!busy}
                keyboardType="decimal-pad"
                onChangeText={value => update(inchesKey(key), value)}
              />
            )}
            <ErrorText
              message={fieldErrors[key] || fieldErrors[inchesKey(key)]}
            />
            {key === 'heightFt' && (
              <Copy>
                Maximum loaded height, including equipment and cargo. Enter 13
                feet and 6 inches for 13 ft 6 in. Never enter total inches in
                Feet.
              </Copy>
            )}
            {key === 'widthFt' && (
              <Copy>
                Maximum loaded width. For 102 inches, enter 8 feet and 6 inches.
              </Copy>
            )}
            {key === 'lengthFt' && (
              <Copy>
                Trimble uses trailer length for a tractor/trailer, or full
                vehicle length for a straight truck. Include applicable load
                overhang; rigidly connected trailers use combined trailer
                length. Supported: 8–70 ft.
              </Copy>
            )}
            {key === 'weightLbs' && (
              <Copy>
                Verified gross routing weight for the whole vehicle and load.
                The existing API routes using this value; it does not substitute
                Current Weight or assume a legal maximum.
              </Copy>
            )}
            {key === 'currentWeightLbs' && (
              <Copy>
                Actual current whole-vehicle weight, if known. Saved for your
                profile; the current Trimble integration uses Gross Weight for
                routing.
              </Copy>
            )}
            {key === 'weightPerAxleLbs' && (
              <Copy>
                For Trimble this means the maximum loaded axle-group weight, not
                total weight divided by axle count. Optional; enter a measured
                group value.
              </Copy>
            )}
            {(key === 'axleCount' || key === 'trailerCount') && (
              <View style={styles.actions}>
                {(key === 'axleCount' ? [2, 3, 4, 5, 6] : [0, 1, 2, 3, 4]).map(
                  count => (
                    <Button
                      key={count}
                      title={String(count)}
                      secondary
                      disabled={busy}
                      onPress={() => update(key, String(count))}
                    />
                  ),
                )}
              </View>
            )}
            {key === 'axleCount' && (
              <Copy>
                Total vehicle axles. Select a common count or enter 2–14 above.
              </Copy>
            )}
            {key === 'trailerCount' && (
              <Copy>
                Actual trailers: 0–4 supported by the existing API. Select 0
                with No Trailer. Multiple trailers are sent as a longer
                combination vehicle; this is not permit approval.
              </Copy>
            )}
          </View>
        ))}
      </View>
      {boolFields.map(key => (
        <View key={key}>
          <Copy>{labels[key]}</Copy>
          <Switch
            accessibilityLabel={labels[key]}
            disabled={busy}
            value={form[key] === true}
            onValueChange={value => update(key, value)}
          />
        </View>
      ))}
      <Heading>Hazardous goods</Heading>
      <Copy>Select every carried class. Empty means no hazmat.</Copy>
      {hazardousGoods.map(good => (
        <View key={good}>
          <Copy>{hazmatLabels[good]}</Copy>
          <Switch
            accessibilityLabel={hazmatLabels[good]}
            disabled={busy}
            value={goods.includes(good)}
            onValueChange={enabled => {
              const next = enabled
                ? [...goods, good]
                : goods.filter(item => item !== good);
              setForm(current => ({
                ...current,
                hazardousGoods: next,
                hazmatEnabled: next.length > 0,
              }));
            }}
          />
        </View>
      ))}
      <ErrorText message={fieldErrors.hazardousGoods} />
      <ErrorText message={error} />
      <Button
        title="Review truck profile"
        disabled={busy}
        onPress={() => { void run(() => openReview()); }}
      />
      {review && (
        <Dialog
          close={() => {
            if (!busy) setReview(undefined);
          }}
        >
          <Heading>VERIFY TRUCK PROFILE</Heading>
          <Copy>
            Check these values against the actual vehicle and load before
            activating this profile.
          </Copy>
          {[...stringFields, ...numericFields].map(key => (
            <Copy key={key}>
              {labels[key]}: {String(review.profile[key] ?? 'Not supplied')}
            </Copy>
          ))}
          <Copy>
            Trimble routing weight: {review.profile.weightLbs} lb (Gross
            Weight). Weight per axle is interpreted as maximum axle-group
            weight.
          </Copy>
          <Copy>
            Hazardous goods:{' '}
            {review.profile.hazardousGoods
              .map(good => hazmatLabels[good])
              .join(', ') || 'None'}
          </Copy>
          {boolFields.map(key => (
            <Copy key={key}>
              {labels[key]}: {review.profile[key] ? 'Yes' : 'No'}
            </Copy>
          ))}
          <Copy>
            Body style is not a permit or a specialized clearance guarantee.
            Never reduce actual measurements to pass validation.
          </Copy>
          <Copy>
            I checked the dimensions, loaded weights, axle count, trailers and
            hazardous goods against this vehicle.
          </Copy>
          <Switch
            accessibilityLabel="I verified the actual truck and load"
            disabled={busy}
            value={acknowledged}
            onValueChange={setAcknowledged}
          />
          <ErrorText message={error} />
          <Button
            title="Edit"
            secondary
            disabled={busy}
            onPress={() => edit(review.profile)}
          />
          <Button
            title={busy ? 'Saving…' : 'Confirm & Use'}
            disabled={busy || !acknowledged}
            onPress={() => {
              void run(confirm);
            }}
          />
        </Dialog>
      )}
      {deleting && (
        <Dialog
          close={() => {
            if (!busy) setDeleting(undefined);
          }}
        >
          <Heading>Delete truck profile?</Heading>
          <Copy>{deleting.name}</Copy>
          <Copy>
            This removes the saved profile. Another truck will require review
            before it can become active.
          </Copy>
          <ErrorText message={error} />
          <Button
            title="Cancel"
            secondary
            disabled={busy}
            onPress={() => setDeleting(undefined)}
          />
          <Button
            title="Delete profile"
            disabled={busy}
            onPress={() => {
              void run(async () => {
                await services.trucks.delete(deleting.id);
                if (form.id === deleting.id) edit();
                setDeleting(undefined);
              });
            }}
          />
        </Dialog>
      )}
    </ScrollView>
  );
}
const styles = StyleSheet.create({
  page: { padding: 20, gap: 14, backgroundColor: colors.canvas, flexGrow: 1 },
  dialog: { flex: 1, backgroundColor: colors.canvas },
  dialogContent: { padding: 20, gap: 14 },
  fields: { gap: 14 },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  selector: {
    minHeight: 48,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 8,
    padding: 12,
    backgroundColor: 'white',
    justifyContent: 'center',
  },
  selectorText: { color: colors.ink, fontSize: 16 },
});
