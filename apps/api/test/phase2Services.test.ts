import assert from "node:assert/strict";
import test from "node:test";
import { parseHerePlaces } from "../dist/services/providers/herePlacesParser.js";
import {
  ConfiguredDot511Provider,
  parseDotProviderConfigs,
} from "../dist/services/providers/dot511Provider.js";
import {
  routeWeatherSamples,
  parseWeather,
  getCorrelatedRouteWeather,
  getWeatherAtPoint,
} from "../dist/services/weatherService.js";
import {
  correlateRoutePosition,
  pointAtRouteOffset,
  distanceMeters,
} from "../dist/services/safetyDataService.js";
import { env } from "../dist/config/env.js";
const now = Date.now(),
  point = { lat: 40, lng: -120 };
const input = {
  route: [point, { lat: 40, lng: -116 }],
  currentLocation: { ...point, accuracy: 4, timestamp: now },
};
const place = (id: string, title: string, lat = 40) => ({
  id,
  title,
  position: { lat, lng: -120 },
  distance: 0,
});
test("Phase2 CAT/repair categorization, dedup and invalid coordinate rejection", () => {
  assert.equal(
    parseHerePlaces(
      {
        items: [
          place("cat", "CAT Scale"),
          place("cat", "CAT Scale"),
          place("wrong", "Weigh station"),
          place("invalid", "CAT Scale", 91),
        ],
      },
      "cat_scale"
    ).length,
    1
  );
  assert.equal(
    parseHerePlaces(
      {
        items: [
          place("repair", "Heavy Duty Truck Repair"),
          place("car", "Car Repair"),
        ],
      },
      "truck_repair"
    ).length,
    1
  );
  for (const [category, name] of [
    ["truck_stop", "Love's Travel Stop"],
    ["truck_parking", "Truck Parking"],
    ["weigh_station", "Weigh Station"],
    ["rest_area", "Rest Area"],
    ["fuel_stop", "Pilot Travel Center"],
    ["truck_wash", "Truck Wash"],
  ])
    assert.equal(
      parseHerePlaces({ items: [place(category, name)] }, category as any)[0]
        ?.category,
      category
    );
});
test("Phase2 weather uses correlated route progress at 50/100 miles and destination", () => {
  const samples = routeWeatherSamples(input, now);
  assert.equal(samples.length, 4);
  assert.ok(
    Math.abs(distanceMeters(point, samples[1]!.point!) - 80467.2) < 100
  );
  assert.ok(
    Math.abs(distanceMeters(point, samples[2]!.point!) - 160934.4) < 100
  );
  assert.deepEqual(samples[3]!.point, input.route[1]);
  const after = routeWeatherSamples(
    { ...input, currentLocation: { ...input.currentLocation, lng: -119 } },
    now
  );
  assert.ok(after[1]!.point!.lng > samples[1]!.point!.lng);
  assert.equal(pointAtRouteOffset(input.route, 1000000), null);
});
test("Phase2 weather rejects stale/off-route/ambiguous location and never substitutes beyond-destination point", () => {
  assert.throws(() =>
    routeWeatherSamples(
      {
        ...input,
        currentLocation: { ...input.currentLocation, timestamp: now - 16000 },
      },
      now
    )
  );
  assert.throws(() =>
    routeWeatherSamples(
      { ...input, currentLocation: { ...input.currentLocation, lat: 41 } },
      now
    )
  );
  assert.throws(() =>
    correlateRoutePosition([point, { lat: 40, lng: -119 }, point], point)
  );
  const small = routeWeatherSamples(
    { ...input, route: [point, { lat: 40, lng: -119.99 }] },
    now
  );
  assert.equal(small[1]!.point, null);
  assert.equal(small[2]!.point, null);
});
test("Phase2 provider weather must be fresh and spatially correlated; missing wind stays unknown", () => {
  const payload = {
    coord: { lat: 40, lon: -120 },
    dt: now / 1000,
    main: { temp: 40 },
    weather: [{ main: "Clouds", description: "Cloudy" }],
  };
  assert.equal(parseWeather(payload, point, now).windMph, null);
  assert.throws(() =>
    parseWeather({ ...payload, dt: (now - 7300000) / 1000 }, point, now)
  );
  assert.throws(() =>
    parseWeather({ ...payload, coord: { lat: 50, lon: 10 } }, point, now)
  );
  assert.throws(() => parseWeather({ main: { temp: 0 } }, point, now));
});
test("Phase2 weather missing-key/network/provider failures are unavailable, with no raw provider errors", async (t) => {
  const original = env.openWeatherApiKey;
  env.openWeatherApiKey = "";
  t.after(() => {
    env.openWeatherApiKey = original;
  });
  assert.ok(
    (
      await getCorrelatedRouteWeather({
        ...input,
        currentLocation: { ...input.currentLocation, timestamp: Date.now() },
      })
    ).every((item) => item.status === "UNAVAILABLE")
  );
  env.openWeatherApiKey = "synthetic-local-weather-test";
  t.mock.method(globalThis, "fetch", async () => {
    throw new Error("secret-bearing provider URL");
  });
  await assert.rejects(getWeatherAtPoint(point), {
    message: "WEATHER_PROVIDER_UNAVAILABLE",
  });
});
test("Phase2 511 missing ID/time reject the entire snapshot, provider timestamp preserved", async (t) => {
  const [config] = parseDotProviderConfigs(
    JSON.stringify([
      {
        id: "fixture",
        jurisdiction: "NV",
        endpointUrl: "https://provider.example.test/feed?key=synthetic",
        format: "GEOJSON",
        dataType: "ROAD_EVENTS",
      },
    ])
  );
  const feature = (properties: object) => ({
    properties,
    geometry: { coordinates: [-120, 40] },
  });
  const timestamp = new Date(now - 60000).toISOString();
  t.mock.method(globalThis, "fetch", async () => ({
    ok: true,
    json: async () => ({
      features: [
        feature({ id: "good", title: "Closure", lastUpdated: timestamp }),
        feature({ id: "no-time" }),
        feature({ lastUpdated: timestamp }),
      ],
    }),
  }));
  await assert.rejects(new ConfiguredDot511Provider(config!).fetchSnapshot(), /invalid or duplicate/);
  t.mock.method(globalThis, "fetch", async () => ({ok:true,json:async()=>({features:[feature({id:"good",title:"Closure",lastUpdated:timestamp})]})}));
  const snapshot = await new ConfiguredDot511Provider(config!).fetchSnapshot();
  assert.equal(snapshot.events.length, 1);
  assert.equal(snapshot.events[0]!.lastUpdated.toISOString(), timestamp);
  assert.equal(snapshot.events[0]!.sourceUrl, undefined);
});
test("Phase2 511 provider failure stays failure rather than empty live conditions", async (t) => {
  const [config] = parseDotProviderConfigs(
    JSON.stringify([
      {
        id: "fixture",
        jurisdiction: "NV",
        endpointUrl: "https://provider.example.test/feed",
        format: "GEOJSON",
        dataType: "CAMERAS",
      },
    ])
  );
  t.mock.method(globalThis, "fetch", async () => ({ ok: false, status: 503 }));
  await assert.rejects(
    new ConfiguredDot511Provider(config!).fetchSnapshot(),
    /HTTP 503/
  );
});

test("Phase2 unrelated jurisdictions cannot share feed identity; truncated snapshots never become healthy empty feeds", async (t) => {
  const config = {
    id: "same",
    jurisdiction: "NV",
    endpointUrl: "https://provider.example.test/feed",
    format: "ARCGIS_JSON",
    dataType: "ROAD_EVENTS",
  };
  assert.throws(
    () =>
      parseDotProviderConfigs(
        JSON.stringify([config, { ...config, jurisdiction: "CA" }])
      ),
    /unique/
  );
  const [parsed] = parseDotProviderConfigs(JSON.stringify([config]));
  t.mock.method(globalThis, "fetch", async () => ({
    ok: true,
    json: async () => ({ features: [], exceededTransferLimit: true }),
  }));
  await assert.rejects(
    new ConfiguredDot511Provider(parsed!).fetchSnapshot(),
    /incomplete/
  );
});

test("Phase2 feed attribution is configurable and snapshot retirement requires explicit completeness", () => {
  const config = {
    id: "safe",
    jurisdiction: "NV",
    endpointUrl: "https://provider.example.test/feed",
    format: "GEOJSON",
    dataType: "ROAD_EVENTS",
    attribution: "Synthetic State DOT",
    publicSourceUrl: "https://provider.example.test/public",
  };
  const [parsed] = parseDotProviderConfigs(JSON.stringify([config]));
  assert.equal(parsed!.completeSnapshot, false);
  assert.equal(parsed!.attribution, "Synthetic State DOT");
  assert.throws(() =>
    parseDotProviderConfigs(
      JSON.stringify([
        {
          ...config,
          publicSourceUrl: "https://provider.example.test/public?key=synthetic",
        },
      ])
    )
  );
});

test('Phase2 null/empty 511 coordinates cannot become fabricated zero coordinates',async t=>{
  const [config]=parseDotProviderConfigs(JSON.stringify([{id:'coords',jurisdiction:'NV',endpointUrl:'https://provider.example.test/feed',format:'GEOJSON',dataType:'ROAD_EVENTS'}]));
  t.mock.method(globalThis,'fetch',async()=>({ok:true,json:async()=>({features:[{properties:{id:'bad',lastUpdated:new Date().toISOString()},geometry:{coordinates:[null,'']}}]})}));
  await assert.rejects(new ConfiguredDot511Provider(config!).fetchSnapshot(), /invalid or duplicate/);
});

// Review regressions exercise existing functions, not a parallel route/search pipeline.
import { corridorRouteOffset, CorridorCorrelationError } from '../dist/services/safetyDataService.js';
import { searchHerePlacesAlongRoute } from '../dist/services/providers/herePlacesProvider.js';
test('corridor error codes distinguish missing, invalid, stale, off-route and ambiguous context',()=>{
 const route=[point,{lat:40,lng:-119}],fix={...point,accuracy:4,timestamp:Date.now()};
 const cases=[
  [[],fix,'CORRIDOR_ROUTE_REQUIRED'],[[point,point],fix,'CORRIDOR_ROUTE_REQUIRED'],
  [route,undefined,'CORRIDOR_LOCATION_REQUIRED'],[route,{...fix,accuracy:NaN},'CORRIDOR_LOCATION_INVALID'],
  [route,{...fix,lat:91},'CORRIDOR_LOCATION_INVALID'],[route,{...fix,timestamp:Date.now()+60000},'CORRIDOR_LOCATION_INVALID'],
  [route,{...fix,timestamp:Date.now()-16000},'CORRIDOR_LOCATION_STALE'],
  [route,{...fix,lat:41},'CORRIDOR_LOCATION_OFF_ROUTE'],[[...route,point],fix,'CORRIDOR_LOCATION_AMBIGUOUS'],
 ];
 for(const [geometry,location,code] of cases)assert.throws(()=>corridorRouteOffset(geometry,location),e=>e instanceof CorridorCorrelationError&&e.httpStatus===422&&e.code===code);
 assert.equal(corridorRouteOffset(route,fix),0);
});
test('POI limit follows progress filtering: later candidates, behind, duplicates, limit, empty and provider failure',async t=>{
 const key=env.hereApiKey;env.hereApiKey='synthetic-local-test';t.after(()=>{env.hereApiKey=key;});
 const route=Array.from({length:12},(_,i)=>({lat:40,lng:-120+i*0.5}));
 let mode='mixed';let requests=0;
 t.mock.method(globalThis,'fetch',async url=>{
  requests++;if(mode==='failure')throw Error('synthetic provider unavailable');
  const coords=new URL(url).searchParams.get('in').split(';')[0].replace('circle:','').split(',').map(Number);
  const lng=mode==='behind'?-120:coords[1];
  const items=Array.from({length:20},(_,n)=>({id:lng+'-'+n,title:'CAT Scale '+n,position:{lat:40,lng:lng+n*0.00001}}));
  return {ok:true,json:async()=>({items:[...items,items[0]]})};
 });
 const offset=corridorRouteOffset(route,{...route[6],accuracy:4,timestamp:Date.now()});
 const result=await searchHerePlacesAlongRoute({category:'cat_scale',route,currentRouteOffsetMeters:offset,maxResults:7});
 assert.equal(result.length,7);assert.equal(new Set(result.map(x=>x.id)).size,7);assert.equal(requests,12);
 assert.ok(result.every(x=>x.longitude>=route[6].lng));
 assert.ok(result.every((x,i)=>!i||x.routeDistanceAheadMeters>=result[i-1].routeDistanceAheadMeters));
 assert.equal(result[0].routeDistanceAheadMeters,0);
 mode='behind';assert.deepEqual(await searchHerePlacesAlongRoute({category:'cat_scale',route,currentRouteOffsetMeters:offset}),[]);
 mode='failure';await assert.rejects(searchHerePlacesAlongRoute({category:'cat_scale',route,currentRouteOffsetMeters:offset}),/unavailable/);
});
