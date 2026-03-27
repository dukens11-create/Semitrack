export type EldDriverClock = {
  provider: string;
  driverId: string;
  dutyStatus?: string;
  breakMinutesLeft?: number | null;
  driveMinutesLeft?: number | null;
  shiftMinutesLeft?: number | null;
  cycleMinutesLeft?: number | null;
};

export type EldVehicleLocation = {
  provider: string;
  vehicleId: string;
  latitude: number;
  longitude: number;
  recordedAt?: string;
};

export interface EldProvider {
  getDriverClocks(): Promise<EldDriverClock[]>;
  getVehicleLocations(): Promise<EldVehicleLocation[]>;
}
