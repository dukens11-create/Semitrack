import React, { useEffect, useRef, useState } from 'react';
import type { AuthStore } from './AuthStore';
import { resetToken, resetPasswordError } from './resetLink';
import { DriverSheet } from '../../components/DriverSheet';
import {
  DriverButton,
  DriverCopy,
  DriverField,
} from '../../components/DriverUI';
import { ErrorText } from '../../components/ui';
export function PasswordRecoveryPanel({
  auth,
  onClose,
  initialLink = '',
}: {
  auth: AuthStore;
  onClose: () => void;
  initialLink?: string;
}) {
  const [link, setLink] = useState(initialLink),
    [password, setPassword] = useState(''),
    [confirmation, setConfirmation] = useState('');
  const [error, setError] = useState<string>(),
    [complete, setComplete] = useState(false),
    [busy, setBusy] = useState(false);
  const pending = useRef(false);
  useEffect(() => {
    if (initialLink && !pending.current && !complete) setLink(initialLink);
  }, [initialLink, complete]);
  async function submit() {
    if (pending.current) return;
    const token = resetToken(link),
      invalid = resetPasswordError(password, confirmation);
    if (!token || invalid) {
      setError(
        !token ? 'Paste a valid recovery link from your email.' : invalid!,
      );
      return;
    }
    pending.current = true;
    setBusy(true);
    setError(undefined);
    try {
      await auth.confirmPasswordReset(token, password);
      setComplete(true);
      setLink('');
    } catch (e) {
      setError(
        (e as { code?: string }).code === 'INVALID_RESET_TOKEN'
          ? 'This reset link is invalid, expired, or already used. Request a new recovery email.'
          : 'Password reset is temporarily unavailable. Retry later.',
      );
    } finally {
      setPassword('');
      setConfirmation('');
      pending.current = false;
      setBusy(false);
    }
  }
  return (
    <DriverSheet title="Reset password" onClose={onClose}>
      {complete ? (
        <>
          <DriverCopy>
            Password reset successfully. Sign in with your new password.
          </DriverCopy>
          <DriverButton title="Return to Sign In" onPress={onClose} />
        </>
      ) : (
        <>
          <DriverCopy>
            Paste the recovery link from your email. It is sent only to the
            configured SemiTraX API and is not saved.
          </DriverCopy>
          <DriverField
            label="Recovery link"
            value={link}
            onChangeText={setLink}
            secureTextEntry
            autoCapitalize="none"
            autoCorrect={false}
            editable={!busy}
          />
          <DriverField
            label="New password"
            value={password}
            onChangeText={setPassword}
            secureTextEntry
            autoCapitalize="none"
            autoCorrect={false}
            editable={!busy}
          />
          <DriverField
            label="Confirm new password"
            value={confirmation}
            onChangeText={setConfirmation}
            secureTextEntry
            autoCapitalize="none"
            autoCorrect={false}
            editable={!busy}
          />
          <ErrorText message={error} />
          <DriverButton
            title={busy ? 'Resetting password…' : 'Reset password'}
            disabled={busy}
            onPress={() => {
              void submit();
            }}
          />
        </>
      )}
    </DriverSheet>
  );
}
