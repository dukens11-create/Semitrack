import { MAX_INTERMEDIATE_STOPS, MAX_ROUTE_LOCATIONS } from '../dist/contracts/routeLimits.js';
import assert from 'node:assert/strict';
import test from 'node:test';
import {buildTrimbleRouteRequest, parseTrimbleRouteResponse} from '../dist/services/providers/trimbleProvider.js';

// Synthetic, not a captured provider response. Directions Dist/Time are per-line;
// Mileage LMiles/LHours are per-leg, TMiles/THours are cumulative.
// https://developer.trimblemaps.com/restful-apis/routing/route-reports/directions/
const config = {apiKey:'test-only',baseUrl:'https://example.test',dataVersion:'Current',profileName:'',geoTunnelIntervalMiles:1,requestTimeoutMs:1000,routePathEnabled:true,alternateRoutesEnabled:false};
const clock = s => `${Math.floor(s/3600)}:${String(Math.floor(s/60)%60).padStart(2,'0')}:${String(s%60).padStart(2,'0')}`;
function fixture(count=3) {
  const points=Array.from({length:count},(_,i)=>({lat:40,lng:-120+i*0.02}));
  const loc=(p,i)=>({Coords:{Lat:p.lat,Lon:p.lng},Errors:[],Label:i===0?'Origin':i===count-1?'Destination':`Stop ${i}`});
  const coords=p=>({Lat:p.lat,Lon:p.lng});
  const geometry=[];
  const legs=points.slice(1).map((end,i)=>{
    const start=points[i],mid={lat:40,lng:start.lng+0.01};
    geometry.push([start.lng,40],[mid.lng,40]);
    return {Origin:loc(start,i),Dest:loc(end,i+1),ReportLines:[
      {Direction:'Continue on Test Road',Dist:'0.4',Time:'0:00:20',Begin:coords(start),End:coords(mid)},
      {Direction:'Turn right on Test Road',TurnInstruction:'TC_Right',Dist:'4.6',Time:'0:01:40',Begin:coords(mid),End:coords(end)},
      {Direction:loc(end,i+1).Label,Dist:'0',Time:'0:00:00',Begin:coords(end),End:coords(end)},
    ]};
  });
  geometry.push([points.at(-1).lng,40]);
  const input={origin:points[0],viaStops:points.slice(1,-1),destination:points.at(-1),truck:{heightFt:13.5,widthFt:8.5,lengthFt:53,weightLbs:80000,axleCount:5,trailerCount:1,trailerType:'semi trailer',hazmatEnabled:false,hazardousGoods:[],avoidTolls:false,avoidFerries:false,avoidHighways:false,avoidResidential:false,avoidDirtRoads:false},alternatives:0};
  const reports=[{__type:'DirectionsReport',Origin:loc(points[0],0),Destination:loc(points.at(-1),count-1),ReportLegs:legs},
    {__type:'MileageReport',ReportLines:points.map((p,i)=>({Stop:loc(p,i),LMiles:i?'5':'0',LHours:clock(i?120:0),TMiles:String(i*5),THours:clock(i*120)}))},
    {__type:'RoutePathReport',geometry:{type:'LineString',coordinates:geometry}}];
  return {input,reports,points};
}
const reject=({reports,input},code?)=>assert.throws(()=>parseTrimbleRouteResponse(reports,input,config),e=>
  e.truckSafe===false&&e.navigationAllowed===false&&(!code||e.code===code));

for(const count of [2,3,4,5,8,9,10,15,20,MAX_ROUTE_LOCATIONS]) test(`${count} stops: independent line metrics, ${count-1} legs, arrivals and consistent totals`,()=>{
  const f=fixture(count),route=parseTrimbleRouteResponse(f.reports,f.input,config);
  assert.equal(route.legs.length,count-1);assert.deepEqual(route.validatedStops,f.points);
  assert.equal(route.truckSafe,true);assert.equal(route.navigationAllowed,true);
  for(const leg of route.legs){
    assert.deepEqual(leg.maneuvers.map(m=>m.distanceMiles),[0.4,4.6,0]);
    assert.deepEqual(leg.maneuvers.map(m=>m.durationSeconds),[20,100,0]);
    assert.equal(leg.maneuvers.at(-1).action,'arrive');
    assert.equal(leg.distanceMiles,5);assert.equal(leg.durationSeconds,120);
  }
  assert.equal(route.distanceMiles,5*(count-1));assert.equal(route.durationSeconds,120*(count-1));
  assert.deepEqual(route.turnByTurn.map(m=>m.step),route.turnByTurn.map((_,i)=>i+1));
  assert.equal(buildTrimbleRouteRequest(f.input,config).ReportRoutes[0].Stops.length,count);
});

test('prior cumulative 5 miles cannot reject a later 0.4-mile line',()=>{
  const f=fixture();assert.equal(f.reports[1].ReportLines[1].TMiles,'5');
  assert.equal(parseTrimbleRouteResponse(f.reports,f.input,config).legs[1].maneuvers[0].distanceMiles,0.4);
});
test('repeated small distances and decreasing independent durations remain valid',()=>{
  const f=fixture(5);
  for(const leg of f.reports[0].ReportLegs){leg.ReportLines[0].Dist='2.5';leg.ReportLines[1].Dist='2.5';leg.ReportLines[0].Time='0:01:40';leg.ReportLines[1].Time='0:00:20';}
  const route=parseTrimbleRouteResponse(f.reports,f.input,config);
  assert(route.legs.every(l=>l.maneuvers[0].durationSeconds===100&&l.maneuvers[1].durationSeconds===20));
});
for(const patch of [{Dist:null},{Time:null},{Dist:'bad'},{Time:'0:99'},{Dist:'-1'}]) test(`intermediate line malformed ${JSON.stringify(patch)}`,()=>{
  const f=fixture(5);Object.assign(f.reports[0].ReportLegs[2].ReportLines[1],patch);reject(f,'TRIMBLE_MANEUVER_DATA_REQUIRED');
});
for(const field of ['LMiles','LHours','TMiles','THours']) test(`missing intermediate Mileage ${field} fails closed`,()=>{
  const f=fixture(5);delete f.reports[1].ReportLines[2][field];reject(f);
});
for(const field of ['LMiles','LHours','TMiles','THours']) test(`contradictory intermediate Mileage ${field} fails closed`,()=>{
  const f=fixture(5);f.reports[1].ReportLines[2][field]=field.includes('Miles')?'6':'0:09:00';reject(f);
});
test('duplicated report instance fails closed',()=>{const f=fixture();f.reports.push(structuredClone(f.reports[0]));reject(f);});
test('reordered Mileage stops fail closed',()=>{const f=fixture(5);[f.reports[1].ReportLines[1],f.reports[1].ReportLines[2]]=[f.reports[1].ReportLines[2],f.reports[1].ReportLines[1]];reject(f,'TRIMBLE_STOP_COVERAGE_UNPROVEN');});
test('duplicated provider stop fails closed',()=>{const f=fixture(5);f.reports[1].ReportLines[2].Stop=structuredClone(f.reports[1].ReportLines[1].Stop);reject(f,'TRIMBLE_STOP_COVERAGE_UNPROVEN');});
test('reordered Directions legs fail closed',()=>{const f=fixture(5);[f.reports[0].ReportLegs[1],f.reports[0].ReportLegs[2]]=[f.reports[0].ReportLegs[2],f.reports[0].ReportLegs[1]];reject(f,'TRIMBLE_STOP_COVERAGE_UNPROVEN');});
test('duplicated maneuver metrics cannot inflate a leg',()=>{const f=fixture();f.reports[0].ReportLegs[1].ReportLines.splice(1,0,structuredClone(f.reports[0].ReportLegs[1].ReportLines[0]));reject(f);});
for(const warning of [{Warn:'Truck restriction'},{DetailedWarnings:[{Type:3}]},{Warn:{}},{DetailedWarnings:{Type:3}}]) test(`intermediate warning ${JSON.stringify(warning)} rejects entire route`,()=>{
  const f=fixture(5);Object.assign(f.reports[0].ReportLegs[2].ReportLines[1],warning);
  assert.throws(()=>parseTrimbleRouteResponse(f.reports,f.input,config),e=>{
    assert.equal(e.code,'TRIMBLE_RESTRICTION_WARNING');assert.equal(e.truckSafe,false);assert.equal(e.navigationAllowed,false);
    assert.equal(e.restrictionDiagnostic.legNumber,3);
    assert.equal(e.restrictionDiagnostic.malformedWarningEvidencePresent, typeof warning.Warn==='object'||(warning.DetailedWarnings!=null&&!Array.isArray(warning.DetailedWarnings)));
    return true;
  });
});
test('Directions aggregate contradiction fails closed',()=>{const f=fixture();f.reports[0].ReportLegs[1].ReportLines[1].Dist='3';reject(f);});
test('26th intermediate stop exceeds the shared API limit',()=>assert.throws(()=>buildTrimbleRouteRequest(fixture(MAX_ROUTE_LOCATIONS+1).input,config),e=>e.code==='TRIMBLE_REQUEST_INVALID'));

for (const legNumber of [1,5,9,17,24,MAX_ROUTE_LOCATIONS-1]) test('27 locations: restriction on leg '+legNumber+' rejects entire route',()=>{
  const f=fixture(MAX_ROUTE_LOCATIONS);f.reports[0].ReportLegs[legNumber-1].ReportLines[1].DetailedWarnings=[{Type:3}];reject(f,'TRIMBLE_RESTRICTION_WARNING');
});
for (const defect of ['missing','duplicate']) test('27 locations: '+defect+' intermediate leg fails closed',()=>{
  const f=fixture(MAX_ROUTE_LOCATIONS);if(defect==='missing')f.reports[0].ReportLegs.splice(17,1);else f.reports[0].ReportLegs[17]=structuredClone(f.reports[0].ReportLegs[16]);reject(f,'TRIMBLE_STOP_COVERAGE_UNPROVEN');
});
test('27-location request retains every truck restriction and ordered provider stops',()=>{
  const f=fixture(MAX_ROUTE_LOCATIONS),r=buildTrimbleRouteRequest(f.input,config).ReportRoutes[0];
  assert.equal(f.input.viaStops.length,MAX_INTERMEDIATE_STOPS);
  assert.deepEqual(r.Stops.map(s=>({lat:s.Coords.Lat,lng:s.Coords.Lon})),f.points);
  assert.equal(r.Options.VehicleType,0);assert.equal(r.Options.OverrideRestrict,false);
  assert.deepEqual(r.Options.TruckCfg,{Units:0,Height:'162',Width:'102',Length:'636',Weight:'80000',Axles:5,LCV:false});
  assert.equal(r.Options.TrailerCfg.Count,1);assert.deepEqual(r.Options.HazMatTypes,[]);
});
test('metadata-only origin followed by one authoritative straight line is valid',()=>{
  const f=fixture(2),leg=f.reports[0].ReportLegs[0],start=leg.ReportLines[0].Begin,end=leg.ReportLines[1].End;
  leg.ReportLines=[{Direction:'Origin',Begin:start,End:start},{Direction:'Continue on Test Road',Dist:'5',Time:'0:02:00',Begin:start,End:end}];
  const route=parseTrimbleRouteResponse(f.reports,f.input,config);assert.equal(route.legs[0].maneuvers.length,1);assert.equal(route.legs[0].maneuvers[0].distanceMiles,5);
});
test('duplicate requested locations cannot pass ordered provider evidence',()=>{
  const f=fixture(5);f.input.viaStops[1]={...f.input.viaStops[0]};reject(f,'TRIMBLE_STOP_COVERAGE_UNPROVEN');
});
test('27 locations: malformed final intermediate coordinate fails closed',()=>{
  const f=fixture(MAX_ROUTE_LOCATIONS);f.reports[1].ReportLines[25].Stop.Coords.Lat='not-a-number';reject(f,'TRIMBLE_STOP_COVERAGE_UNPROVEN');
});
