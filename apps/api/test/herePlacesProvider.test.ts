import assert from "node:assert/strict";
import test from "node:test";
import { parseHerePlaces } from "../src/services/providers/herePlacesParser.ts";

test("parseHerePlaces keeps real provider coordinates and address metadata", () => {
  const places = parseHerePlaces({
    items: [
      {
        id: "here:pds:place:123",
        title: "Walmart Supercenter",
        position: { lat: 45.52, lng: -122.67 },
        address: {
          label: "1123 N Hayden Meadows Dr, Portland, OR 97217, United States",
          city: "Portland",
          stateCode: "OR",
          countryCode: "USA",
        },
        distance: 814,
      },
      { id: "missing-position", title: "Invalid" },
    ],
  }, "walmart_store");

  assert.equal(places.length, 1);
  assert.deepEqual(places[0], {
    id: "here:here:pds:place:123",
    name: "Walmart Supercenter",
    category: "walmart_store",
    latitude: 45.52,
    longitude: -122.67,
    address: "1123 N Hayden Meadows Dr, Portland, OR 97217, United States",
    city: "Portland",
    state: "OR",
    country: "USA",
    distanceMeters: 814,
    provider: "HERE",
  });
});

test("parseHerePlaces rejects malformed entries instead of inventing coordinates", () => {
  assert.deepEqual(parseHerePlaces({ items: [{ id: "x", title: "Station" }] }, "weigh_station"), []);
  assert.deepEqual(parseHerePlaces({}, "weigh_station"), []);
  assert.deepEqual(
    parseHerePlaces({ items: [{ id: "cat", title: "CAT SCALE", position: { lat: 1, lng: 2 } }] }, "weigh_station"),
    [],
  );
});

test("parseHerePlaces excludes ordinary gas stations from truck-stop results", () => {
  const places = parseHerePlaces({
    items: [
      {
        id: "passenger-fuel",
        title: "Chevron Gas Station",
        position: { lat: 39.53, lng: -119.81 },
      },
      {
        id: "commercial-stop",
        title: "Love's Travel Stop",
        position: { lat: 39.61, lng: -119.77 },
      },
    ],
  }, "truck_stop");

  assert.equal(places.length, 1);
  assert.equal(places[0]?.name, "Love's Travel Stop");
  assert.equal(places[0]?.category, "truck_stop");
});
