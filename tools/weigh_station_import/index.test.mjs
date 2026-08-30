import assert from "node:assert/strict";
import test from "node:test";

import {
  deduplicate,
  normalize,
  parseCsv,
  unpackJson,
  validate,
} from "./index.mjs";

const context = {
  state: "OR",
  sourceName: "Oregon Department of Transportation",
  sourceUrl: "https://www.oregon.gov/odot/",
  defaultType: "FIXED_WEIGH_STATION",
  verifiedAt: "2026-08-20T00:00:00.000Z",
};

test("normalizes quoted CSV without losing official source metadata", () => {
  const [raw] = parseCsv('station_name,lat,lng,route,direction\n"North, Scale",45.5,-122.5,I-5,NB\n');
  const station = normalize(raw, context);
  assert.equal(station.name, "North, Scale");
  assert.equal(station.highway, "I-5");
  assert.equal(station.direction, "NB");
  assert.equal(station.officialSourceUrl, context.sourceUrl);
  assert.equal(validate([station], "OR").valid, true);
});

test("reads GeoJSON and ArcGIS coordinates", () => {
  const geojson = unpackJson({
    features: [{
      properties: { name: "Official Port" },
      geometry: { type: "Point", coordinates: [-122.6, 45.6] },
    }],
  });
  const arcgis = unpackJson({
    features: [{ attributes: { name: "Official Scale" }, geometry: { x: -123, y: 44 } }],
  });
  assert.deepEqual([geojson[0].longitude, geojson[0].latitude], [-122.6, 45.6]);
  assert.deepEqual([arcgis[0].longitude, arcgis[0].latitude], [-123, 44]);
});

test("validation rejects invalid coordinates, direction, and URLs", () => {
  const station = normalize({ name: "Bad", lat: 145, lng: -122, direction: "SIDEWAYS" }, context);
  station.officialSourceUrl = "not-a-url";
  const report = validate([station], "OR");
  assert.equal(report.valid, false);
  assert.match(report.errors.join("\n"), /invalid U\.S\. latitude/);
  assert.match(report.errors.join("\n"), /invalid direction/);
  assert.match(report.errors.join("\n"), /invalid official source URL/);
});

test("deduplicates nearby government records by highway and direction", () => {
  const first = normalize({ id: "1", name: "North Scale", lat: 45.5, lng: -122.5, route: "I-5", direction: "NB" }, context);
  const duplicate = normalize({ id: "2", name: "ODOT Scale House", lat: 45.5005, lng: -122.5005, route: "I-5", direction: "NB" }, context);
  const opposite = normalize({ id: "3", name: "South Scale", lat: 45.5004, lng: -122.5004, route: "I-5", direction: "SB" }, context);
  const result = deduplicate([first, duplicate, opposite]);
  assert.equal(result.stations.length, 2);
  assert.equal(result.duplicates.length, 1);
});

test("generic traffic sensors require enforcement evidence", () => {
  const station = normalize({ name: "Traffic Counter Sensor", lat: 45.5, lng: -122.5 }, context);
  const report = validate([station], "OR");
  assert.equal(report.valid, true);
  assert.equal(report.warnings.length, 1);
});
