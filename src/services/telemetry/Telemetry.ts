import type { ApiClient } from '../api/ApiClient';
export class Telemetry {
  constructor(private api: ApiClient) {}
  async appOpened() {
    try {
      await this.api.request('POST', '/analytics/events', {
        eventType: 'APP_OPENED',
      });
    } catch {
      /* Never interrupt routing for analytics. No raw account/coordinate logging. */
    }
  }
}
