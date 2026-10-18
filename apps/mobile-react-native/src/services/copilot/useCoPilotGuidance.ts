import { useEffect, useState } from 'react';
import { AppState, DeviceEventEmitter } from 'react-native';
import { coPilotHost } from './CoPilotHost';
import {
  guidanceSampleSchema,
  type CoPilotGuidanceSample,
} from './CoPilotGuidance';

export function useCoPilotGuidance(active: boolean) {
  const [sample, setSample] = useState<CoPilotGuidanceSample>();
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    setSample(undefined);
    if (!active) return;
    let current = true;
    let latestSequence = -1;
    let pending = false;
    const receive = (raw: unknown) => {
      if (!current || AppState.currentState !== 'active') return;
      const parsed = guidanceSampleSchema.safeParse(raw);
      if (!parsed.success || parsed.data.sequence <= latestSequence) return;
      latestSequence = parsed.data.sequence;
      setSample(parsed.data);
      setNow(Date.now());
    };
    const refresh = async () => {
      setNow(Date.now());
      if (pending || AppState.currentState !== 'active') return;
      pending = true;
      try {
        receive(await coPilotHost().guidanceSnapshot?.());
      } catch {
        if (current) setSample(undefined);
      } finally {
        pending = false;
      }
    };
    const subscription = DeviceEventEmitter.addListener(
      'SemiTraxCoPilotGuidance',
      receive,
    );
    const lifecycle = AppState.addEventListener('change', state => {
      setSample(undefined);
      if (state === 'active') void refresh();
    });
    // Refresh handles screen remounts and clears stale GPS even if callbacks stop.
    const timer = setInterval(() => {
      void refresh();
    }, 1000);
    void refresh();
    return () => {
      current = false;
      clearInterval(timer);
      subscription.remove();
      lifecycle.remove();
    };
  }, [active]);
  return { sample, now };
}
