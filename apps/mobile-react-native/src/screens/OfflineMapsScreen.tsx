import React, { useEffect, useRef, useState } from 'react';
import type { Services } from '../app/services';
import { Page, Heading, Copy, Button } from '../components/ui';
import { CoPilotDeviceSetup } from '../components/CoPilotDeviceSetup';
import { useCopilotState } from '../services/copilot/CopilotProvider';
export function OfflineMapsScreen({ services }: { services: Services }) {
  const state = useCopilotState();
  const [connection, setConnection] = useState(
    'Backend connectivity is separate from CoPilot map setup.',
  );
  const [busy, setBusy] = useState(false);
  const live = useRef(true);
  const pending = useRef(false);
  useEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
    };
  }, []);
  async function connectivity() {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    try {
      await services.api.request('GET', '/health');
      if (live.current)
        setConnection(
          'SemiTraX API reachable. CoPilot licensing and maps are checked independently.',
        );
    } catch {
      if (live.current)
        setConnection(
          'SemiTraX API unreachable. Verified CoPilot offline maps remain stored.',
        );
    } finally {
      pending.current = false;
      if (live.current) setBusy(false);
    }
  }
  return (
    <Page>
      <Heading>CoPilot offline maps</Heading>
      <Copy>
        California coverage downloads automatically on Wi-Fi after this phone’s
        assigned license is verified. Keep SemiTraX open during setup.
      </Copy>
      <Copy>
        {state.mapsReady
          ? 'California offline map verified in CoPilot inventory.'
          : 'California offline map installation has not been verified.'}
      </Copy>
      <Copy>
        Installed CoPilot packages: {state.maps?.installed.length ?? 0}
      </Copy>
      {state.maps?.installed.map(map => (
        <Copy
          key={`${map.set}-${map.year}-${map.quarter}-${map.versionString}`}
        >
          {map.versionString} · {map.year} Q{map.quarter}
        </Copy>
      ))}
      <Copy>
        Map installation does not enable live guidance. Truck-profile and route
        coverage verification are still required.
      </Copy>
      <CoPilotDeviceSetup />
      <Copy>{connection}</Copy>
      <Button
        title="Check API connectivity"
        disabled={busy}
        onPress={() => {
          void connectivity();
        }}
      />
    </Page>
  );
}
