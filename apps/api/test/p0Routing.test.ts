import assert from 'node:assert/strict';
import test from 'node:test';
import { buildTrimbleRouteRequest, parseTrimbleRouteResponse, TrimbleRouteProvider } from '../dist/services/providers/trimbleProvider.js';
const config={apiKey:'test-only',baseUrl:'https://provider.example.test',dataVersion:'Current',profileName:'',geoTunnelIntervalMiles:0.1,requestTimeoutMs:1000,routePathEnabled:true,alternateRoutesEnabled:false};
const input={origin:{lat:40,lng:-120},destination:{lat:40,lng:-119.999},truck:{heightFt:13.5,widthFt:8.5,lengthFt:53,weightLbs:80000,currentWeightLbs:72000,weightPerAxleLbs:20000,axleCount:5,trailerCount:1,trailerType:'Dry Van',hazmatEnabled:false,hazardousGoods:[],avoidTolls:false,avoidFerries:false,avoidHighways:false,avoidResidential:false,avoidDirtRoads:false}};
const location=p=>({Coords:{Lat:p.lat,Lon:p.lng},Errors:[]});
function payload(){return [{__type:'DirectionsReport',Origin:location(input.origin),Destination:location(input.destination),ReportLegs:[{Origin:location(input.origin),Dest:location(input.destination),ReportLines:[{Direction:'Destination',Dist:'1',Time:'0:02:00',End:{Lat:40,Lon:-119.999}}]}]},{__type:'MileageReport',ReportLines:[{Stops:location(input.origin),TMiles:'0',LMiles:'0',THours:'0:00:00',LHours:'0:00:00'},{Stops:location(input.destination),TMiles:'1',LMiles:'1',THours:'0:02:00',LHours:'0:02:00'}]},{__type:'RoutePathReport',geometry:{type:'LineString',coordinates:[[-120,40],[-119.999,40]]}}];}
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
 {__type:'MileageReport',ReportLines:points.map((p,i)=>({Stops:location(p),TMiles:String(i),LMiles:i?'1':'0',THours:'0:0'+i+':00',LHours:i?'0:01:00':'0:00:00'}))},
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
 d=>d[1].ReportLines[1].Stops.Errors=['unmatched'],d=>d[2].geometry.coordinates.splice(1,2)]){
 const data=multistop(points);change(data);assert.throws(()=>parseTrimbleRouteResponse(data,request,config),e=>e.code==='TRIMBLE_STOP_COVERAGE_UNPROVEN');}
});
test('stop metadata precision is bounded independently from RoutePath road matching',()=>{
 const data=payload();data[0].Origin.Coords.Lat+=0.000001;assert.doesNotThrow(()=>parseTrimbleRouteResponse(data,input,config));
 data[0].Origin.Coords.Lat+=0.0001;assert.throws(()=>parseTrimbleRouteResponse(data,input,config),e=>e.code==='TRIMBLE_STOP_COVERAGE_UNPROVEN');
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
  t.mock.method(TrimbleRouteProvider.prototype, 'buildRoute', async () => ({
    ...parseTrimbleRouteResponse(payload(), input, config), navigationAllowed: false,
  }));
  await assert.rejects(() => buildTruckRoute(input), e => e.code === 'TRUCK_SAFE_ROUTE_UNAVAILABLE' && e.httpStatus === 422);
  assert.equal(h.health().status, 'UNAVAILABLE');
});
