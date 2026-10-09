import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from 'react';
import { AppState } from 'react-native';
import { NativeLocationProvider } from '../../native/navigation/NativeLocationProvider';
import { CopilotLifecycle, initialCopilotState } from './CopilotLifecycle';
import { createCopilotRuntime } from './CopilotRuntime';
import { AutomaticMapDownload } from './AutomaticMapDownload';
import { coPilotHost, selectedMapInstalled } from './CoPilotHost';
const StateContext = createContext(initialCopilotState());
const SetupContext = createContext({
  downloadStatus: '',
  retry: async () => {},
  configure: async (_company: string, _device: string) => {},
});
export const useCopilotState = () => useContext(StateContext);
export const useCopilotSetup = () => useContext(SetupContext);
export function CopilotProvider({ children }: React.PropsWithChildren) {
  const [state, setState] = useState(initialCopilotState);
  const [downloadStatus, setDownloadStatus] = useState('');
  const latest = useRef(state);
  const lifecycle = useRef<CopilotLifecycle | null>(null);
  const download = useRef<AutomaticMapDownload | null>(null);
  const active = useRef(AppState.currentState === 'active');
  const live = useRef(false);
  const firstMapSignalHandled = useRef(false);
  const synchronize = useCallback(() => {
    const current = latest.current;
    // One genuine SDK readiness signal permits a fresh bounded attempt after startup busy errors.
    if (
      current.lastEvent === 'onReadyToDownloadInitialMapData' &&
      !firstMapSignalHandled.current
    ) {
      firstMapSignalHandled.current = true;
      download.current?.stop();
      download.current = null;
    }
    const eligible =
      active.current &&
      current.initialized &&
      current.licensingReady &&
      current.fullNavigationLicensed &&
      current.heavyTruckLicensed &&
      current.error === 'COPILOT_MAP_DATA_REQUIRED';
    if (!eligible) {
      download.current?.stop();
      download.current = null;
      return;
    }
    if (download.current) return;
    download.current = new AutomaticMapDownload(
      {
        active: () => live.current && active.current,
        installed: selectedMapInstalled,
        download: () => coPilotHost().downloadSelectedMap(),
        refresh: async () => {
          await lifecycle.current?.recheck();
        },
      },
      status => {
        if (live.current) setDownloadStatus(status);
      },
    );
    void download.current.tick();
  }, []);
  const retry = useCallback(async () => {
    if (!live.current) return;
    download.current?.stop();
    download.current = null;
    lifecycle.current?.dispose();
    firstMapSignalHandled.current = false;
    setDownloadStatus('');
    const next = new CopilotLifecycle(createCopilotRuntime(), value => {
      if (!live.current) return;
      latest.current = value;
      setState(value);
      synchronize();
    });
    lifecycle.current = next;
    await next.start();
    const result = next.snapshot();
    if (!result.initialized) {
      throw new Error('CoPilot startup did not complete.');
    }
  }, [synchronize]);
  const retrySaved = useCallback(async () => {
    const location = new NativeLocationProvider();
    if (
      (await location.permissionStatus()) !== 'granted' &&
      (await location.permission(false)) !== 'granted'
    )
      throw new Error('Precise location is required for CoPilot startup.');
    await retry();
  }, [retry]);
  const configure = useCallback(
    async (company: string, device: string) => {
      const location = new NativeLocationProvider();
      if (
        (await location.permissionStatus()) !== 'granted' &&
        (await location.permission(false)) !== 'granted'
      )
        throw new Error('Precise location is required for CoPilot startup.');
      // Invoked by explicit setup action; native storage never returns the IDs.
      await coPilotHost().configureDevice(
        company.trim(),
        device.trim(),
        'NORTH_AMERICA_California',
      );
      await retry();
    },
    [retry],
  );
  useEffect(() => {
    live.current = true;
    void retry().catch(() => {});
    const subscription = AppState.addEventListener('change', next => {
      active.current = next === 'active';
      if (active.current) {
        if (latest.current.initialized)
          void lifecycle.current?.recheck().then(synchronize);
        else void retry().catch(() => {});
      } else synchronize();
    });
    return () => {
      live.current = false;
      subscription.remove();
      download.current?.stop();
      lifecycle.current?.dispose();
    };
  }, [retry, synchronize]);
  return (
    <StateContext.Provider value={state}>
      <SetupContext.Provider
        value={{ downloadStatus, retry: retrySaved, configure }}
      >
        {children}
      </SetupContext.Provider>
    </StateContext.Provider>
  );
}
