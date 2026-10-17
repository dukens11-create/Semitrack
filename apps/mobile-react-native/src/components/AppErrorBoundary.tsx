import React from 'react';
import { Page, Heading, Copy, Button } from './ui';
import { safeLog } from '../services/telemetry/safeLog';
export class AppErrorBoundary extends React.Component<React.PropsWithChildren<{ onFailure: () => void }>, { failed: boolean }> {
  override state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  override componentDidCatch() { safeLog('RENDER_FAILED'); this.props.onFailure(); }
  override render() {
    if (this.state.failed) return <Page><Heading>SemiTraX needs to recover</Heading><Copy>The current screen could not be displayed. Routing has been cleared. Retry the screen, or close and reopen the app if the problem continues.</Copy><Button title="Retry screen" onPress={() => this.setState({ failed: false })} /></Page>;
    return this.props.children;
  }
}
