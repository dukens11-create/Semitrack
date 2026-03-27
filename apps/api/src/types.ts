export type LatLng = { lat: number; lng: number };

export type TruckProfile = {
  heightFt: number;
  weightLbs: number;
  widthFt: number;
  lengthFt: number;
  hazmatEnabled: boolean;
  axleCount: number;
  avoidTolls?: boolean;
  avoidResidential?: boolean;
  avoidFerries?: boolean;
};

export type RouteBuildInput = {
  origin: LatLng;
  destination: LatLng;
  viaStops?: LatLng[];
  truck: TruckProfile;
  routeMode?: "fastest" | "fuel_optimized" | "shortest";
};

export type RouteBuildResult = {
  provider: string;
  distanceMiles: number;
  etaMinutes: number;
  routePolyline: string;
  turnByTurn: Array<{
    step: number;
    instruction: string;
    distanceMiles: number;
  }>;
  alerts: string[];
};
