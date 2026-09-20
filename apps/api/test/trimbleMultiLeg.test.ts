import assert from "node:assert/strict";
import test from "node:test";

import type { RouteBuildInput } from "../src/types.ts";
import { RoutingProviderError } from "../dist/services/providers/routeProvider.js";
import {
  parseTrimbleRouteResponse,
  type TrimbleProviderConfig,
} from "../dist/services/providers/trimbleProvider.js";

const origin = { lat: 39.5200, lng: -119.8100 };
const via = { lat: 39.5250, lng: -119.8150 };
const destination = { lat: 39.5300, lng: -119.8200 };

const input: RouteBuildInput = {
  origin,
  destination,
  viaStops: [via],
  truck: {
    heightFt: 13.5,
    widthFt: 8.5,
    lengthFt: 53,
    weightLbs: 80_000,
    currentWeightLbs: 72_000,
    weightPerAxleLbs: 20_000,
    axleCount: 5,
    trailerCount: 1,
    trailerType: "dry van",
    hazmatEnabled: false,
    hazardousGoods: [],
    avoidTolls: false,
    avoidFerries: false,
    avoidHighways: false,
    avoidResidential: true,
    avoidDirtRoads: true,
  },
  routeMode: "fastest",
  alternatives: 0,
};

const config: TrimbleProviderConfig = {
  apiKey: "test-only",
  baseUrl: "https://pcmiler.example.test/apis/rest/v1.0/Service.svc",
  dataVersion: "Current",
  profileName: "",
  geoTunnelIntervalMiles: 0.1,
  requestTimeoutMs: 15_000,
  routePathEnabled: true,
  alternateRoutesEnabled: false,
};

const stop = (point: { lat: number; lng: number }) => ({
  Coords: { Lat: point.lat, Lon: point.lng },
  Errors: [],
});

function payload(options?: {
  baselineTime?: string;
  baselineDistance?: string;
  omitSecondLegBaseline?: boolean;
  secondLegWarning?: string;
  destinationTime?: string;
}) {
  const secondLegLines: any[] = [];
  if (!options?.omitSecondLegBaseline) {
    secondLegLines.push({
      Direction: "Stop 1",
      Dist: options?.baselineDistance ?? "1.000",
      Time: options?.baselineTime ?? "0:01",
      TurnInstruction: null,
      Begin: { Lat: via.lat, Lon: via.lng },
      End: { Lat: via.lat, Lon: via.lng },
    });
  }
  secondLegLines.push({
    Direction: "Destination",
    Dist: "3.000",
    Time: options?.destinationTime ?? "0:04",
    TurnInstruction: null,
    Warn: options?.secondLegWarning ?? null,
    Begin: { Lat: via.lat, Lon: via.lng },
    End: { Lat: destination.lat, Lon: destination.lng },
  });

  return [
    {
      __type: "DirectionsReport:http://pcmiler.alk.com/APIs/v1.0",
      RouteID: "multi-stop-fixture",
      Origin: stop(origin),
      Destination: stop(destination),
      ReportLegs: [
        {
          Origin: stop(origin),
          Dest: stop(via),
          ReportLines: [
            {
              Direction: "Origin",
              Dist: "0.000",
              Time: "0:00",
              TurnInstruction: null,
              Begin: { Lat: origin.lat, Lon: origin.lng },
              End: { Lat: origin.lat, Lon: origin.lng },
            },
            {
              Direction: "Continue to Stop 1",
              Dist: "1.000",
              Time: "0:01",
              TurnInstruction: "TC_Continue",
              Begin: { Lat: origin.lat, Lon: origin.lng },
              End: { Lat: via.lat, Lon: via.lng },
            },
          ],
        },
        {
          Origin: stop(via),
          Dest: stop(destination),
          ReportLines: secondLegLines,
        },
      ],
    },
    {
      __type: "MileageReport:http://pcmiler.alk.com/APIs/v1.0",
      RouteID: "multi-stop-fixture",
      TrafficDataUsed: false,
      ReportLines: [
        {
          Stop: stop(origin),
          LMiles: "0.000",
          TMiles: "0.000",
          LHours: "0:00:00",
          THours: "0:00:00",
        },
        {
          Stop: stop(via),
          LMiles: "1.000",
          TMiles: "1.000",
          LHours: "0:01:40",
          THours: "0:01:40",
        },
        {
          Stop: stop(destination),
          LMiles: "2.000",
          TMiles: "3.000",
          LHours: "0:02:40",
          THours: "0:04:20",
        },
      ],
    },
    {
      __type: "RoutePathReport:http://pcmiler.alk.com/APIs/v1.0",
      RouteID: "multi-stop-fixture",
      geometry: {
        type: "LineString",
        coordinates: [
          [origin.lng, origin.lat],
          [via.lng, via.lat],
          [destination.lng, destination.lat],
        ],
      },
    },
    {
      __type: "GeoTunnelReport:http://pcmiler.alk.com/APIs/v1.0",
      GeoTunnelPoints: [
        { Lat: origin.lat, Lon: origin.lng },
        { Lat: via.lat, Lon: via.lng },
        { Lat: destination.lat, Lon: destination.lng },
      ],
    },
  ];
}

test("multi-stop parser accepts minute-precision Directions against second-precision Mileage", () => {
  const route = parseTrimbleRouteResponse(payload(), input, config);
  assert.equal(route.legs.length, 2);
  assert.equal(route.distanceMiles, 3);
  assert.equal(route.durationSeconds, 260);
  assert.equal(route.validatedStops.length, 3);
  assert.equal(route.turnByTurn.at(-1)?.action, "arrive");
});

test("multi-stop parser preserves an explicit intermediate-stop arrival in global order", () => {
  const route = parseTrimbleRouteResponse(payload(), input, config);
  const arrivals = route.turnByTurn.filter((maneuver) => maneuver.action === "arrive");
  assert.ok(arrivals.length >= 2);
  assert.equal(arrivals[0]?.coordinate?.lat, via.lat);
  assert.equal(arrivals[0]?.coordinate?.lng, via.lng);
  assert.equal(arrivals.at(-1)?.coordinate?.lat, destination.lat);
  for (let index = 1; index < route.turnByTurn.length; index++) {
    assert.ok(route.turnByTurn[index]!.step > route.turnByTurn[index - 1]!.step);
  }
});

test("multi-stop parser rejects a materially conflicting intermediate-stop time counter", () => {
  assert.throws(
    () => parseTrimbleRouteResponse(payload({ baselineTime: "0:00" }), input, config),
    (error: unknown) =>
      error instanceof RoutingProviderError &&
      error.code === "TRIMBLE_MANEUVER_DATA_REQUIRED",
  );
});

test("multi-stop parser rejects a materially conflicting intermediate-stop distance counter", () => {
  assert.throws(
    () => parseTrimbleRouteResponse(payload({ baselineDistance: "0.500" }), input, config),
    (error: unknown) =>
      error instanceof RoutingProviderError &&
      error.code === "TRIMBLE_MANEUVER_DATA_REQUIRED",
  );
});

test("multi-stop parser rejects a missing second-leg stop marker instead of guessing a baseline", () => {
  assert.throws(
    () => parseTrimbleRouteResponse(payload({ omitSecondLegBaseline: true }), input, config),
    (error: unknown) =>
      error instanceof RoutingProviderError &&
      error.code === "TRIMBLE_MANEUVER_DATA_REQUIRED",
  );
});

test("multi-stop parser still fails closed on provider restriction warnings", () => {
  assert.throws(
    () => parseTrimbleRouteResponse(payload({ secondLegWarning: "Truck Restricted" }), input, config),
    (error: unknown) =>
      error instanceof RoutingProviderError &&
      error.code === "TRIMBLE_RESTRICTION_WARNING",
  );
});
