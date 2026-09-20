import assert from 'node:assert/strict';
import test from 'node:test';
import {buildTrimbleRouteRequest, parseTrimbleRouteResponse} from '../dist/services/providers/trimbleProvider.js';

// Synthetic coordinates/instructions, documented report structure (not a captured
// device response). Directions Dist/Time are independent per-line metrics.
// Mileage alone carries cumulative totals. Stop marker rows carry zero travel.
// Directions uses H:MM; Mileage TimeInSeconds=true supplies H:MM:SS independently.
// https://developer.trimblemaps.com/restful-apis/routing/route-reports/post-route-reports/
// https://developer.trimblemaps.com/restful-apis/routing/route-reports/mileage/
const config = {apiKey:'test-only',baseUrl:'https://example.test',dataVersion:'Current',profileName:'',geoTunnelIntervalMiles:1,requestTimeoutMs:1000,routePathEnabled:true,alternateRoutesEnabled:false};
const clock = (seconds, precise=false) => `${Math.floor(seconds/3600)}:${String(Math.floor(seconds/60)%60).padStart(2,'0')}${precise ? ':'+String(seconds%60).padStart(2,'0') : ''}`;
function fixture(count=3) {
  const points=Array.from({length:count},(_,i)=>({lat:40,lng:-120+i*0.02}));
  const loc=(p,i)=>({Coords:{Lat:p.lat,Lon:p.lng},Errors:[],Label:i===0?'Origin':i===count-1?'Destination':`Stop ${i}`});
  const totals=points.map((_,i)=>i===0?0:100+(i-1)*65);
  const row=(Direction,Dist,Time,p,q=p,TurnInstruction=null)=>({Direction,Dist,Time,Begin:{Lat:p.lat,Lon:p.lng},End:{Lat:q.lat,Lon:q.lng},TurnInstruction,Warn:null});
  const geometry=[];
  const legs=points.slice(1).map((end,i)=>{
    const start=points[i],middle={lat:40,lng:start.lng+0.005};
    geometry.push([start.lng,start.lat],[middle.lng,middle.lat]);
    const lines=[
      row(i?`Stop ${i}, Test locality`:'Origin, Test locality',i?'0':null,i?'0:00':null,start),
      row('Turn right on Test Road',null,null,start,middle,'TC_Right'),
      row('Drive to the next junction','0.25','0:00',start,middle),
      row('Continue on Test Road','0.75','0:01',middle,end),
    ];
    if(i===count-2) lines.push(row('Destination, Test locality','0','0:00',end));
    return {Origin:loc(start,i),Dest:loc(end,i+1),ReportLines:lines};
  });
  geometry.push([points.at(-1).lng,points.at(-1).lat]);
  const input={origin:points[0],viaStops:points.slice(1,-1),destination:points.at(-1),truck:{heightFt:13.5,widthFt:8.5,lengthFt:53,weightLbs:80000,currentWeightLbs:72000,weightPerAxleLbs:20000,axleCount:5,trailerCount:1,trailerType:'semi trailer',hazmatEnabled:false,hazardousGoods:[],avoidTolls:false,avoidFerries:false,avoidHighways:false,avoidResidential:false,avoidDirtRoads:false},routeMode:'fastest',alternatives:0};
  const reports=[
    {__type:'DirectionsReport',Origin:loc(points[0],0),Destination:loc(points.at(-1),count-1),ReportLegs:legs},
    {__type:'MileageReport',ReportLines:points.map((p,i)=>({Stop:loc(p,i),TMiles:String(i),LMiles:i?'1':'0',THours:clock(totals[i],true),LHours:clock(i?totals[i]-totals[i-1]:0,true)}))},
    {__type:'RoutePathReport',geometry:{type:'LineString',coordinates:geometry}},
  ];
  return {input,reports,totals,points};
}

test('Directions minute clocks are independent of cumulative Mileage clocks',()=>{
  const {input,reports}=fixture();
  // Before repair: TRIMBLE_MANEUVER_DATA_REQUIRED / HTTP 502 on leg 2:
  // Directions 0:01 versus Mileage starting THours 0:01:40.
  const route=parseTrimbleRouteResponse(reports,input,config);
  assert.equal(route.legs.length,2);
  assert.equal(route.truckSafe,true);
  assert.equal(route.navigationAllowed,true);
});

for (const count of [2,3,5]) test(`${count} stops preserve every driving instruction, stop marker, total and leg`,()=>{
  const {input,reports,points,totals}=fixture(count);
  const route=parseTrimbleRouteResponse(reports,input,config);
  const instructions=reports[0].ReportLegs.flatMap((leg,i)=>[
    ...(i?[`Stop ${i}, Test locality`]:[]),'Turn right on Test Road','Continue on Test Road',
    ...(i===count-2?['Destination, Test locality']:[]),
  ]);
  assert.deepEqual(route.turnByTurn.map(m=>m.instruction),instructions);
  assert.deepEqual(route.legs.flatMap(l=>l.maneuvers),route.turnByTurn);
  assert.deepEqual(route.turnByTurn.map(m=>m.step),instructions.map((_,i)=>i+1));
  assert.deepEqual(route.turnByTurn.filter(m=>m.action==='arrive').map(m=>m.coordinate),points.slice(1));
  assert.equal(route.turnByTurn.at(-1).action,'arrive');
  assert.equal(route.distanceMiles,count-1);
  assert.equal(route.durationSeconds,totals.at(-1));
  assert.deepEqual(route.legs.map(l=>l.distanceMiles),points.slice(1).map(()=>1));
  assert.deepEqual(route.legs.map(l=>l.durationSeconds),points.slice(1).map((_,i)=>totals[i+1]-totals[i]));
  assert.deepEqual(route.routeGeometry,reports[2].geometry.coordinates);
  assert.deepEqual(route.validatedStops,points);
  for(const leg of route.legs){
    assert.equal(leg.maneuvers.reduce((sum,m)=>sum+m.distanceMiles,0),1);
    assert(leg.maneuvers.every(m=>Number.isFinite(m.durationSeconds)&&m.durationSeconds>=0));
  }
  // Directions duration retains provider minute precision; don't manufacture
  // extra seconds to make its maneuvers add up to precise Mileage duration.
  assert.equal(route.legs[0].maneuvers.reduce((sum,m)=>sum+m.durationSeconds,0),60);
});

test('uncondensed Go heading retains text and consumes only its provider metric companion',()=>{
  const {input,reports}=fixture();
  for(const leg of reports[0].ReportLegs) Object.assign(leg.ReportLines[1],{Direction:'Go east on Test Road',TurnInstruction:null});
  const route=parseTrimbleRouteResponse(reports,input,config);
  assert.equal(route.turnByTurn.filter(m=>m.instruction==='Go east on Test Road').length,2);
  assert(route.turnByTurn.filter(m=>m.instruction.startsWith('Go')).every(m=>m.action==='continue'&&m.distanceMiles===0.25));
});

test('explicit intermediate arrival at previous leg end is preserved along with later leg maneuvers',()=>{
  const {input,reports}=fixture();
  const marker=structuredClone(reports[0].ReportLegs[1].ReportLines[0]);
  reports[0].ReportLegs[0].ReportLines.push(marker);
  const route=parseTrimbleRouteResponse(reports,input,config);
  assert.equal(route.legs[0].maneuvers.at(-1).instruction,marker.Direction);
  assert.equal(route.legs[0].maneuvers.at(-1).action,'arrive');
  assert.equal(route.legs[1].maneuvers.at(-1).action,'arrive');
});

test('an unrecognized turn code is not relabelled as a straight maneuver',()=>{
  const {input,reports}=fixture();
  Object.assign(reports[0].ReportLegs[1].ReportLines[1],{TurnInstruction:'TC_Unrecognized',Direction:'Provider instruction'});
  const turn=parseTrimbleRouteResponse(reports,input,config).legs[1].maneuvers[1];
  assert.equal(turn.instruction,'Provider instruction');
  assert.equal(turn.action,undefined);assert.equal(turn.direction,undefined);
});

const reject=(reports,input,code='TRIMBLE_MANEUVER_DATA_REQUIRED')=>assert.throws(
  ()=>parseTrimbleRouteResponse(reports,input,config),
  e=>e.code===code && e.truckSafe===false && e.navigationAllowed===false,
);
for(const [label,patch] of Object.entries({
  'missing distance':{Dist:null}, 'invalid distance':{Dist:'invalid'},
  'negative distance':{Dist:'-1'}, 'missing time':{Time:null},
  'invalid time':{Time:'0:99'}, 'inconsistent leg time':{Time:'9:00'},
  'inconsistent leg distance':{Dist:'0.5'},
})) test(`second-leg metric companion ${label} fails closed`,()=>{
  const {input,reports}=fixture();
  Object.assign(reports[0].ReportLegs[1].ReportLines[2],patch);
  reject(reports,input);
});

test('missing second-leg turn metrics cannot borrow the next driving instruction',()=>{
  const {input,reports}=fixture();
  reports[0].ReportLegs[1].ReportLines.splice(2,1);
  reject(reports,input);
});

test('an intermediate stop marker alone is not usable second-leg maneuver evidence',()=>{
  const {input,reports}=fixture();
  reports[0].ReportLegs[1].ReportLines.length=1;
  reject(reports,input,'TRIMBLE_INCOMPLETE_ROUTE');
});

test('a malformed turn Begin cannot be replaced by its valid End coordinate',()=>{
  const {input,reports}=fixture();
  reports[0].ReportLegs[1].ReportLines[1].Begin.Lat='invalid';
  reject(reports,input,'TRIMBLE_MANEUVER_COORDINATE_REQUIRED');
});

test('malformed standalone provider driving instruction cannot hide behind valid turns or arrival',()=>{
  const {input,reports}=fixture();
  reports[0].ReportLegs[1].ReportLines[3].Direction='';
  reject(reports,input);
});

for(const patch of [{Dist:'0.1'},{Time:'0:02'},{Time:'0:01:00'},{Time:'invalid'}]) {
  test(`nonzero or malformed origin marker ${JSON.stringify(patch)} fails closed`,()=>{
    const {input,reports}=fixture();
    Object.assign(reports[0].ReportLegs[1].ReportLines[0],patch);
    reject(reports,input);
  });
}

test('zero origin marker time is valid provider evidence',()=>{
  for(const value of ['0:00','0:00:00']){
    const {input,reports}=fixture();
    reports[0].ReportLegs[1].ReportLines[0].Time=value;
    assert.doesNotThrow(()=>parseTrimbleRouteResponse(reports,input,config));
  }
});

test('second-precision independent Directions durations reconcile with leg time',()=>{
  const {input,reports}=fixture();
  const lines=reports[0].ReportLegs[1].ReportLines;
  lines[0].Time='0:00:00';lines[2].Time='0:00:20';lines[3].Time='0:00:45';lines[4].Time='0:00:00';
  const route=parseTrimbleRouteResponse(reports,input,config);
  assert.deepEqual(route.legs[1].maneuvers.map(m=>m.durationSeconds),[0,20,45,0]);
  lines[2].Time='0:00:00';
  reject(reports,input);
});

test('per-line values smaller than prior cumulative Mileage are valid',()=>{
  const {input,reports}=fixture();
  const lines=reports[0].ReportLegs[1].ReportLines;
  lines[0].Dist='0';lines[0].Time='0:00';lines[2].Dist='0.25';lines[2].Time='0:00';
  assert.equal(parseTrimbleRouteResponse(reports,input,config).legs[1].maneuvers[1].distanceMiles,0.25);
});

test('warnings in consumed metric rows and stop markers remain route rejections',()=>{
  for(const index of [0,2,3]) for(const warning of [{Warn:'Truck restriction'},{DetailedWarnings:[{Type:3}]}]) {
    const {input,reports}=fixture();
    Object.assign(reports[0].ReportLegs[1].ReportLines[index],warning);
    reject(reports,input,'TRIMBLE_RESTRICTION_WARNING');
  }
});

test('missing stop evidence and RoutePath remain rejected',()=>{
  const {input,reports}=fixture();
  const noStop=structuredClone(reports);delete noStop[1].ReportLines[1].Stop;
  reject(noStop,input,'TRIMBLE_STOP_COVERAGE_UNPROVEN');
  reject(reports.slice(0,2),input,'TRIMBLE_ROUTE_PATH_REQUIRED');
});

test('nested reports normalize identically without sharing previous-route legs or geometry',t=>{
  t.mock.timers.enable({apis:['Date'],now:new Date('2026-09-19T12:00:00Z')});
  const long=fixture(5),short=fixture(2);
  const longBefore=structuredClone(long.reports);
  const first=parseTrimbleRouteResponse({ReportResults:[{RouteReports:long.reports}]},long.input,config);
  const second=parseTrimbleRouteResponse({Reports:short.reports},short.input,config);
  assert.equal(first.legs.length,4);assert.equal(second.legs.length,1);
  assert.equal(second.turnByTurn[0].step,1);
  assert.deepEqual(second.routeGeometry,short.reports[2].geometry.coordinates);
  assert.deepEqual(long.reports,longBefore);
  second.turnByTurn[0].instruction='mutation in caller';
  const again=parseTrimbleRouteResponse(long.reports,long.input,config);
  assert.deepEqual(first,again);
});

test('commercial request order and all truck restrictions are unchanged for multiple stops',()=>{
  const {input,points}=fixture(5),before=structuredClone(input);
  const request=buildTrimbleRouteRequest(input,config).ReportRoutes[0];
  assert.deepEqual(request.Stops.map(s=>({lat:s.Coords.Lat,lng:s.Coords.Lon})),points);
  assert(request.Stops.every(s=>s.IsViaPoint===false));
  assert.equal(request.Options.OverrideRestrict,false);
  assert.equal(request.Options.VehicleType,0);assert.equal(request.Options.RoutingType,0);
  assert.deepEqual(request.Options.TruckCfg,{Units:0,Height:'162',Width:'102',Length:'636',Weight:'80000',Axles:5,MaxWeightPerAxleGroup:20000,LCV:false});
  assert.deepEqual(request.Options.TrailerCfg,{TypeOfTrailer:3,Count:1});
  assert.deepEqual(request.Options.HazMatTypes,[]);
  assert.deepEqual(input,before);
  input.truck.hazmatEnabled=true;input.truck.hazardousGoods=['explosive','corrosive'];
  assert.deepEqual(buildTrimbleRouteRequest(input,config).ReportRoutes[0].Options.HazMatTypes,[3,2]);
});
