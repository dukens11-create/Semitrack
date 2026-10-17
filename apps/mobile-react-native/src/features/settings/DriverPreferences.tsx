import React, { createContext, useEffect } from 'react';
import type { Services } from '../../app/services';
import { useStore } from '../../hooks/useStore';
export const DriverAppearanceContext = createContext<
  'system' | 'day' | 'night'
>('system');
export function DriverPreferences({
  services,
  children,
}: React.PropsWithChildren<{ services: Services }>) {
  const state = useStore(services.settings);
  useEffect(() => {
    void services.settings.load().catch(() => {});
  }, [services]);
  return (
    <DriverAppearanceContext.Provider
      value={state.settings?.dayNightMode ?? 'system'}
    >
      {children}
    </DriverAppearanceContext.Provider>
  );
}
