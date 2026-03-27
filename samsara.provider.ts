import type { EldDriverClock, EldProvider, EldVehicleLocation } from "./types.js";

const BASE = "https://api.samsara.com";

export class SamsaraProvider implements EldProvider {
  constructor(private apiToken: string) {}

  private async get(path: string) {
    const res = await fetch(`${BASE}${path}`, {
      headers: {
        Authorization: `Bearer ${this.apiToken}`,
        Accept: "application/json",
      },
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Samsara API failed: ${res.status} ${text}`);
    }

    return res.json();
  }

  async getDriverClocks(): Promise<EldDriverClock[]> {
    const data = await this.get("/fleet/hos/clocks");
    const items = data.data ?? data.results ?? [];

    return items.map((item: any) => ({
      provider: "samsara",
      driverId: String(item.driver?.id ?? item.driverId ?? ""),
      dutyStatus: item.clocks?.dutyStatus ?? item.dutyStatus ?? null,
      breakMinutesLeft: item.clocks?.breakTimeRemainingMs != null ? Math.round(item.clocks.breakTimeRemainingMs / 60000) : null,
      driveMinutesLeft: item.clocks?.driveTimeRemainingMs != null ? Math.round(item.clocks.driveTimeRemainingMs / 60000) : null,
      shiftMinutesLeft: item.clocks?.shiftTimeRemainingMs != null ? Math.round(item.clocks.shiftTimeRemainingMs / 60000) : null,
      cycleMinutesLeft: item.clocks?.cycleTimeRemainingMs != null ? Math.round(item.clocks.cycleTimeRemainingMs / 60000) : null,
    }));
  }

  async getVehicleLocations(): Promise<EldVehicleLocation[]> {
    const data = await this.get("/fleet/vehicles/locations");
    const items = data.data ?? data.results ?? [];

    return items.map((item: any) => ({
      provider: "samsara",
      vehicleId: String(item.vehicleId ?? item.id ?? ""),
      latitude: Number(item.latitude ?? item.location?.latitude ?? 0),
      longitude: Number(item.longitude ?? item.location?.longitude ?? 0),
      recordedAt: item.time ?? item.recordedAt ?? item.location?.time ?? null,
    }));
  }
}
