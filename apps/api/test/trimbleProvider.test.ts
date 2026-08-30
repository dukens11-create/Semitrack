import assert from "node:assert/strict";
import test from "node:test";

import type { RouteBuildInput } from "../src/types.ts";
import { RoutingProviderError } from "../dist/services/providers/routeProvider.js";
import {
  buildTrimbleRouteRequest,
  parseTrimbleRouteResponse,
  TrimbleRouteProvider,
  type TrimbleProviderConfig,
} from "../dist/services/providers/trimbleProvider.js";

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
  },
  routeMode: "fastest",
  alternatives: 2,
};

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
            Dist: "583.500",
            Time: "10:30:00",
            TurnInstruction: null,
            Warn: "Warning - Truck Restricted cleanup point",
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

  const route = parseTrimbleRouteResponse(payload, input, config);
  assert.equal(route.provider, "Trimble");
  assert.equal(route.truckSafe, true);
  assert.equal(route.navigationAllowed, true);
  assert.equal(route.trafficAware, true);
  assert.equal(route.distanceMiles, 583.5);
  assert.equal(route.durationSeconds, 37_800);
  assert.deepEqual(route.routeGeometry[0], [-119.81, 39.52]);
  assert.equal(route.turnByTurn[0]?.direction, "right");
  assert.equal(route.turnByTurn[0]?.roadName, "I-80 West");
  assert.equal(route.turnByTurn.at(-1)?.action, "arrive");
  assert.ok(route.alerts.some((alert) => alert.includes("Truck Restricted")));
  assert.ok(route.alerts.some((alert) => alert.includes("alternatives")));
});

test("Trimble prefers dense RoutePath geometry over sparse GeoTunnel samples", () => {
  const routePathConfig = { ...config, routePathEnabled: true };
  const payload = [
    {
      __type: "DirectionsReport:http://pcmiler.alk.com/APIs/v1.0",
      RouteID: "trimble-route-path",
      ReportLegs: [{ ReportLines: [{ Direction: "Destination", Dist: "1", Time: "0:02:00" }] }],
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

  const route = parseTrimbleRouteResponse(payload, input, routePathConfig);
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
    return new Response(JSON.stringify([
      {
        __type: "DirectionsReport:http://pcmiler.alk.com/APIs/v1.0",
        RouteID: "secure-route",
        ReportLegs: [{ ReportLines: [{ Direction: "Destination", Dist: "1", Time: "0:02:00" }] }],
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
    ]), { status: 200, headers: { "content-type": "application/json" } });
  };
  const provider = new TrimbleRouteProvider(config, fetchMock);
  await provider.buildRoute(input);
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
