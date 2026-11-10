import React, { useEffect, useRef, useState } from 'react';
import { Switch } from 'react-native';
import { Alert } from './ThemedAlert';
import { Button, Copy } from './ui';
import { coPilotHost } from '../services/copilot/CoPilotHost';

type Region = { name: string; installed: boolean; downloadStatus?: string };
export function CoPilotMapCatalog() {
  const [regions, setRegions] = useState<Region[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [cellular, setCellular] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('Load your licensed regions to add more offline coverage.');
  const live = useRef(true);
  const pending = useRef(false);
  useEffect(() => { live.current = true; return () => { live.current = false; }; }, []);
  async function refresh() {
    const host = coPilotHost();
    if (!host.licensedMapCatalog) throw new Error('Install the latest map-management APK.');
    const rows = await host.licensedMapCatalog();
    if (live.current) {
      setRegions(rows);
      setSelected(old => old.filter(name => rows.some(row => row.name === name && !row.installed)));
    }
    return rows;
  }
  async function run(download: boolean) {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    setMessage(download ? 'Starting or resuming selected map downloads…' : 'Checking licensed and installed maps…');
    try {
      if (download) {
        const host = coPilotHost();
        if (!host.downloadLicensedRegions) throw new Error('Install the latest map-management APK.');
        const result = await host.downloadLicensedRegions(selected, cellular);
        const resultMessage = result === 'INSTALLED'
          ? 'Selected packages are installed.'
          : result === 'SUCCESS'
          ? 'Selected downloads were accepted or are already in progress. A paused download was resumed if possible. Keep SemiTraX open and refresh installed maps to verify completion.'
          : result === 'FAILURE_PAUSED'
          ? 'The SDK still reports this download paused after a resume attempt. Check free storage and connection, then retry. Existing maps are preserved.'
          : result === 'FAILURE_INSUFFICIENT_DISK_SPACE' || result === 'WAITING_ON_STORAGE_SPACE'
          ? 'More free storage is required before this download can continue. Existing maps are preserved.'
          : result === 'FAILURE_MANAGER_BUSY'
          ? 'CoPilot could not accept this request because its map manager is busy. No new download is confirmed. Existing maps are preserved. Share diagnostics so we can identify the blocked operation.'
          : 'SemiTraX download response: ' + result + '. Refresh before retrying.';
        if (live.current) {
          setMessage(resultMessage);
          Alert.alert('SemiTraX map download', resultMessage);
        }
      } else {
        const rows = await refresh();
        if (live.current) setMessage(rows.length
          ? 'Select licensed regions below. A United States package may be available; otherwise choose individual regions. Only listed packages are authorized by your license.'
          : 'No downloadable regions were returned by SemiTraX. Check your map entitlement with Trimble.');
      }
    } catch (error) {
      if (live.current) {
        const detail = error instanceof Error ? error.message : 'Map management is unavailable.';
        setMessage(detail);
        Alert.alert('SemiTraX map request failed', detail);
      }
    } finally {
      pending.current = false;
      if (live.current) setBusy(false);
    }
  }
  return <>
    <Copy>Additional offline maps</Copy>
    <Copy>{message}</Copy>
    <Button title="Refresh licensed and installed maps" disabled={busy} onPress={() => { void run(false); }} />
    <Copy>Allow mobile data for these downloads (large downloads may use substantial data).</Copy>
    <Switch accessibilityLabel="Allow mobile data for additional maps" value={cellular} disabled={busy} onValueChange={setCellular} />
    <Copy>{selected.length} map packages selected.</Copy>
    <Button title="Download / resume selected maps" disabled={busy || !selected.length} onPress={() => { void run(true); }} />
    {regions.map(region => <Button
      key={region.name}
      title={(region.installed ? 'Installed: ' : selected.includes(region.name) ? 'Selected: ' : 'Select: ') + region.name.replace(/_/g, ' ') + (region.downloadStatus && region.downloadStatus !== 'NOT_INITIATED' ? ' · ' + region.downloadStatus.replace(/_/g, ' ') : '')}
      disabled={busy || region.installed}
      onPress={() => setSelected(old => old.includes(region.name) ? old.filter(name => name !== region.name) : region.name === 'NORTH_AMERICA_North_America' ? [region.name] : [...old.filter(name => name !== 'NORTH_AMERICA_North_America'), region.name])}
    />)}
    <Copy>Installed maps are preserved. Map downloads do not grant truck-route or navigation readiness.</Copy>
  </>;
}
