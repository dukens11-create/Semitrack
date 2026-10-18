import { useEffect, useState } from 'react';
import { AppState, DeviceEventEmitter } from 'react-native';
import { coPilotHost } from '../../services/copilot/CoPilotHost';
import { guidanceSampleSchema } from '../../services/copilot/CoPilotGuidance';
import { engineMapSnapshotSchema, type EngineMapSnapshot } from './engineMapProof';

export function useEngineMapSnapshot() {
  const [sample, setSample] = useState<EngineMapSnapshot>();
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    let current = true, pending = false, generation = 0;
    let revision: number | undefined;
    const refresh = async () => {
      setNow(Date.now());
      if (pending || AppState.currentState !== 'active') return;
      pending = true;
      const ticket = generation;
      try {
        const parsed = engineMapSnapshotSchema.safeParse(await coPilotHost().guidanceMapSnapshot?.());
        if (!current || ticket !== generation || AppState.currentState !== 'active') return;
        if (!parsed.success || (revision !== undefined && parsed.data.routeRevision !== revision)) setSample(undefined);
        else { revision = parsed.data.routeRevision; setSample(parsed.data); }
      } catch { if (current && ticket === generation) setSample(undefined); }
      finally { pending = false; }
    };
    const events = DeviceEventEmitter.addListener('SemiTraxCoPilotGuidance', raw => {
      const value = guidanceSampleSchema.safeParse(raw);
      if (!value.success) return;
      if (value.data.routeStatus !== 'ready' || value.data.routeRevision !== revision) {
        generation++;
        revision = value.data.routeRevision;
        setSample(undefined);
      }
    });
    const lifecycle = AppState.addEventListener('change', () => {
      generation++;
      setSample(undefined);
    });
    const timer = setInterval(() => { void refresh(); }, 2000);
    void refresh();
    return () => { current = false; generation++; clearInterval(timer); events.remove(); lifecycle.remove(); };
  }, []);
  return { sample, now };
}
