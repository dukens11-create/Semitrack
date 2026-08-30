export type ProviderCoordinate = { latitude: number; longitude: number };

export interface TruckRestrictionProvider {
  readonly id: string;
  getRestrictions(bounds: { minLat: number; maxLat: number; minLng: number; maxLng: number }): Promise<unknown[]>;
}

export interface WeighStationStatusProvider {
  readonly id: string;
  getStatuses(stationIds: string[]): Promise<unknown[]>;
}

export interface ParkingAvailabilityProvider {
  readonly id: string;
  getAvailability(locationIds: string[]): Promise<unknown[]>;
}

export interface FuelPriceProvider {
  readonly id: string;
  getDieselPrices(stationIds: string[]): Promise<unknown[]>;
}

export interface EldProvider {
  readonly id: "SAMSARA" | "MOTIVE";
  exchangeAuthorizationCode(code: string): Promise<unknown>;
  refreshAuthentication(refreshToken: string): Promise<unknown>;
  getDrivers(accessToken: string): Promise<unknown>;
  getVehicles(accessToken: string): Promise<unknown>;
  getHoursOfService(accessToken: string): Promise<unknown>;
}
