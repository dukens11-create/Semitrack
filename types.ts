export type LatLng = { lat: number; lng: number };

export type TruckProfile = {
  heightFt: number;
  weightLbs: number;
  widthFt: number;
  lengthFt: number;
  hazmatEnabled: boolean;
  axleCount: number;
  avoidTolls?: boolean;
  avoidFerries?: boolean;
  avoidResidential?: boolean;
};

export type RouteMode = "fastest" | "fuel_optimized" | "shortest";

export type RouteRequest = {
  origin: LatLng;
  destination: LatLng;
  viaStops?: LatLng[];
  truck: TruckProfile;
  routeMode?: RouteMode;
  avoidZones?: string[];
};
