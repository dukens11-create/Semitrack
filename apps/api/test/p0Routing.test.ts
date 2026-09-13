import assert from 'node:assert/strict';
import test from 'node:test';
import { buildTrimbleRouteRequest, parseTrimbleRouteResponse, TrimbleRouteProvider } from '../dist/services/providers/trimbleProvider.js';
const config={apiKey:'test-only',baseUrl:'https://provider.example.test',dataVersion:'Current',profileName:'',geoTunnelIntervalMiles:0.1,requestTimeoutMs:1000,routePathEnabled:true,alternateRoutesEnabled:false};
const input={origin:{lat:40,lng:-120},destination:{lat:40,lng:-119.999},truck:{heightFt:13.5,widthFt:8.5,lengthFt:53,weightLbs:80000,currentWeightLbs:72000,weightPerAxleLbs:20000,axleCount:5,trailerCount:1,trailerType:'Dry Van',hazmatEnabled:false,hazardousGoods:[],avoidTolls:false,avoidFerries:false,avoidHighways:false,avoidResidential:false,avoidDirtRoads:false}};
function payload(){return [{__type:'DirectionsReport',ReportLegs:[{ReportLines:[{Direction:'Destination',Dist:'1',Time:'0:02:00',End:{Lat:40,Lon:-119.999}}]}]},{__type:'MileageReport',ReportLines:[{TMiles:'1',LMiles:'1',THours:'0:02:00',LHours:'0:02:00'}]},{__type:'RoutePathReport',geometry:{type:'LineString',coordinates:[[-120,40],[-119.999,40]]}}];}
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
test('unsupported avoidance and contradictory hazmat cannot be silently dropped',()=>{
 for(const key of ['avoidHighways','avoidResidential','avoidDirtRoads'])assert.throws(()=>buildTrimbleRouteRequest({...input,truck:{...input.truck,[key]:true}},config),/cannot be guaranteed/);
 assert.throws(()=>buildTrimbleRouteRequest({...input,truck:{...input.truck,hazardousGoods:['explosive']}},config));
});
test('invalid vertices cannot be discarded to fabricate a connecting road',()=>{for(const point of [[NaN,40],[-120,91],['-120',40],[-120]]){const data=payload();data[2].geometry.coordinates.splice(1,0,point);assert.throws(()=>parseTrimbleRouteResponse(data,input,config));}});
test('missing or malformed maneuver distance/time/instruction never becomes zero',()=>{
 for(const patch of [{Dist:null},{Dist:'-1'},{Time:null},{Time:'1:99'},{Time:'NaN'},{Direction:'',TurnInstruction:'TC_Left'}]){const data=payload();Object.assign(data[0].ReportLegs[0].ReportLines[0],patch);assert.throws(()=>parseTrimbleRouteResponse(data,input,config));}
});
test('empty directions and invalid summaries fail closed',()=>{for(const change of [(d)=>d[0].ReportLegs=[],(d)=>d[1].ReportLines[0].TMiles='-1',(d)=>d[1].ReportLines[0].THours=null]){const data=payload();change(data);assert.throws(()=>parseTrimbleRouteResponse(data,input,config));}});
test('validated RoutePath derives actual maneuver offset and matching distance',()=>{const route=parseTrimbleRouteResponse(payload(),input,config);assert.equal(route.turnByTurn[0].offset,1);assert.equal(route.turnByTurn[0].geometryMatchDistanceMeters,0);assert.equal(route.navigationAllowed,true);});
test('provider timeout includes stalled response body',async()=>{
 const provider=new TrimbleRouteProvider(config,async(_url,init)=>({ok:true,status:200,text:()=>new Promise((_resolve,reject)=>init.signal.addEventListener('abort',()=>reject(new Error('secret'))))}));
 await assert.rejects(()=>provider.buildRoute(input),e=>e.code==='TRIMBLE_REQUEST_TIMEOUT');
});

test('restriction warnings cannot return truck-safe routing',()=>{const data=payload();data[0].ReportLegs[0].ReportLines[0].Warn='Truck Restricted cleanup point';assert.throws(()=>parseTrimbleRouteResponse(data,input,config),e=>e.code==='TRIMBLE_RESTRICTION_WARNING');});
test('different provider route IDs cannot be spliced into one route',()=>{const data=payload();data[0].RouteID='first';data[1].RouteID='other';assert.throws(()=>parseTrimbleRouteResponse(data,input,config),e=>e.code==='TRIMBLE_ROUTE_ID_MISMATCH');});

test('provider deadline also bounds an unresponsive response body',async()=>{const provider=new TrimbleRouteProvider(config,async()=>({ok:true,status:200,text:()=>new Promise(()=>{})}));await assert.rejects(()=>provider.buildRoute(input),e=>e.code==='TRIMBLE_REQUEST_TIMEOUT');});
