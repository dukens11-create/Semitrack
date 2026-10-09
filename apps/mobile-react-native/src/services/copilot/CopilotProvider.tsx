import React, { createContext, useContext, useEffect, useState } from 'react';
import { CopilotLifecycle, initialCopilotState } from './CopilotLifecycle';
import { createCopilotRuntime } from './CopilotRuntime';
const Context = createContext(initialCopilotState());
export const useCopilotState = () => useContext(Context);
export function CopilotProvider({ children }: React.PropsWithChildren) {
  const [state, setState] = useState(initialCopilotState);
  useEffect(() => {
    const lifecycle = new CopilotLifecycle(createCopilotRuntime(), next => {
      setState(next);
      if (__DEV__)
        console.info(
          '[SemiTraX CoPilot]',
          JSON.stringify({
            phase: next.phase,
            error: next.error,
            operation: next.operation,
            modules: next.modules,
            initialized: next.initialized,
            licensingReady: next.licensingReady,
            fullNavigationLicensed: next.fullNavigationLicensed,
            heavyTruckLicensed: next.heavyTruckLicensed,
            mapsReady: next.mapsReady,
            readyToAddStops: next.readyToAddStops,
            copilotReady: next.copilotReady,
            lastEvent: next.lastEvent,
          }),
        );
    });
    void lifecycle.start();
    return () => lifecycle.dispose();
  }, []);
  return <Context.Provider value={state}>{children}</Context.Provider>;
}
