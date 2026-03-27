import type { EldDriverClock, EldProvider, EldVehicleLocation } from "./types.js";

export class MotiveProvider implements EldProvider {
  constructor(private apiToken: string) {}

  async getDriverClocks(): Promise<EldDriverClock[]> {
    return [];
  }

  async getVehicleLocations(): Promise<EldVehicleLocation[]> {
    return [];
  }
}
