import React, { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  View,
  useWindowDimensions,
  type TextInputProps,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { Services } from '../app/services';
import { AuthIcon } from '../components/AuthIcon';
import {
  emailError,
  validateAuth,
  type AuthFieldErrors,
} from '../features/auth/authValidation';
import { errorMessage } from '../components/ui';

const orange = '#FF6B2C';
type BusyAction = 'authenticate' | 'recovery' | null;

function AuthField({
  label,
  icon,
  error,
  inputRef,
  trailing,
  ...props
}: TextInputProps & {
  label: string;
  icon: 'person' | 'email' | 'lock';
  error?: string;
  inputRef: React.RefObject<TextInput | null>;
  trailing?: React.ReactNode;
}) {
  const [focused, setFocused] = useState(false);
  return (
    <View>
      <View
        style={[
          styles.field,
          focused && styles.focusedField,
          !!error && styles.invalidField,
        ]}
      >
        <AuthIcon name={icon} color={focused ? orange : '#9FAAB5'} />
        <View style={styles.inputContent}>
          {(!!props.value || focused) && (
            <Text style={styles.floatingLabel}>{label}</Text>
          )}
          <TextInput
            {...props}
            ref={inputRef}
            accessibilityLabel={label}
            accessibilityHint={error}
            placeholder={focused ? undefined : label}
            placeholderTextColor="#B6C0CA"
            selectionColor={orange}
            style={styles.input}
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
          />
        </View>
        {trailing}
      </View>
      {error && (
        <Text
          accessibilityRole="alert"
          accessibilityLiveRegion="polite"
          style={styles.fieldError}
        >
          {error}
        </Text>
      )}
    </View>
  );
}

export function AuthScreen({ services }: { services: Services }) {
  const [register, setRegister] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [visible, setVisible] = useState(false);
  const [busy, setBusy] = useState<BusyAction>(null);
  const [error, setError] = useState<string>();
  const [notice, setNotice] = useState<string>();
  const [fields, setFields] = useState<AuthFieldErrors>({});
  const [keyboardVisible, setKeyboardVisible] = useState(false);
  const [viewportHeight, setViewportHeight] = useState(0);
  const pending = useRef(false);
  const mounted = useRef(true);
  const nameInput = useRef<TextInput>(null);
  const emailInput = useRef<TextInput>(null);
  const passwordInput = useRef<TextInput>(null);
  const { width, height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  // Override both intrinsic PNG dimensions; aspectRatio alone leaves the asset height.
  const logoWidth = Math.min(188, Math.max(1, width - insets.left - insets.right - 52));

  useEffect(() => {
    mounted.current = true;
    const show = Keyboard.addListener(
      Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow',
      () => setKeyboardVisible(true),
    );
    const hide = Keyboard.addListener(
      Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide',
      () => setKeyboardVisible(false),
    );
    return () => {
      mounted.current = false;
      show.remove();
      hide.remove();
    };
  }, []);

  function changeMode(next: boolean) {
    if (pending.current || next === register) return;
    Keyboard.dismiss();
    setRegister(next);
    setVisible(false);
    setFields({});
    setError(undefined);
    setNotice(undefined);
  }
  function updateField(field: keyof AuthFieldErrors, value: string) {
    if (field === 'email') setEmail(value);
    else if (field === 'name') setName(value);
    else setPassword(value);
    setFields(current => ({ ...current, [field]: undefined }));
    setError(undefined);
    setNotice(undefined);
  }
  async function submit() {
    if (pending.current) return;
    const invalid = validateAuth(register, name, email, password);
    setFields(invalid);
    setError(undefined);
    setNotice(undefined);
    if (Object.keys(invalid).length) {
      if (invalid.name) nameInput.current?.focus();
      else if (invalid.email) emailInput.current?.focus();
      else passwordInput.current?.focus();
      return;
    }
    pending.current = true;
    setBusy('authenticate');
    Keyboard.dismiss();
    try {
      await services.auth.authenticate(
        email,
        password,
        register ? name : undefined,
      );
    } catch (e) {
      if (mounted.current) setError(errorMessage(e));
    } finally {
      pending.current = false;
      if (mounted.current) setBusy(null);
    }
  }
  async function recoverPassword() {
    if (pending.current) return;
    const invalid = emailError(email);
    setError(undefined);
    setNotice(undefined);
    if (invalid) {
      setFields(current => ({
        ...current,
        email: email.trim() ? invalid : 'Enter your email first.',
      }));
      emailInput.current?.focus();
      return;
    }
    pending.current = true;
    setBusy('recovery');
    Keyboard.dismiss();
    try {
      await services.auth.requestPasswordReset(email);
      if (mounted.current) {
        // The existing API accepts requests, but has no email delivery implementation.
        // Do not promise a recovery email or disclose whether an account exists.
        setNotice(
          'Recovery request received. Recovery email delivery is not yet available.',
        );
      }
    } catch {
      if (mounted.current)
        setError('Password recovery is temporarily unavailable.');
    } finally {
      pending.current = false;
      if (mounted.current) setBusy(null);
    }
  }
  const keyboardOffset = Math.max(
    insets.top,
    height - viewportHeight - insets.bottom,
  );
  return (
    <View
      style={styles.screen}
      onLayout={event => setViewportHeight(event.nativeEvent.layout.height)}
    >
      <StatusBar barStyle="light-content" />
      <Image
        accessible={false}
        source={require('../assets/semitrax_auth_background_v2.png')}
        resizeMode="contain"
        style={[styles.artwork, { width, height: (width * 1870) / 841 }]}
      />
      <View
        pointerEvents="none"
        style={[StyleSheet.absoluteFill, styles.overlay]}
      />
      <KeyboardAvoidingView
        style={styles.fill}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={keyboardOffset}
      >
        <ScrollView
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode={
            Platform.OS === 'ios' ? 'interactive' : 'on-drag'
          }
          contentContainerStyle={[
            styles.scroll,
            keyboardVisible && styles.keyboardScroll,
          ]}
        >
          <View style={styles.content}>
            <View style={[styles.logoFrame, { width: logoWidth + 12 }]}>
              <Image
                accessibilityLabel="Semi-TraX — Smarter routes. Safer deliveries."
                source={require('../assets/semitrax_login_lockup.png')}
                resizeMode="contain"
                style={[styles.logo, { width: logoWidth, height: (logoWidth * 541) / 1723 }]}
              />
            </View>
            <View style={styles.introduction}>
              <Text accessibilityRole="header" style={styles.heading}>
                {register
                  ? 'Create your driver account'
                  : 'Truck-safe navigation starts here'}
              </Text>
              <Text style={styles.subtitle}>
                {register
                  ? 'Build a secure profile for your commercial vehicle.'
                  : 'Routes built around your vehicle—not a passenger car.'}
              </Text>
              <View style={styles.accent} />
            </View>
            <View
              style={{
                height:
                  28 + (keyboardVisible ? 18 : viewportHeight > 760 ? 122 : 36),
              }}
            />
            <View style={styles.card}>
              <View style={styles.modes} accessibilityRole="tablist">
                {[false, true].map(mode => (
                  <Pressable
                    key={String(mode)}
                    accessibilityRole="tab"
                    accessibilityLabel={
                      mode ? 'Create account mode' : 'Sign in mode'
                    }
                    accessibilityState={{
                      selected: register === mode,
                      disabled: !!busy,
                    }}
                    disabled={!!busy}
                    onPress={() => changeMode(mode)}
                    style={({ pressed }) => [
                      styles.mode,
                      register === mode && styles.selectedMode,
                      pressed && styles.pressed,
                    ]}
                  >
                    <Text
                      style={[
                        styles.modeText,
                        register === mode && styles.selectedModeText,
                      ]}
                    >
                      {mode ? 'Create account' : 'Sign in'}
                    </Text>
                  </Pressable>
                ))}
              </View>
              <View style={styles.fields}>
                {register && (
                  <AuthField
                    label="Full name"
                    icon="person"
                    value={name}
                    inputRef={nameInput}
                    error={fields.name}
                    editable={!busy}
                    onChangeText={value => updateField('name', value)}
                    autoComplete="name"
                    textContentType="name"
                    autoCapitalize="words"
                    returnKeyType="next"
                    submitBehavior="submit"
                    onSubmitEditing={() => emailInput.current?.focus()}
                  />
                )}
                <AuthField
                  label="Email"
                  icon="email"
                  value={email}
                  inputRef={emailInput}
                  error={fields.email}
                  editable={!busy}
                  onChangeText={value => updateField('email', value)}
                  autoComplete="email"
                  textContentType="emailAddress"
                  autoCapitalize="none"
                  autoCorrect={false}
                  keyboardType="email-address"
                  returnKeyType="next"
                  submitBehavior="submit"
                  onSubmitEditing={() => passwordInput.current?.focus()}
                />
                <AuthField
                  label="Password"
                  icon="lock"
                  value={password}
                  inputRef={passwordInput}
                  error={fields.password}
                  editable={!busy}
                  onChangeText={value => updateField('password', value)}
                  secureTextEntry={!visible}
                  autoCapitalize="none"
                  autoCorrect={false}
                  autoComplete={register ? 'new-password' : 'current-password'}
                  textContentType={register ? 'newPassword' : 'password'}
                  returnKeyType="go"
                  onSubmitEditing={() => {
                    void submit();
                  }}
                  trailing={
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={
                        visible ? 'Hide password' : 'Show password'
                      }
                      accessibilityState={{ disabled: !!busy }}
                      disabled={!!busy}
                      onPress={() => setVisible(current => !current)}
                      style={styles.visibility}
                    >
                      <AuthIcon name={visible ? 'hidden' : 'visible'} />
                    </Pressable>
                  }
                />
              </View>
              {!register ? (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Forgot password?"
                  accessibilityState={{
                    disabled: !!busy,
                    busy: busy === 'recovery',
                  }}
                  disabled={!!busy}
                  onPress={() => {
                    void recoverPassword();
                  }}
                  style={styles.recovery}
                >
                  {busy === 'recovery' ? (
                    <ActivityIndicator
                      accessibilityLabel="Requesting password recovery"
                      color={orange}
                    />
                  ) : (
                    <Text style={styles.recoveryText}>Forgot password?</Text>
                  )}
                </Pressable>
              ) : (
                <View style={styles.registrationGap} />
              )}
              {error && (
                <Text
                  accessibilityRole="alert"
                  accessibilityLiveRegion="assertive"
                  style={styles.messageError}
                >
                  {error}
                </Text>
              )}
              {notice && (
                <Text accessibilityLiveRegion="polite" style={styles.notice}>
                  {notice}
                </Text>
              )}
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={register ? 'Create account' : 'Sign in'}
                accessibilityState={{
                  disabled: !!busy,
                  busy: busy === 'authenticate',
                }}
                disabled={!!busy}
                onPress={() => {
                  void submit();
                }}
                style={({ pressed }) => [
                  styles.primary,
                  !!busy && styles.disabled,
                  pressed && styles.pressed,
                ]}
              >
                {busy === 'authenticate' ? (
                  <ActivityIndicator
                    accessibilityLabel={
                      register ? 'Creating account' : 'Signing in'
                    }
                    color="#FFF"
                  />
                ) : (
                  <Text style={styles.primaryText}>
                    {register ? 'Create account' : 'Sign in'}
                  </Text>
                )}
              </Pressable>
              <View style={styles.footer}>
                <AuthIcon name="shield" size={16} />
                <Text style={styles.footerText}>
                  Secure access for commercial drivers
                </Text>
              </View>
            </View>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}
const styles = StyleSheet.create({
  fill: { flex: 1 },
  screen: { flex: 1, backgroundColor: '#0C131B', overflow: 'hidden' },
  artwork: { position: 'absolute', top: -175, alignSelf: 'center' },
  overlay: {
    experimental_backgroundImage:
      'linear-gradient(to bottom, #0A121BD9 0%, #111C2759 28%, #0A121BB8 66%, #071019 100%)',
  },
  scroll: {
    flexGrow: 1,
    paddingHorizontal: 20,
    paddingTop: 22,
    paddingBottom: 28,
  },
  keyboardScroll: { paddingBottom: 20 },
  content: { width: '100%', maxWidth: 500, alignSelf: 'center' },
  logoFrame: {
    width: '100%',
    maxWidth: 200,
    alignSelf: 'center',
    marginTop: 8,
    marginBottom: 4,
    padding: 5,
    backgroundColor: '#000000E6',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#FFFFFF26',
    boxShadow: '0px 4px 12px #00000044',
  },
  logo: { borderRadius: 9 },
  introduction: { marginTop: 20, alignItems: 'flex-start' },
  heading: {
    color: '#FFF',
    fontSize: 27,
    lineHeight: 30,
    fontWeight: '900',
    letterSpacing: -0.8,
  },
  subtitle: {
    color: '#C1CAD3',
    fontSize: 16,
    lineHeight: 23,
    fontWeight: '500',
    marginTop: 12,
  },
  accent: {
    width: 54,
    height: 3,
    borderRadius: 20,
    backgroundColor: orange,
    marginTop: 15,
  },
  card: {
    padding: 20,
    backgroundColor: '#101A24EE',
    borderRadius: 27,
    borderWidth: 1,
    borderColor: '#FFFFFF1F',
    boxShadow: '0px 18px 34px #000000A6',
  },
  modes: { flexDirection: 'row', gap: 8, marginBottom: 20 },
  mode: {
    flex: 1,
    minHeight: 48,
    paddingVertical: 13,
    paddingHorizontal: 8,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#FFFFFF1F',
    justifyContent: 'center',
  },
  selectedMode: {
    backgroundColor: '#FF6B2C1A',
    borderColor: orange,
    borderWidth: 1.5,
  },
  modeText: {
    color: '#FFF',
    fontSize: 14,
    fontWeight: '900',
    textAlign: 'center',
  },
  selectedModeText: { color: orange },
  fields: { gap: 13 },
  field: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingLeft: 14,
    paddingRight: 4,
    gap: 12,
    minHeight: 58,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#FFFFFF1F',
    backgroundColor: '#202C38',
  },
  focusedField: { borderColor: orange },
  invalidField: { borderColor: '#FFB4AB' },
  inputContent: { flex: 1, paddingVertical: 7 },
  floatingLabel: { color: '#B6C0CA', fontSize: 12 },
  input: {
    color: '#FFF',
    fontSize: 16,
    minHeight: 30,
    padding: 0,
    paddingRight: 8,
  },
  fieldError: {
    color: '#FFB4AB',
    fontSize: 13,
    lineHeight: 19,
    marginTop: 5,
    marginLeft: 12,
  },
  visibility: {
    minWidth: 48,
    minHeight: 48,
    alignItems: 'center',
    justifyContent: 'center',
  },
  recovery: {
    alignSelf: 'flex-end',
    minHeight: 48,
    paddingHorizontal: 8,
    justifyContent: 'center',
  },
  recoveryText: { color: orange, fontSize: 14, fontWeight: '600' },
  registrationGap: { height: 18 },
  primary: {
    backgroundColor: orange,
    borderRadius: 14,
    minHeight: 52,
    padding: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryText: {
    color: '#FFF',
    fontSize: 16,
    fontWeight: '800',
    textAlign: 'center',
  },
  disabled: { opacity: 0.65 },
  pressed: { opacity: 0.8 },
  footer: {
    marginTop: 16,
    flexDirection: 'row',
    gap: 7,
    alignItems: 'center',
    justifyContent: 'center',
  },
  footerText: {
    flexShrink: 1,
    color: '#9FAAB5',
    fontSize: 12,
    fontWeight: '700',
    textAlign: 'center',
  },
  messageError: {
    color: '#FFB4AB',
    fontSize: 14,
    lineHeight: 21,
    marginBottom: 14,
  },
  notice: { color: '#C1CAD3', fontSize: 14, lineHeight: 21, marginBottom: 14 },
});
