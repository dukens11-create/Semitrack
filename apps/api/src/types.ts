export type LatLng = { lat: number; lng: number };

export type RoutingProviderName = "HERE" | "Trimble" | "Mapbox";

export type HazardousGood =
  | "explosive" | "gas" | "flammable" | "combustible" | "organic"
  | "poison" | "radioactive" | "corrosive" | "poisonousInhalation"
  | "harmfulToWater" | "other";

export type TruckProfile = {
  heightFt: number;
  currentWeightLbs?: number | null;
  weightLbs: number;
  weightPerAxleLbs?: number | null;
  widthFt: number;
  lengthFt: number;
  hazmatEnabled: boolean;
  hazardousGoods?: HazardousGood[];
  axleCount: number;
  trailerCount?: number;
  trailerType?: string | null;
  avoidTolls?: boolean;
  avoidResidential?: boolean;
  avoidFerries?: boolean;
  avoidHighways?: boolean;
  avoidDirtRoads?: boolean;
};

export type RouteBuildInput = {
  origin: LatLng;
  destination: LatLng;
  viaStops?: LatLng[];
  truck: TruckProfile;
  routeMode?: "fastest" | "fuel_optimized" | "shortest";
  alternatives?: number;
  avoidSegments?: string[];
};

export type RouteManeuver = {
  step: number;
  instruction: string;
  distanceMiles: number;
  durationSeconds?: number;
  action?: string;
  direction?: string;
  roadName?: string;
  currentRoadName?: string;
  nextRoadName?: string;
  exitNumber?: string;
  offset?: number;
  lanes?: Array<{ directions: string[]; active: boolean }>;
};

export type RouteLeg = {
  distanceMiles: number;
  durationSeconds: number;
  geometry: number[][];
  maneuvers: RouteManeuver[];
};

export type RouteOption = {
  id: string;
  distanceMiles: number;
  etaMinutes: number;
  durationSeconds: number;
  routeGeometry: number[][];
  legs: RouteLeg[];
  turnByTurn: RouteManeuver[];
  notices: Array<{ code: string; title?: string; severity?: string }>;
};

export type RouteBuildResult = {
  provider: RoutingProviderName;
  truckSafe: boolean;
  navigationAllowed: boolean;
  trafficAware: boolean;
  calculatedAt: string;
  selectedRouteId: string;
  distanceMiles: number;
  etaMinutes: number;
  durationSeconds: number;
  routeGeometry: number[][];
  legs: RouteLeg[];
  turnByTurn: RouteManeuver[];
  alternatives: RouteOption[];
  alerts: string[];
};
