import assert from 'node:assert/strict';
import test from 'node:test';
import { buildTrimbleRouteRequest, parseTrimbleRouteResponse, TrimbleRouteProvider, TRIMBLE_STOP_SNAP_TOLERANCE_METERS } from '../dist/services/providers/trimbleProvider.js';
const config={apiKey:'test-only',baseUrl:'https://provider.example.test',dataVersion:'Current',profileName:'',geoTunnelIntervalMiles:0.1,requestTimeoutMs:1000,routePathEnabled:true,alternateRoutesEnabled:false};
const input={origin:{lat:40,lng:-120},destination:{lat:40,lng:-119.999},truck:{heightFt:13.5,widthFt:8.5,lengthFt:53,weightLbs:80000,currentWeightLbs:72000,weightPerAxleLbs:20000,axleCount:5,trailerCount:1,trailerType:'Dry Van',hazmatEnabled:false,hazardousGoods:[],avoidTolls:false,avoidFerries:false,avoidHighways:false,avoidResidential:false,avoidDirtRoads:false}};
const location=p=>({Coords:{Lat:p.lat,Lon:p.lng},Errors:[]});
function payload(){return [{__type:'DirectionsReport',Origin:location(input.origin),Destination:location(input.destination),ReportLegs:[{Origin:location(input.origin),Dest:location(input.destination),ReportLines:[{Direction:'Destination',Dist:'1',Time:'0:02:00',End:{Lat:40,Lon:-119.999}}]}]},{__type:'MileageReport',ReportLines:[{Stop:location(input.origin),TMiles:'0',LMiles:'0',THours:'0:00:00',LHours:'0:00:00'},{Stop:location(input.destination),TMiles:'1',LMiles:'1',THours:'0:02:00',LHours:'0:02:00'}]},{__type:'RoutePathReport',geometry:{type:'LineString',coordinates:[[-120,40],[-119.999,40]]}}];}
test('all required restrictions must be explicit, not guessed from defaults',()=>{
  for(const key of ['heightFt','widthFt','lengthFt','weightLbs','axleCount','trailerCount','hazmatEnabled','hazardousGoods','avoidTolls','avoidFerries','avoidHighways','avoidResidential','avoidDirtRoads']){
    const bad=structuredClone(input);delete bad.truck[key];assert.throws(()=>buildTrimbleRouteRequest(bad,config));
  }
});
test('invalid dimensions, weights, counts and coordinates fail before provider request',()=>{
  for(const key of ['heightFt','widthFt','lengthFt','weightLbs','axleCount','trailerCount'])for(const value of [null,undefined,'13',NaN,Infinity,-1])assert.throws(()=>buildTrimbleRouteRequest({...input,truck:{...input.truck,[key]:value}},config));
  for(const lat of [NaN,Infinity,91,-91,'40',null])assert.throws(()=>buildTrimbleRouteRequest({...input,origin:{lat,lng:-120}},config));
});
test('13 feet 6 inches remains decimal feet until the imperial vendor boundary',()=>{const route=buildTrimbleRouteRequest(input,config).ReportRoutes[0];assert.equal(route.Options.TruckCfg.Height,'162');assert.equal(route.Options.TruckCfg.Width,'102');assert.equal(route.Options.TruckCfg.Length,'636');assert.equal(route.Options.TruckCfg.Weight,'80000');});
test('unsupported optional preferences are disclosed without weakening mandatory restrictions',()=>{
 const base=buildTrimbleRouteRequest(input,config).ReportRoutes[0].Options;
 for(let mask=0;mask<8;mask++){
  const truck={...input.truck,avoidHighways:!!(mask&1),avoidResidential:!!(mask&2),avoidDirtRoads:!!(mask&4)};
  assert.deepEqual(buildTrimbleRouteRequest({...input,truck},config).ReportRoutes[0].Options,base);
  const route=parseTrimbleRouteResponse(payload(),{...input,truck},config);
  assert.equal(route.preferenceWarnings.length,[1,2,4].filter(bit=>mask&bit).length);
  assert(route.preferenceWarnings.every(w=>w.requested && !w.supported && !w.guaranteed && route.alerts.includes(w.message)));
 }
 assert.throws(()=>buildTrimbleRouteRequest({...input,truck:{...input.truck,hazardousGoods:['explosive']}},config));
});
test('invalid vertices cannot be discarded to fabricate a connecting road',()=>{for(const point of [[NaN,40],[-120,91],['-120',40],[-120]]){const data=payload();data[2].geometry.coordinates.splice(1,0,point);assert.throws(()=>parseTrimbleRouteResponse(data,input,config));}});
test('missing or malformed maneuver distance/time/instruction never becomes zero',()=>{
 for(const patch of [{Dist:null},{Dist:'-1'},{Time:null},{Time:'1:99'},{Time:'NaN'},{Direction:'',TurnInstruction:'TC_Left'}]){const data=payload();Object.assign(data[0].ReportLegs[0].ReportLines[0],patch);assert.throws(()=>parseTrimbleRouteResponse(data,input,config));}
});
test('empty directions and invalid summaries fail closed',()=>{for(const change of [(d)=>d[0].ReportLegs=[],(d)=>d[1].ReportLines[1].TMiles='-1',(d)=>d[1].ReportLines[1].THours=null]){const data=payload();change(data);assert.throws(()=>parseTrimbleRouteResponse(data,input,config));}});
test('validated RoutePath derives actual maneuver offset and matching distance',()=>{const route=parseTrimbleRouteResponse(payload(),input,config);assert.equal(route.turnByTurn[0].offset,1);assert.equal(route.turnByTurn[0].geometryMatchDistanceMeters,0);assert.equal(route.navigationAllowed,true);});
test('provider timeout includes stalled response body',async()=>{
 const provider=new TrimbleRouteProvider(config,async(_url,init)=>({ok:true,status:200,text:()=>new Promise((_resolve,reject)=>init.signal.addEventListener('abort',()=>reject(new Error('secret'))))}));
 await assert.rejects(()=>provider.buildRoute(input),e=>e.code==='TRIMBLE_REQUEST_TIMEOUT');
});

test('restriction warnings cannot return truck-safe routing',()=>{const data=payload();data[0].ReportLegs[0].ReportLines[0].Warn='Truck Restricted cleanup point';assert.throws(()=>parseTrimbleRouteResponse(data,input,config),e=>e.code==='TRIMBLE_RESTRICTION_WARNING');});
test('different provider route IDs cannot be spliced into one route',()=>{const data=payload();data[0].RouteID='first';data[1].RouteID='other';assert.throws(()=>parseTrimbleRouteResponse(data,input,config),e=>e.code==='TRIMBLE_ROUTE_ID_MISMATCH');});

test('provider deadline also bounds an unresponsive response body',async()=>{const provider=new TrimbleRouteProvider(config,async()=>({ok:true,status:200,text:()=>new Promise(()=>{})}));await assert.rejects(()=>provider.buildRoute(input),e=>e.code==='TRIMBLE_REQUEST_TIMEOUT');});


import { env } from '../dist/config/env.js';
import { buildTruckRoute, buildTrafficPreview, compareRoutes } from '../dist/services/routingService.js';
import { HereRouteProvider } from '../dist/services/providers/hereProvider.js';

test('legacy traffic preview cannot contact Mapbox or manufacture a passenger route', async t => {
  const network = t.mock.method(globalThis, 'fetch', async () => { throw Error('unexpected network'); });
  await assert.rejects(() => buildTrafficPreview(input), e => e.code === 'PASSENGER_ROUTING_DISABLED' && e.httpStatus === 410);
  assert.equal(network.mock.callCount(), 0);
});
test('commercial route refuses a configured non-Trimble provider', async t => {
  const old = env.routingProvider;
  const here = t.mock.method(HereRouteProvider.prototype, 'buildRoute', async () => { throw Error('unexpected HERE route'); });
  try { env.routingProvider = 'here'; await assert.rejects(() => buildTruckRoute(input), e => e.code === 'TRIMBLE_PROVIDER_REQUIRED'); }
  finally { env.routingProvider = old; }
  assert.equal(here.mock.callCount(), 0);
});
test('Trimble failure propagates without trying another provider', async t => {
  const old = env.routingProvider;
  const failure = new Error('fixture provider unavailable');
  const calls = t.mock.method(TrimbleRouteProvider.prototype, 'buildRoute', async value => { assert.equal(value, input); throw failure; });
  const here = t.mock.method(HereRouteProvider.prototype, 'buildRoute', async () => { throw Error('unexpected fallback'); });
  try { env.routingProvider = 'trimble'; await assert.rejects(() => buildTruckRoute(input), error => error === failure); }
  finally { env.routingProvider = old; }
  assert.equal(calls.mock.callCount(), 1); assert.equal(here.mock.callCount(), 0);
});
test('production cannot enable the legacy comparison route through a flag', async () => {
  const old = [env.nodeEnv, env.routingCompareEnabled];
  try { env.nodeEnv = 'production'; env.routingCompareEnabled = true;
    await assert.rejects(() => compareRoutes(input), e => e.code === 'ROUTING_COMPARISON_DISABLED');
  } finally { [env.nodeEnv, env.routingCompareEnabled] = old; }
});

function multistop(points){
 return [{__type:'DirectionsReport',Origin:location(points[0]),Destination:location(points.at(-1)),ReportLegs:points.slice(1).map((p,i)=>({Origin:location(points[i]),Dest:location(p),ReportLines:[{Direction:'Destination',Dist:String(i+1),Time:'0:0'+(i+1)+':00',End:{Lat:p.lat,Lon:p.lng}}]}))},
 {__type:'MileageReport',ReportLines:points.map((p,i)=>({Stop:location(p),TMiles:String(i),LMiles:i?'1':'0',THours:'0:0'+i+':00',LHours:i?'0:01:00':'0:00:00'}))},
 {__type:'RoutePathReport',geometry:{type:'LineString',coordinates:points.map(p=>[p.lng,p.lat])}}];
}
test('complete two-point and ordered multi-stop reports prove every requested point',()=>{
 for(const points of [[input.origin,input.destination],[input.origin,{lat:40.01,lng:-120},{lat:40.02,lng:-120},input.destination]]){
 const route=parseTrimbleRouteResponse(multistop(points),{...input,viaStops:points.slice(1,-1)},config);
 assert.equal(route.legs.length,points.length-1);assert.deepEqual(route.validatedStops,points);assert.equal(route.truckSafe,true);
 assert.deepEqual(route.legs.map(l=>l.durationSeconds),Array(points.length-1).fill(60));}
});
test('omitted stops, wrong destination/order, missing metadata and incomplete legs fail closed',()=>{
 const points=[input.origin,{lat:40.01,lng:-120},{lat:40.02,lng:-120},input.destination],request={...input,viaStops:points.slice(1,-1)};
 for(const data of [multistop([points[0],points[3]]),multistop([points[0],points[2],points[1],points[3]]),multistop([...points.slice(0,-1),{lat:41,lng:-121}])])
 assert.throws(()=>parseTrimbleRouteResponse(data,request,config),e=>e.code==='TRIMBLE_STOP_COVERAGE_UNPROVEN' && e.truckSafe===false && e.navigationAllowed===false);
 for(const change of [d=>d[0].ReportLegs=[],d=>d[0].ReportLegs[1].ReportLines=[],d=>delete d[0].ReportLegs[1].Dest,
 d=>d[1].ReportLines[1].Stop.Errors=['unmatched'],d=>d[2].geometry.coordinates.splice(1,2)]){
 const data=multistop(points);change(data);assert.throws(()=>parseTrimbleRouteResponse(data,request,config),e=>e.code==='TRIMBLE_STOP_COVERAGE_UNPROVEN');}
});
test('direction stop snapping is bounded independently from RoutePath road matching',()=>{
 const data=payload();data[0].Origin.Coords.Lat+=0.000001;assert.doesNotThrow(()=>parseTrimbleRouteResponse(data,input,config));
 data[0].Origin.Coords.Lat+=0.001;assert.throws(()=>parseTrimbleRouteResponse(data,input,config),e=>e.code==='TRIMBLE_STOP_COVERAGE_UNPROVEN');
});



test('comparison cannot calculate or select a fallback in any environment or flag state', async t => {
  const old = [env.nodeEnv, env.routingCompareEnabled];
  const network = t.mock.method(globalThis, 'fetch', async () => { throw Error('unexpected network'); });
  const trimble = t.mock.method(TrimbleRouteProvider.prototype, 'buildRoute', async () => { throw Error('unexpected comparison'); });
  const here = t.mock.method(HereRouteProvider.prototype, 'buildRoute', async () => { throw Error('unexpected fallback'); });
  try {
    for (const mode of ['production', 'development', 'test']) for (const flag of [true, false]) {
      env.nodeEnv = mode; env.routingCompareEnabled = flag;
      await assert.rejects(() => compareRoutes(input), e => e.code === 'ROUTING_COMPARISON_DISABLED' && e.httpStatus === 410);
    }
  } finally { [env.nodeEnv, env.routingCompareEnabled] = old; }
  assert.equal(network.mock.callCount(), 0);
  assert.equal(trimble.mock.callCount(), 0);
  assert.equal(here.mock.callCount(), 0);
});

import { spawnSync } from 'node:child_process';
test('startup rejects non-Trimble routing configuration without exposing values', () => {
  for (const provider of ['here', 'mapbox', 'tomtom']) {
    const result = spawnSync(process.execPath, ['--input-type=module', '-e', 'import "./dist/config/env.js"'], {
      env: {...process.env, NODE_ENV: 'test', ROUTING_PROVIDER: provider}, encoding: 'utf8', timeout: 10000,
    });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /ROUTING_PROVIDER must be 'trimble'/);
  }
});


import { routingHealth, routingCapabilities, recordRoutingOutcome } from '../dist/services/routingCapabilities.js';

// Exercise the real provider request/parser through the production service,
// replacing only transport so no vendor credentials or network are required.
function healthHarness(t) {
  let body = payload();
  const transport = t.mock.fn(async () => new Response(JSON.stringify(body), {status: 200}));
  const provider = new TrimbleRouteProvider(config, transport);
  const original = TrimbleRouteProvider.prototype.buildRoute;
  t.mock.method(TrimbleRouteProvider.prototype, 'buildRoute', value => original.call(provider, value));
  const previousProvider = env.routingProvider;
  env.routingProvider = 'trimble';
  recordRoutingOutcome(null, 0);
  t.after(() => { env.routingProvider = previousProvider; recordRoutingOutcome(null, 0); });
  return {
    transport,
    response(value) { body = value; },
    health: () => routingHealth(true, []),
    capabilities: () => routingCapabilities(true, []),
  };
}

test('validated Trimble transport response establishes operational routing health', async t => {
  const h = healthHarness(t);
  const route = await buildTruckRoute(input);
  assert.equal(h.transport.mock.callCount(), 1);
  assert.equal(route.truckSafe, true);
  assert.equal(route.navigationAllowed, true);
  assert.equal(h.health().status, 'OPERATIONAL');
  assert.equal(h.capabilities().truckRouting.state, 'PLANNING_AVAILABLE');
});

test('provider stop-coverage rejection supersedes previous operational health', async t => {
  const h = healthHarness(t);
  await buildTruckRoute(input);
  const invalid = payload();
  delete invalid[0].Destination;
  h.response(invalid);
  await assert.rejects(() => buildTruckRoute(input), e =>
    e.code === 'TRIMBLE_STOP_COVERAGE_UNPROVEN' && e.httpStatus === 422 &&
    e.providerAttempted && !e.truckSafe && !e.navigationAllowed);
  assert.equal(h.transport.mock.callCount(), 2);
  assert.equal(h.health().status, 'UNAVAILABLE');
  assert.equal(h.capabilities().truckRouting.state, 'PROVIDER_UNAVAILABLE');
});

test('pre-transport client validation preserves the previous meaningful health evidence', async t => {
  const h = healthHarness(t);
  await buildTruckRoute(input);
  for (const invalid of [
    {...input, origin: {lat: 91, lng: -120}},
    {...input, truck: {...input.truck, heightFt: 100}},
    {...input, truck: {...input.truck, trailerType: 'RV'}},
    {...input, avoidSegments: ['legacy-segment']},
  ]) {
    await assert.rejects(() => buildTruckRoute(invalid), e => e.httpStatus === 422 && !e.providerAttempted);
    assert.equal(h.transport.mock.callCount(), 1);
    assert.equal(h.health().status, 'OPERATIONAL');
  }
  recordRoutingOutcome('TRIMBLE_STOP_COVERAGE_UNPROVEN');
  await assert.rejects(() => buildTruckRoute({...input, origin: {lat: 91, lng: -120}}));
  assert.equal(h.transport.mock.callCount(), 1);
  assert.equal(h.health().status, 'UNAVAILABLE');
});

test('later validated Trimble response recovers health after provider integrity rejection', async t => {
  const h = healthHarness(t);
  await buildTruckRoute(input);
  const invalid = payload();
  delete invalid[0].Destination;
  h.response(invalid);
  await assert.rejects(() => buildTruckRoute(input));
  assert.equal(h.health().status, 'UNAVAILABLE');
  h.response(payload());
  await buildTruckRoute(input);
  assert.equal(h.transport.mock.callCount(), 3);
  assert.equal(h.health().status, 'OPERATIONAL');
  assert.equal(h.capabilities().truckRouting.state, 'PLANNING_AVAILABLE');
  assert.equal(h.capabilities().turnByTurn.available, false);
  const expires = h.health().validUntil;
  assert.equal(routingHealth(true, [], new Date(expires)).status, 'DEGRADED');
});

test('other rejected provider evidence invalidates success without permitting an unsafe route', async t => {
  const h = healthHarness(t);
  for (const corrupt of [
    d => { d[0].ReportLegs[0].ReportLines[0].Warn = 'Truck restriction'; },
    d => { d[2].geometry.coordinates[1] = [-119, 91]; },
    d => { d[0].RouteID = 'one'; d[1].RouteID = 'another'; },
  ]) {
    h.response(payload());
    await buildTruckRoute(input);
    const invalid = payload();
    corrupt(invalid);
    h.response(invalid);
    await assert.rejects(() => buildTruckRoute(input), e => e.providerAttempted && !e.navigationAllowed);
    assert.equal(h.health().status, 'UNAVAILABLE');
  }
});

test('service safety rejection records failure rather than retaining earlier success', async t => {
  const h = healthHarness(t);
  await buildTruckRoute(input);
  // Replace the existing mock implementation so one restoration restores the real method.
  TrimbleRouteProvider.prototype.buildRoute.mock.mockImplementation(async () => ({
    ...parseTrimbleRouteResponse(payload(), input, config), navigationAllowed: false,
  }));
  await assert.rejects(() => buildTruckRoute(input), e => e.code === 'TRUCK_SAFE_ROUTE_UNAVAILABLE' && e.httpStatus === 422);
  assert.equal(h.health().status, 'UNAVAILABLE');
});

// These fixtures model singular MileageReport.ReportLines[].Stop from the
// provider response. Geometry/directions remain valid in negative mileage tests.
const acceptancePoints = [input.origin, {lat: 40.01, lng: -120}, input.destination];
const acceptanceInput = {...input, viaStops: [acceptancePoints[1]]};
const northByMeters = (point, meters) => ({...point, lat: point.lat + meters / 6371000 * 180 / Math.PI});
const coverageRejected = error => error.code === 'TRIMBLE_STOP_COVERAGE_UNPROVEN'
  && error.httpStatus === 422 && !error.truckSafe && !error.navigationAllowed;

test('singular Mileage Stop.Coords accepts finite numeric strings and produces three stops/two legs', () => {
  const data = multistop(acceptancePoints);
  for (const row of data[1].ReportLines) {
    row.Stop.Coords.Lat = String(row.Stop.Coords.Lat);
    row.Stop.Coords.Lon = String(row.Stop.Coords.Lon);
  }
  const route = parseTrimbleRouteResponse(data, acceptanceInput, config);
  assert.deepEqual(route.validatedStops, acceptancePoints);
  assert.equal(route.legs.length, 2);
  assert.equal(route.truckSafe, true);
  assert.equal(route.navigationAllowed, true);
});

test('all mileage stops accept small snaps and reject offsets immediately outside the policy cap', () => {
  assert.equal(TRIMBLE_STOP_SNAP_TOLERANCE_METERS, 50);
  for (let index = 0; index < acceptancePoints.length; index++) {
    for (const meters of [2, TRIMBLE_STOP_SNAP_TOLERANCE_METERS - 0.01, TRIMBLE_STOP_SNAP_TOLERANCE_METERS + 0.01]) {
      const data = multistop(acceptancePoints);
      const snapped = northByMeters(acceptancePoints[index], meters);
      data[1].ReportLines[index].Stop = location(snapped);
      if (meters > TRIMBLE_STOP_SNAP_TOLERANCE_METERS) {
        assert.throws(() => parseTrimbleRouteResponse(data, acceptanceInput, config), coverageRejected);
      } else {
        const route = parseTrimbleRouteResponse(data, acceptanceInput, config);
        assert.deepEqual(route.validatedStops[index], snapped, 'retain actual provider coordinates');
        assert.equal(route.legs.length, 2);
      }
    }
  }
});

test('mileage stop count must match exactly without relying on valid geometry or directions', () => {
  for (const mutate of [
    rows => rows.pop(), rows => rows.splice(1, 1),
    rows => rows.push(structuredClone(rows.at(-1))),
  ]) {
    const data = multistop(acceptancePoints);
    mutate(data[1].ReportLines);
    assert.throws(() => parseTrimbleRouteResponse(data, acceptanceInput, config), coverageRejected);
  }
});

test('reordered or duplicated mileage stop evidence fails with unchanged valid geometry and directions', () => {
  for (const points of [acceptancePoints, [input.origin, northByMeters(input.origin, 20), input.destination]]) {
    const request = {...input, viaStops: [points[1]]};
    for (const duplicate of [false, true]) {
      const data = multistop(points);
      if (duplicate) data[1].ReportLines[1].Stop = structuredClone(data[1].ReportLines[0].Stop);
      else [data[1].ReportLines[0].Stop, data[1].ReportLines[1].Stop] = [data[1].ReportLines[1].Stop, data[1].ReportLines[0].Stop];
      assert.throws(() => parseTrimbleRouteResponse(data, request, config), coverageRejected);
    }
  }
});

test('missing singular Stop cannot be replaced by plural Stops or geometry evidence', () => {
  for (let index = 0; index < acceptancePoints.length; index++) {
    for (const legacy of [false, true]) {
      const data = multistop(acceptancePoints);
      if (legacy) data[1].ReportLines[index].Stops = data[1].ReportLines[index].Stop;
      delete data[1].ReportLines[index].Stop;
      assert.throws(() => parseTrimbleRouteResponse(data, acceptanceInput, config), coverageRejected);
    }
  }
});

test('malformed/non-finite/out-of-range mileage Lat/Lon and location errors fail closed', () => {
  for (const field of ['Lat', 'Lon']) {
    for (const bad of [undefined, null, '', ' ', 'NaN', 'Infinity', NaN, Infinity, -Infinity, true, {}, [], '40junk', '0x28', 181, -181]) {
      const data = multistop(acceptancePoints);
      data[1].ReportLines[1].Stop.Coords[field] = bad;
      assert.throws(() => parseTrimbleRouteResponse(data, acceptanceInput, config), coverageRejected);
    }
  }
  for (const bad of [null, {}, {Coords: null}, {Coords: {lat: 40.01, lng: -120}},
    {...location(acceptancePoints[1]), Errors: ['unmatched']},
    {...location(acceptancePoints[1]), Errors: 'unmatched'}]) {
    const data = multistop(acceptancePoints);
    data[1].ReportLines[1].Stop = bad;
    assert.throws(() => parseTrimbleRouteResponse(data, acceptanceInput, config), coverageRejected);
  }
});

test('three-stop provider path preserves truck restrictions and records rejection/recovery health', async t => {
  const h = healthHarness(t);
  h.response(multistop(acceptancePoints));
  const route = await buildTruckRoute(acceptanceInput);
  assert.equal(route.validatedStops.length, 3);
  assert.equal(route.legs.length, 2);
  assert.equal(h.health().status, 'OPERATIONAL');
  const sent = JSON.parse(h.transport.mock.calls[0].arguments[1].body).ReportRoutes[0];
  assert.deepEqual(sent.Options.TruckCfg, {Units: 0, Height: '162', Width: '102', Length: '636', Weight: '80000', Axles: 5, MaxWeightPerAxleGroup: 20000, LCV: false});
  assert.deepEqual(sent.Options.TrailerCfg, {TypeOfTrailer: 3, Count: 1});
  assert.deepEqual(sent.Options.HazMatTypes, []);
  assert.equal(sent.Options.VehicleType, 0);
  assert.equal(sent.Options.RoutingType, 0);
  assert.equal(sent.Options.OverrideRestrict, false);
  assert.equal(sent.Options.HighwayOnly, false);
  const invalid = multistop(acceptancePoints);
  delete invalid[1].ReportLines[1].Stop;
  h.response(invalid);
  await assert.rejects(() => buildTruckRoute(acceptanceInput), e => coverageRejected(e) && e.providerAttempted);
  assert.equal(h.health().status, 'UNAVAILABLE');
  h.response(multistop(acceptancePoints));
  await buildTruckRoute(acceptanceInput);
  assert.equal(h.health().status, 'OPERATIONAL');
  assert.equal(h.transport.mock.callCount(), 3);
});

// Synthetic Trimble-style Directions/Mileage/RoutePath fixture, not a live
// response: driving rows have null TurnInstruction and provider cumulative
// Dist/Time plus Begin/End. The straight leg ends at leg.Dest without an arrival
// row. ReportLines[].Stop is the explicit ordered Mileage stop evidence.
function straightLegFixture(points = acceptancePoints) {
  const data = multistop(points);
  const index = points.length - 2;
  const begin = points[index], end = points[index + 1];
  const middle = {lat: (begin.lat + end.lat) / 2, lng: (begin.lng + end.lng) / 2};
  data[2].geometry.coordinates.splice(index + 1, 0, [middle.lng, middle.lat]);
  data[0].ReportLegs[index].ReportLines = [
    {Direction: 'Continue on Industrial Road', TurnInstruction: null,
      Dist: String(index + 0.5), Time: '0:0' + index + ':30',
      Begin: {Lat: begin.lat, Lon: begin.lng}, End: {Lat: middle.lat, Lon: middle.lng}},
    {Direction: 'Proceed along Industrial Road', TurnInstruction: null,
      Dist: String(index + 1), Time: '0:0' + (index + 1) + ':00',
      Begin: {Lat: middle.lat, Lon: middle.lng}, End: {Lat: end.lat, Lon: end.lng}},
  ];
  return data;
}

test('straight-leg regression: two-stop no-turn provider driving rows are accepted', () => {
  const route = parseTrimbleRouteResponse(straightLegFixture([input.origin, input.destination]), input, config);
  assert.equal(route.legs.length, 1);
  assert.deepEqual(route.legs[0].maneuvers.map(m => [m.instruction, m.distanceMiles, m.durationSeconds, m.action, m.direction]), [
    ['Continue on Industrial Road', 0.5, 30, 'continue', 'straight'],
    ['Proceed along Industrial Road', 0.5, 30, 'continue', 'straight'],
  ]);
});

test('straight-leg regression: three stops accept a straight second leg without an arrival row', () => {
  const data = straightLegFixture();
  assert.equal(data[0].ReportLegs.length, 2);
  assert.equal(data[1].ReportLines.length, 3);
  assert(data[0].ReportLegs[1].ReportLines.every(l => l.TurnInstruction === null && !/^Destination/i.test(l.Direction)));
  const route = parseTrimbleRouteResponse(data, acceptanceInput, config);
  assert.equal(route.legs.length, 2);
  assert.deepEqual(route.validatedStops, acceptancePoints);
  assert.deepEqual(route.legs[1].maneuvers.map(m => [m.distanceMiles, m.durationSeconds]), [[0.5, 30], [0.5, 30]]);
  assert.deepEqual(route.legs[1].maneuvers.map(m => m.coordinate), data[0].ReportLegs[1].ReportLines.map(l => ({lat: l.Begin.Lat, lng: l.Begin.Lon})));
  assert.equal(route.legs[1].distanceMiles, 1);
  assert.equal(route.legs[1].durationSeconds, 60);
});

const straightRejected = error => error.provider === 'Trimble' && !error.truckSafe && !error.navigationAllowed;

test('straight-leg safety: descriptive-only rows cannot fabricate distance or time', () => {
  const data = straightLegFixture();
  for (const row of data[0].ReportLegs[1].ReportLines) { delete row.Dist; delete row.Time; }
  assert.throws(() => parseTrimbleRouteResponse(data, acceptanceInput, config), e => straightRejected(e) && e.code === 'TRIMBLE_INCOMPLETE_ROUTE');
});

test('straight-leg safety: malformed/missing time, distance, or instruction fails closed', () => {
  for (const patch of [{Time: '1:99'}, {Time: null}, {Time: 'NaN'}, {Time: ''},
    {Dist: null}, {Dist: 'NaN'}, {Dist: Infinity}, {Direction: ''}, {Direction: '   '}]) {
    const data = straightLegFixture();
    Object.assign(data[0].ReportLegs[1].ReportLines[0], patch);
    assert.throws(() => parseTrimbleRouteResponse(data, acceptanceInput, config), e => straightRejected(e) && e.code === 'TRIMBLE_MANEUVER_DATA_REQUIRED');
  }
});

test('straight-leg safety: cumulative distance/time cannot regress below start or preceding row', () => {
  for (const [index, patch] of [[0, {Dist: '0.9'}], [1, {Dist: '1.4'}],
    [0, {Time: '0:00:59'}], [1, {Time: '0:01:29'}]]) {
    const data = straightLegFixture();
    Object.assign(data[0].ReportLegs[1].ReportLines[index], patch);
    assert.throws(() => parseTrimbleRouteResponse(data, acceptanceInput, config), e => straightRejected(e) && e.code === 'TRIMBLE_MANEUVER_DATA_REQUIRED');
  }
});

test('straight-leg safety: restrictions on driving or descriptive rows reject the entire route', () => {
  for (const patch of [{Warn: 'Truck restricted'}, {DetailedWarnings: [{Type: 3}]}]) {
    for (const descriptive of [false, true]) {
      const data = straightLegFixture();
      const row = descriptive ? {Direction: 'Provider note', TurnInstruction: null} : data[0].ReportLegs[1].ReportLines[1];
      if (descriptive) data[0].ReportLegs[1].ReportLines.push(row);
      Object.assign(row, patch);
      assert.throws(() => parseTrimbleRouteResponse(data, acceptanceInput, config), e => straightRejected(e) && e.code === 'TRIMBLE_RESTRICTION_WARNING');
    }
  }
});

test('straight-leg safety: invalid leg mileage/time and missing starting totals stay unavailable', () => {
  for (const [row, patch] of [[2, {LMiles: null}], [2, {LMiles: '-1'}], [2, {LMiles: 'bad'}],
    [2, {LHours: null}], [2, {LHours: '0:99'}], [1, {TMiles: null}], [1, {TMiles: '-1'}],
    [1, {THours: null}], [1, {THours: 'bad'}]]) {
    const data = straightLegFixture();
    Object.assign(data[1].ReportLines[row], patch);
    assert.throws(() => parseTrimbleRouteResponse(data, acceptanceInput, config), straightRejected);
  }
});

test('straight-leg safety: use a valid provider End when Begin is absent, never invented coordinates', () => {
  const data = straightLegFixture();
  for (const row of data[0].ReportLegs[1].ReportLines) delete row.Begin;
  const route = parseTrimbleRouteResponse(data, acceptanceInput, config);
  assert.deepEqual(route.legs[1].maneuvers.map(m => m.coordinate), data[0].ReportLegs[1].ReportLines.map(l => ({lat: l.End.Lat, lng: l.End.Lon})));
  for (const invalid of [{Begin: null, End: null}, {Begin: {Lat: 'NaN', Lon: '-120'}, End: {Lat: 91, Lon: -120}}]) {
    const bad = straightLegFixture();
    Object.assign(bad[0].ReportLegs[1].ReportLines[0], invalid);
    assert.throws(() => parseTrimbleRouteResponse(bad, acceptanceInput, config), e => straightRejected(e) && e.code === 'TRIMBLE_MANEUVER_COORDINATE_REQUIRED');
  }
});

test('straight-leg safety: explicit stop proof and dense RoutePath remain required', () => {
  for (const mutate of [d => delete d[1].ReportLines[1].Stop,
    d => { d[1].ReportLines[1].Stop.Coords.Lat += 0.001; },
    d => d.splice(2, 1)]) {
    const data = straightLegFixture();
    mutate(data);
    assert.throws(() => parseTrimbleRouteResponse(data, acceptanceInput, config), straightRejected);
  }
  assert.equal(TRIMBLE_STOP_SNAP_TOLERANCE_METERS, 50);
});

test('straight-leg regression: explicit turn rows retain their existing mapping and provider metrics', () => {
  const data = multistop(acceptancePoints);
  data[0].ReportLegs[1].ReportLines = [
    {Direction: 'Turn right onto Industrial Road', TurnInstruction: 'TC_Right',
      Dist: '1.5', Time: '0:01:30', Begin: {Lat: acceptancePoints[1].lat, Lon: acceptancePoints[1].lng}},
    {Direction: 'Destination', TurnInstruction: null,
      Dist: '2', Time: '0:02:00', End: {Lat: input.destination.lat, Lon: input.destination.lng}},
  ];
  const route = parseTrimbleRouteResponse(data, acceptanceInput, config);
  assert.deepEqual(route.legs[1].maneuvers.map(m => [m.action, m.direction, m.distanceMiles, m.durationSeconds]), [
    ['turn', 'right', 0.5, 30], ['arrive', 'straight', 0.5, 30],
  ]);
});
