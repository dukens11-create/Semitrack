import assert from "node:assert/strict";
import test from "node:test";

import type { RouteBuildInput } from "../src/types.ts";
import { RoutingProviderError } from "../dist/services/providers/routeProvider.js";
import {
  buildTrimbleRouteRequest,
  matchTrimbleManeuversToGeometry,
  parseTrimbleRouteResponse,
  TrimbleRouteProvider,
  type TrimbleProviderConfig,
} from "../dist/services/providers/trimbleProvider.js";

test("maneuvers map monotonically to short RoutePath geometry", () => {
  const geometry = [[-120, 40], [-119.999, 40], [-119.998, 40]];
  const result = matchTrimbleManeuversToGeometry([
    { step: 1, instruction: "Start", distanceMiles: 0, coordinate: { lat: 40, lng: -120 } },
    { step: 2, instruction: "Turn", distanceMiles: 0.1, coordinate: { lat: 40, lng: -119.999 } },
    { step: 3, instruction: "Arrive", distanceMiles: 0.1, action: "arrive", coordinate: { lat: 40, lng: -119.998 } },
  ], geometry);
  assert.deepEqual(result.map((item) => item.offset), [0, 1, 2]);
});

test("maneuvers map correctly on a dense 300 point route and long highway segment", () => {
  const geometry = Array.from({ length: 401 }, (_, index) => [-120 + index * 0.001, 40]);
  const result = matchTrimbleManeuversToGeometry([
    { step: 1, instruction: "Enter highway", distanceMiles: 0, coordinate: { lat: 40, lng: -119.99 } },
    { step: 2, instruction: "Exit highway", distanceMiles: 20, coordinate: { lat: 40, lng: -119.7 } },
  ], geometry);
  assert.deepEqual(result.map((item) => item.offset), [10, 300]);
});

test("closely spaced maneuvers and duplicate geometry never move backward", () => {
  const geometry = [[-120, 40], [-119.999, 40], [-119.999, 40], [-119.9989, 40], [-119.998, 40]];
  const result = matchTrimbleManeuversToGeometry([
    { step: 1, instruction: "First", distanceMiles: 0, coordinate: { lat: 40, lng: -119.999 } },
    { step: 2, instruction: "Second", distanceMiles: 0, coordinate: { lat: 40, lng: -119.9989 } },
  ], geometry);
  assert.ok(result[1].offset! >= result[0].offset!);
  assert.equal(result[1].offset, 3);
});

test("low-confidence maneuver matching fails instead of inventing an offset", () => {
  assert.throws(
    () => matchTrimbleManeuversToGeometry([
      { step: 1, instruction: "Turn", distanceMiles: 0, coordinate: { lat: 41, lng: -121 } },
    ], [[-120, 40], [-119.9, 40]]),
    (error: unknown) => error instanceof RoutingProviderError && error.code === "TRIMBLE_MANEUVER_GEOMETRY_MISMATCH",
  );
});

const config: TrimbleProviderConfig = {
  apiKey: "test-secret-that-must-not-leak",
  baseUrl: "https://pcmiler.example.test/apis/rest/v1.0/Service.svc",
  dataVersion: "Current",
  profileName: "Heavy Duty Semitrailer",
  geoTunnelIntervalMiles: 0.1,
  requestTimeoutMs: 15_000,
  routePathEnabled: false,
  alternateRoutesEnabled: false,
};

const input: RouteBuildInput = {
  origin: { lat: 39.52, lng: -119.81 },
  destination: { lat: 45.52, lng: -122.68 },
  truck: {
    heightFt: 13.5,
    widthFt: 8.5,
    lengthFt: 53,
    weightLbs: 80_000,
    currentWeightLbs: 72_000,
    weightPerAxleLbs: 20_000,
    axleCount: 5,
    trailerCount: 1,
    trailerType: "semi trailer",
    hazmatEnabled: true,
    hazardousGoods: ["explosive", "corrosive"],
    avoidTolls: true,
    avoidFerries: true,
    avoidHighways: false,
    avoidResidential: false,
    avoidDirtRoads: false,
  },
  routeMode: "fastest",
  alternatives: 2,
};


// Complete documented stop metadata for these two-point provider fixtures.
function withStops(payload:any[], origin=input.origin, destination=input.destination){
 const loc=(p:{lat:number;lng:number})=>({Coords:{Lat:p.lat,Lon:p.lng},Errors:[]});
 const directions=payload.find(p=>p.__type.startsWith('DirectionsReport'));
 directions.Origin=loc(origin);directions.Destination=loc(destination);
 for(const leg of directions.ReportLegs){leg.Origin=loc(origin);leg.Dest=loc(destination);}
 const mileage=payload.find(p=>p.__type.startsWith('MileageReport'));
 mileage.ReportLines[0].Stop=loc(destination);mileage.ReportLines.unshift({Stop:loc(origin),LMiles:'0',TMiles:'0',LHours:'0:00:00',THours:'0:00:00'});
 return payload;
}

test("Trimble request sends the commercial truck profile without weakening restrictions", () => {
  const request: any = buildTrimbleRouteRequest(input, config);
  const route = request.ReportRoutes[0];
  assert.equal(route.Options.ProfileName, "Heavy Duty Semitrailer");
  assert.equal(route.Options.VehicleType, 0);
  assert.equal(route.Options.RoutingType, 0, "commercial fastest maps to Trimble Practical");
  assert.equal(route.Options.HighwayOnly, false);
  assert.equal(route.Options.OverrideRestrict, false);
  assert.equal(route.Options.TollRoads, 2);
  assert.equal(route.Options.FerryDiscourage, true);
  assert.deepEqual(route.Options.HazMatTypes, [3, 2]);
  assert.deepEqual(route.Options.TruckCfg, {
    Units: 0,
    Height: "162",
    Width: "102",
    Length: "636",
    Weight: "80000",
    Axles: 5,
    MaxWeightPerAxleGroup: 20000,
    LCV: false,
  });
  assert.deepEqual(route.Options.TrailerCfg, { TypeOfTrailer: 3, Count: 1 });
  assert.ok(route.ReportTypes.some((value: any) => value.__type.startsWith("DirectionsReportType:")));
  assert.ok(route.ReportTypes.some((value: any) => value.__type.startsWith("MileageReportType:")));
  assert.ok(route.ReportTypes.some((value: any) => value.__type.startsWith("GeoTunnelReportType:")));
  assert.equal(route.AlternateRouteOptions, undefined, "premium alternates remain entitlement-gated");
});

test("Trimble request preserves one and multiple intermediate stops in order", () => {
  for (const viaStops of [
    [{ lat: 40, lng: -120 }],
    [{ lat: 40, lng: -120 }, { lat: 41, lng: -121 }],
  ]) {
    const request: any = buildTrimbleRouteRequest({ ...input, viaStops }, config);
    const stops = request.ReportRoutes[0].Stops;
    assert.deepEqual(
      stops.map((stop: any) => [Number(stop.Coords.Lat), Number(stop.Coords.Lon)]),
      [[input.origin.lat, input.origin.lng], ...viaStops.map((stop) => [stop.lat, stop.lng]), [input.destination.lat, input.destination.lng]],
    );
    assert.equal(request.ReportRoutes[0].Options.OverrideRestrict, false);
  }
});

test("Trimble premium alternatives include the required base-waypoint configuration", () => {
  const request: any = buildTrimbleRouteRequest(input, {
    ...config,
    routePathEnabled: true,
    alternateRoutesEnabled: true,
  });
  assert.deepEqual(request.ReportRoutes[0].AlternateRouteOptions, {
    Enabled: true,
    Type: 0,
    WaypointConfig: { IncludeBaseWaypoints: true, Waypoints: [] },
    MaxAlternates: 2,
  });
});

test("Trimble omits an account-specific profile name when none is configured", () => {
  const request: any = buildTrimbleRouteRequest(input, {
    ...config,
    profileName: "",
  });
  assert.equal(request.ReportRoutes[0].Options.ProfileName, undefined);
  assert.equal(request.ReportRoutes[0].Options.VehicleType, 0);
  assert.equal(request.ReportRoutes[0].Options.OverrideRestrict, false);
});

test("Trimble refuses HERE segment IDs instead of mixing provider data", () => {
  assert.throws(
    () => buildTrimbleRouteRequest({ ...input, avoidSegments: ["here:cm:segment:123"] }, config),
    (error: unknown) => error instanceof RoutingProviderError && error.code === "TRIMBLE_PROVIDER_SEGMENT_IDS_REQUIRED",
  );
});

test("Trimble response normalizes mileage, geometry, maneuvers, warnings and traffic", () => {
  const payload = [
    {
      __type: "DirectionsReport:http://pcmiler.alk.com/APIs/v1.0",
      RouteID: "trimble-route-1",
      ReportLegs: [{
        ReportLines: [
          {
            Direction: "Turn right on I-80 West",
            Dist: null,
            Time: null,
            TurnInstruction: "TC_Right",
            Begin: { Lat: "39.52", Lon: "-119.81" },
            End: { Lat: "39.53", Lon: "-119.82" },
          },
          {
            Direction: "Drive 100 miles on I-80 West",
            Dist: "100.000",
            Time: "2:00:00",
            TurnInstruction: null,
            Begin: { Lat: "39.53", Lon: "-119.82" },
            End: { Lat: "41.00", Lon: "-120.50" },
          },
          {
            Direction: "Destination, Portland, OR",
            Dist: "483.500",
            Time: "8:30:00",
            TurnInstruction: null,
            Warn: null,
            Begin: { Lat: "45.52", Lon: "-122.68" },
            End: { Lat: "45.52", Lon: "-122.68" },
          },
        ],
      }],
    },
    {
      __type: "MileageReport:http://pcmiler.alk.com/APIs/v1.0",
      RouteID: "trimble-route-1",
      TrafficDataUsed: true,
      ReportLines: [{
        LMiles: "583.500",
        TMiles: "583.500",
        LHours: "10:30:00",
        THours: "10:30:00",
      }],
    },
    {
      __type: "GeoTunnelReport:http://pcmiler.alk.com/APIs/v1.0",
      GeoTunnelPoints: [
        { Lat: "39.52", Lon: "-119.81" },
        { Lat: "41.00", Lon: "-120.50" },
        { Lat: "45.52", Lon: "-122.68" },
      ],
    },
  ];

  const route = parseTrimbleRouteResponse(withStops(payload), input, config);
  assert.equal(route.provider, "Trimble");
  assert.equal(route.truckSafe, true);
  assert.equal(route.navigationAllowed, false, "GeoTunnel can never authorize navigation");
  assert.equal(route.trafficAware, true);
  assert.equal(route.distanceMiles, 583.5);
  assert.equal(route.durationSeconds, 37_800);
  assert.deepEqual(route.routeGeometry[0], [-119.81, 39.52]);
  assert.equal(route.turnByTurn[0]?.direction, "right");
  assert.equal(route.turnByTurn[0]?.roadName, "I-80 West");
  assert.equal(route.turnByTurn.at(-1)?.action, "arrive");
  assert.equal(route.alerts.some((alert) => alert.includes("Truck Restricted")), false);
  assert.ok(route.alerts.some((alert) => alert.includes("alternatives")));
});

test("Trimble prefers dense RoutePath geometry over sparse GeoTunnel samples", () => {
  const routePathConfig = { ...config, routePathEnabled: true };
  const payload = [
    {
      __type: "DirectionsReport:http://pcmiler.alk.com/APIs/v1.0",
      RouteID: "trimble-route-path",
      ReportLegs: [{ ReportLines: [{ Direction: "Destination", Dist: "1", Time: "0:02:00", End: { Lat: "39.53", Lon: "-119.82" } }] }],
    },
    {
      __type: "MileageReport:http://pcmiler.alk.com/APIs/v1.0",
      RouteID: "trimble-route-path",
      ReportLines: [{ LMiles: "1", TMiles: "1", LHours: "0:02:00", THours: "0:02:00" }],
    },
    {
      __type: "GeoTunnelReport:http://pcmiler.alk.com/APIs/v1.0",
      GeoTunnelPoints: [{ Lat: "39.52", Lon: "-119.81" }, { Lat: "39.53", Lon: "-119.82" }],
    },
    {
      __type: "RoutePathReport:http://pcmiler.alk.com/APIs/v1.0",
      geometry: {
        type: "MultiLineString",
        coordinates: [[
          [-119.81, 39.52],
          [-119.8105, 39.5204],
          [-119.811, 39.521],
          [-119.82, 39.53],
        ]],
      },
    },
  ];

  const destination={lat:39.53,lng:-119.82};
  const route = parseTrimbleRouteResponse(withStops(payload,input.origin,destination), {...input,destination}, routePathConfig);
  assert.equal(route.routeGeometry.length, 4);
  assert.deepEqual(route.routeGeometry[1], [-119.8105, 39.5204]);
});

test("Trimble refuses sparse GeoTunnel geometry when RoutePath is required", () => {
  const routePathConfig = { ...config, routePathEnabled: true };
  const payload = [
    {
      __type: "DirectionsReport:http://pcmiler.alk.com/APIs/v1.0",
      ReportLegs: [{ ReportLines: [] }],
    },
    {
      __type: "MileageReport:http://pcmiler.alk.com/APIs/v1.0",
      ReportLines: [{ LMiles: "1", TMiles: "1", LHours: "0:02:00", THours: "0:02:00" }],
    },
    {
      __type: "GeoTunnelReport:http://pcmiler.alk.com/APIs/v1.0",
      GeoTunnelPoints: [{ Lat: "39.52", Lon: "-119.81" }, { Lat: "39.53", Lon: "-119.82" }],
    },
  ];

  assert.throws(
    () => parseTrimbleRouteResponse(payload, input, routePathConfig),
    (error: unknown) => error instanceof RoutingProviderError && error.code === "TRIMBLE_ROUTE_PATH_REQUIRED",
  );
});

test("Trimble API key is sent only in the Authorization header", async () => {
  let capturedUrl = "";
  let capturedHeaders: HeadersInit | undefined;
  let capturedBody = "";
  const fetchMock: typeof fetch = async (url, init) => {
    capturedUrl = String(url);
    capturedHeaders = init?.headers;
    capturedBody = String(init?.body ?? "");
    return new Response(JSON.stringify(withStops([
      {
        __type: "DirectionsReport:http://pcmiler.alk.com/APIs/v1.0",
        RouteID: "secure-route",
        ReportLegs: [{ ReportLines: [{ Direction: "Destination", Dist: "1", Time: "0:02:00", End: { Lat: "39.53", Lon: "-119.82" } }] }],
      },
      {
        __type: "MileageReport:http://pcmiler.alk.com/APIs/v1.0",
        RouteID: "secure-route",
        ReportLines: [{ LMiles: "1", TMiles: "1", LHours: "0:02:00", THours: "0:02:00" }],
      },
      {
        __type: "GeoTunnelReport:http://pcmiler.alk.com/APIs/v1.0",
        GeoTunnelPoints: [{ Lat: "39.52", Lon: "-119.81" }, { Lat: "39.53", Lon: "-119.82" }],
      },
    ],input.origin,{lat:39.53,lng:-119.82})), { status: 200, headers: { "content-type": "application/json" } });
  };
  const provider = new TrimbleRouteProvider(config, fetchMock);
  await provider.buildRoute({...input,destination:{lat:39.53,lng:-119.82}});
  const headers = new Headers(capturedHeaders);
  assert.equal(headers.get("authorization"), config.apiKey);
  assert.equal(capturedUrl.includes(config.apiKey), false);
  assert.equal(capturedBody.includes(config.apiKey), false);
});

test("Trimble quota failures expose a stable retryable error", async () => {
  const provider = new TrimbleRouteProvider(
    config,
    (async () => new Response("TRIP_LIMIT_EXCEEDED", { status: 429 })) as typeof fetch,
  );
  await assert.rejects(
    () => provider.buildRoute(input),
    (error: unknown) => error instanceof RoutingProviderError &&
      error.code === "TRIMBLE_QUOTA_EXCEEDED" && error.retryable,
  );
});

test("all maneuver positions including arrival require measured coordinates", () => {
  for (const action of ["continue", "turn", "arrive"]) {
    assert.throws(() => matchTrimbleManeuversToGeometry([{step:1,instruction:"Fixture maneuver",distanceMiles:0,action}], [[-120,40],[-119.999,40]]), (error:unknown)=>error instanceof RoutingProviderError && error.code === "TRIMBLE_MANEUVER_COORDINATE_REQUIRED");
  }
});
test("invalid maneuver coordinates cannot acquire a fabricated geometry offset", () => {
  for (const coordinate of [{lat:NaN,lng:-120},{lat:91,lng:-120},{lat:40,lng:181}]) {
    assert.throws(()=>matchTrimbleManeuversToGeometry([{step:1,instruction:"Fixture",distanceMiles:0,coordinate}], [[-120,40],[-119.999,40]]));
  }
});
