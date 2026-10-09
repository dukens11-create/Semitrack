export interface AutomaticMapPort {
  active(): boolean;
  installed(): Promise<boolean>;
  download(): Promise<string>;
  refresh(): Promise<void>;
}

/** A download response is not installation proof. Only inventory ends the job. */
export class AutomaticMapDownload {
  private stopped = false;
  private attempts = 0;
  private started = false;
  private pending = false;
  private checks = 0;
  private timer?: ReturnType<typeof setTimeout>;
  constructor(
    private port: AutomaticMapPort,
    private report: (status: string) => void,
  ) {}
  async tick(): Promise<void> {
    if (this.stopped || this.pending || !this.port.active()) return;
    clearTimeout(this.timer);
    this.pending = true;
    try {
      if (await this.port.installed()) {
        if (this.stopped) return;
        await this.port.refresh();
        this.report('Selected offline map verified in installed inventory.');
        this.stop();
        return;
      }
      if (this.stopped || !this.port.active()) return;
      if (!this.started) {
        if (this.attempts >= 3) {
          this.report(
            'CoPilot is still busy. Retry map setup after checking Wi-Fi and storage.',
          );
          this.stop();
          return;
        }
        ++this.attempts;
        const response = await this.port.download();
        if (this.stopped) return;
        if (
          [
            'SUCCESS',
            'FAILURE_DOWNLOADING',
            'FAILURE_DOWNLOADED',
            'FAILURE_INSTALLED',
            'INSTALLED',
          ].includes(response)
        ) {
          this.started = true;
          this.report(
            'Checking download and installation progress… Keep SemiTraX open on Wi-Fi.',
          );
        } else if (
          ['FAILURE_MANAGER_BUSY', 'FAILURE_INVALID_CONNECTION'].includes(
            response,
          )
        ) {
          this.report(
            'Waiting for CoPilot or Wi-Fi. Setup will retry automatically.',
          );
        } else {
          this.report(
            response === 'FAILURE_INSUFFICIENT_DISK_SPACE'
              ? 'Free storage is needed before the offline map can download.'
              : 'CoPilot could not accept the map download. Check device setup, Wi-Fi and storage.',
          );
          this.stop();
          return;
        }
      }
      if (++this.checks >= 120) {
        this.report(
          'Installation has not been verified yet. Retry map setup to check again.',
        );
        this.stop();
        return;
      }
    } catch {
      if (!this.stopped) {
        this.report(
          'Map setup could not be verified. Check device licensing, Wi-Fi and storage, then retry.',
        );
        this.stop();
      }
    } finally {
      this.pending = false;
      if (!this.stopped && this.port.active())
        this.timer = setTimeout(() => {
          void this.tick();
        }, 5000);
    }
  }
  stop() {
    this.stopped = true;
    clearTimeout(this.timer);
  }
}
