import React, { useEffect, useRef, useState } from 'react';
import { Linking } from 'react-native';
import type { AuthStore } from './AuthStore';
import { automaticResetToken } from './resetLink';
import { PasswordRecoveryPanel } from './PasswordRecoveryPanel';

/** Signed-out entry only. Never logs, persists, or follows the incoming URL. */
export function RecoveryLinkEntry({
  auth,
  onOpen,
}: {
  auth: AuthStore;
  onOpen?: () => void;
}) {
  const [entry, setEntry] = useState<{ token: string; sequence: number }>();
  const sequence = useRef(0);
  const open = useRef(onOpen);
  open.current = onOpen;
  useEffect(() => {
    let active = true;
    let receivedLiveLink = false;
    const receive = (url: string) => {
      if (!active) return;
      const token = automaticResetToken(url);
      if (token) {
        open.current?.();
        setEntry({ token, sequence: ++sequence.current });
      }
    };
    const listener = Linking.addEventListener('url', event => {
      receivedLiveLink = true;
      receive(event.url);
    });
    void Linking.getInitialURL()
      .then(url => {
        if (url && !receivedLiveLink) receive(url);
      })
      .catch(() => {
        /* Never expose a native error containing a reset URL. */
      });
    return () => {
      active = false;
      listener.remove();
    };
  }, []);
  return entry ? (
    <PasswordRecoveryPanel
      key={entry.sequence}
      auth={auth}
      initialToken={entry.token}
      onClose={() => setEntry(undefined)}
    />
  ) : null;
}
